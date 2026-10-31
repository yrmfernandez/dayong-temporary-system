import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";

import { DEACTIVATED, isDeactivated, pendingEntries } from "@/lib/account-deactivation";
import type { SessionUser } from "@/lib/auth";
import { currentDb, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { DECEASED_STATUS } from "@/lib/member-directory";
import { createReadableId } from "@/lib/readable-id";
import { recordCorrection } from "@/lib/record-corrections";
import { manilaNow } from "@/lib/remittance-deadline";
import { reviewBranches } from "@/lib/sale-submissions";

/**
 * Dropouts (owner, October 31, 2026). An Entry Clerk searches a member in their branches, ticks the program account(s)
 * to drop and gives the reason; an Administrator, HR Officer or IT (the people who deactivate accounts on Members)
 * approves or rejects it. A clerk cannot drop an account alone, so a MAS cannot have late payers, or members whose
 * payments they kept, quietly removed.
 *
 * Approving deactivates the accounts that day (lib/account-deactivation.ts, deactivated_on): they take no more
 * collections, and MAM counts them in that month and stops from the next, so finished months keep their quota. The
 * day of approval decides it, not a date typed on the request, so a dropout cannot be backdated into a finished month.
 * A Deceased reason also marks the member Deceased with the date of death (a record only). Entries of the account still
 * waiting on a remittance must be settled first, as for any deactivation.
 */

const { dropout_requests: requests, member_programs: memberPrograms, members, programs } = schema;
export const DROPOUT_REASONS = ["Dropped out", "Deceased", "Entered by mistake", "Other"] as const;
export type DropoutAccount = { enrollmentId: string; programId: string; programName: string; accountStatus: string };
const MODULE = "Program account status";
const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const fullName = (row: { surname: string | null; first_name: string | null; middle_name?: string | null }) => `${text(row.surname)}, ${text(row.first_name)} ${text(row.middle_name)}`.trim();

function toRequest(row: typeof requests.$inferSelect) {
  return {
    id: row.request_id, branch: row.branch, memberId: row.member_id, memberNumber: row.member_number, memberName: row.member_name,
    accounts: (row.accounts ?? []) as DropoutAccount[], reasonType: row.reason_type, reason: row.reason, diedOn: row.died_on ?? "",
    status: row.status as "Pending" | "Approved" | "Rejected", requestedAt: text(row.requested_at), requestedBy: text(row.requested_by_name),
    reviewedBy: text(row.reviewed_by_name), reviewedAt: text(row.reviewed_at), reviewNote: text(row.review_note),
  };
}
export type DropoutRequest = ReturnType<typeof toRequest>;

/** Members with an active account in the clerk's branches (every branch for an Administrator), by PH number or name. */
export async function searchDropoutMembers(user: SessionUser, query: string) {
  const q = text(query);
  if (q.length < 2) return [];
  const scope = await reviewBranches(user);
  if (scope && !scope.length) return [];
  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  const matches = words.map((word) => or(ilike(members.member_number, `%${word}%`), ilike(members.surname, `%${word}%`), ilike(members.first_name, `%${word}%`))!);
  const rows = await currentDb().select({
    memberId: members.member_id, number: members.member_number, surname: members.surname, first_name: members.first_name, middle_name: members.middle_name, memberStatus: members.status,
    enrollmentId: memberPrograms.enrollment_id, programId: memberPrograms.program_id, programName: programs.program_name, doi: memberPrograms.doi, branch: memberPrograms.branch, branchId: memberPrograms.branch_id,
    mas: memberPrograms.mas, accountStatus: memberPrograms.account_status, status: memberPrograms.status,
  }).from(memberPrograms).innerJoin(members, eq(members.member_id, memberPrograms.member_id)).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id))
    .where(and(...matches, sql`lower(trim(coalesce(${memberPrograms.status}, ''))) <> 'deactivated'`, scope ? inArray(memberPrograms.branch_id, scope) : undefined))
    .orderBy(members.surname, members.first_name).limit(120);
  const pending = await pendingRequestAccounts(rows.map((row) => row.enrollmentId));
  const byMember = new Map<string, { id: string; number: string; name: string; deceased: boolean; accounts: Array<{ enrollmentId: string; programId: string; programName: string; doi: string; branch: string; mas: string; accountStatus: string; pendingRequest: string }> }>();
  for (const row of rows) {
    const member = byMember.get(row.memberId) ?? { id: row.memberId, number: row.number, name: fullName(row), deceased: text(row.memberStatus).toLowerCase() === DECEASED_STATUS.toLowerCase(), accounts: [] };
    member.accounts.push({ enrollmentId: row.enrollmentId, programId: row.programId, programName: text(row.programName), doi: row.doi ?? "", branch: text(row.branch), mas: text(row.mas), accountStatus: text(row.accountStatus) || "NS", pendingRequest: pending.get(row.enrollmentId) ?? "" });
    byMember.set(row.memberId, member);
  }
  return [...byMember.values()].slice(0, 30);
}

/** Accounts already in a Pending request, with the request ID. */
async function pendingRequestAccounts(enrollmentIds: string[]) {
  const wanted = new Set(enrollmentIds);
  const found = new Map<string, string>();
  if (!wanted.size) return found;
  const rows = await currentDb().select({ id: requests.request_id, accounts: requests.accounts }).from(requests).where(eq(requests.status, "Pending"));
  for (const row of rows) for (const account of (row.accounts ?? []) as DropoutAccount[]) if (wanted.has(account.enrollmentId)) found.set(account.enrollmentId, row.id);
  return found;
}

export type DropoutInput = { memberId: string; enrollmentIds: string[]; reasonType: string; reason: string; diedOn?: string };

/** The clerk asks to drop the ticked accounts of one member. */
export async function requestDropout(user: SessionUser, input: DropoutInput) {
  const today = manilaNow().date;
  const reasonType = text(input.reasonType), reason = text(input.reason), diedOn = text(input.diedOn);
  const ids = [...new Set((input.enrollmentIds ?? []).map(text).filter(Boolean))];
  if (!ids.length) throw new Error("Tick the program(s) to drop.");
  if (!(DROPOUT_REASONS as readonly string[]).includes(reasonType)) throw new Error("Choose the reason: dropped out, deceased, entered by mistake or other.");
  if (reason.length < 3 || reason.length > 300) throw new Error("Explain the dropout (3–300 characters), e.g. who reported it and when.");
  if (reasonType === "Deceased" && (!validDate(diedOn) || diedOn > today)) throw new Error("Enter the date of death (today or earlier).");
  const scope = await reviewBranches(user);
  return inTransaction(async (tx) => {
    const [member] = await tx.select().from(members).where(eq(members.member_id, text(input.memberId)));
    if (!member) throw new Error("Member not found.");
    const accounts = await tx.select({ id: memberPrograms.enrollment_id, programId: memberPrograms.program_id, programName: programs.program_name, status: memberPrograms.status, accountStatus: memberPrograms.account_status,
      branch: memberPrograms.branch, branchId: memberPrograms.branch_id, memberNumber: memberPrograms.member_number }).from(memberPrograms).innerJoin(programs, eq(programs.program_id, memberPrograms.program_id))
      .where(and(eq(memberPrograms.member_id, member.member_id), inArray(memberPrograms.enrollment_id, ids))).for("update", { of: memberPrograms });
    if (accounts.length !== ids.length) throw new Error("Every ticked program must be an account of this member.");
    for (const account of accounts) {
      if (isDeactivated(account.status)) throw new Error(`${account.programName} is already deactivated for this member.`);
      if (scope && !scope.includes(text(account.branchId))) throw new Error(`${account.programName} belongs to ${text(account.branch)}, a branch you are not assigned to.`);
      const waiting = await pendingEntries(account.id, text(account.memberNumber), account.programId);
      if (waiting) throw new Error(`${account.programName} has ${waiting} entr${waiting === 1 ? "y" : "ies"} still waiting on a remittance. Settle ${waiting === 1 ? "it" : "them"} first, then ask for the dropout.`);
    }
    const pending = await pendingRequestAccounts(ids);
    if (pending.size) throw new Error(`${accounts.find((account) => pending.has(account.id))?.programName} is already in dropout request ${[...pending.values()][0]}, waiting for approval.`);
    const actor = getEncoder();
    const id = createReadableId("DROP");
    const row = {
      request_id: id, branch_id: text(accounts[0].branchId) || null, branch: [...new Set(accounts.map((account) => text(account.branch)))].join(", "),
      member_id: member.member_id, member_number: member.member_number, member_name: fullName(member),
      accounts: accounts.map((account) => ({ enrollmentId: account.id, programId: account.programId, programName: text(account.programName), accountStatus: text(account.accountStatus) || "NS" })),
      reason_type: reasonType, reason, died_on: reasonType === "Deceased" ? diedOn : null, status: "Pending", requested_at: actor.encodedAt,
      requested_by_employee_id: actor.employeeId, requested_by_name: actor.name,
      encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
    };
    await tx.insert(requests).values(row);
    return { id, memberNumber: member.member_number, count: accounts.length };
  });
}

/**
 * view "mine": requests in the clerk's branches (every pending one, and the last 60 days of decided ones).
 * view "review": the same for every branch, for the approvers.
 */
export async function listDropouts(user: SessionUser, view: "mine" | "review") {
  const scope = view === "review" ? null : await reviewBranches(user);
  if (scope && !scope.length) return [];
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const recent = or(eq(requests.status, "Pending"), gte(requests.requested_at, since));
  const rows = await currentDb().select().from(requests).where(scope ? and(recent, inArray(requests.branch_id, scope)) : recent).orderBy(desc(requests.row_seq)).limit(300);
  return rows.map(toRequest);
}

/** Approves a pending request: its accounts are deactivated today; a Deceased reason marks the member Deceased. */
export async function approveDropout(id: string) {
  const today = manilaNow().date;
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(requests).where(eq(requests.request_id, text(id))).for("update");
    if (!row) throw new Error("Dropout request not found.");
    if (row.status !== "Pending") throw new Error(`This request was already ${row.status.toLowerCase()}.`);
    const wanted = (row.accounts as DropoutAccount[]).map((account) => account.enrollmentId);
    const accounts = await tx.select().from(memberPrograms).where(inArray(memberPrograms.enrollment_id, wanted)).for("update");
    const notes: string[] = [];
    for (const want of row.accounts as DropoutAccount[]) {
      const account = accounts.find((item) => item.enrollment_id === want.enrollmentId);
      if (!account) { notes.push(`${want.programName} account ${want.enrollmentId} no longer exists.`); continue; }
      if (account.member_id !== row.member_id) throw new Error(`${want.programName} account ${want.enrollmentId} was moved to another member after the request. Reject it and ask the clerk to request again.`);
      if (isDeactivated(account.status)) { notes.push(`${want.programName} was already deactivated.`); continue; }
      const waiting = await pendingEntries(account.enrollment_id, text(account.member_number), account.program_id);
      if (waiting) throw new Error(`${want.programName} has ${waiting} entr${waiting === 1 ? "y" : "ies"} still waiting on a remittance. Settle ${waiting === 1 ? "it" : "them"} first, then approve.`);
      await tx.update(memberPrograms).set({ status: DEACTIVATED, deactivated_on: today }).where(eq(memberPrograms.enrollment_id, account.enrollment_id));
      await recordCorrection(MODULE, account.enrollment_id, `${row.reason_type}: ${row.reason} (dropout ${row.request_id})`, { status: text(account.status) || "Active" }, { status: DEACTIVATED, deactivatedOn: today });
    }
    if (row.reason_type === "Deceased") {
      const [member] = await tx.select({ status: members.status, diedOn: members.died_on }).from(members).where(eq(members.member_id, row.member_id));
      if (member) {
        await tx.update(members).set({ status: DECEASED_STATUS, died_on: row.died_on }).where(eq(members.member_id, row.member_id));
        await recordCorrection("Member status", row.member_id, `Deceased (dropout ${row.request_id}): ${row.reason}`, { status: member.status, diedOn: member.diedOn }, { status: DECEASED_STATUS, diedOn: row.died_on });
      }
    }
    const actor = getEncoder();
    await tx.update(requests).set({ status: "Approved", reviewed_by_name: actor.name, reviewed_at: actor.encodedAt }).where(eq(requests.request_id, row.request_id));
    return { id: row.request_id, memberNumber: row.member_number, notes };
  });
}

export async function rejectDropout(id: string, note: string) {
  if (text(note).length < 3) throw new Error("Give the reason for rejecting it (at least 3 characters).");
  const actor = getEncoder();
  const updated = await currentDb().update(requests).set({ status: "Rejected", review_note: text(note).slice(0, 300), reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(requests.request_id, text(id)), eq(requests.status, "Pending"))).returning({ id: requests.request_id });
  if (!updated.length) throw new Error("This request was already decided.");
  return { id: updated[0].id };
}

