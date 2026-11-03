import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { accountState, forfeitedPaymentsAllowed, validatePayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import type { SessionUser } from "@/lib/auth";
import { addClearing } from "@/lib/clearing";
import { coveredKinds, type ClearingCovers } from "@/lib/clearing-kinds";
import { currentDb, encodedBy, getDb, inTransaction, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getEncoder } from "@/lib/encoder-context";
import { masCollectionQuote, MAX_SUBMISSION_ENTRIES } from "@/lib/mas-collection-quote";
import { createReadableId } from "@/lib/readable-id";
import { tiersForBranch } from "@/lib/remittance";
import { incentiveDeadline, manilaNow } from "@/lib/remittance-deadline";
import { masProfile, reviewBranches } from "@/lib/sale-submissions";
import { loadWorkCalendar } from "@/lib/work-calendar";

/**
 * Collections submitted by a MAS (owner, October 31, 2026), as New Sales already are (lib/sale-submissions.ts). On
 * Submit Collections the MAS picks their own members and how many months each paid (on a flexible program also the
 * amount paid, owner, November 3, 2026); the OR date is the day the member
 * was added to the batch, and the system works out the months, NOP, amount and their incentive. A suspended account
 * needs Waiver ticked. Members of several branches submitted together become one submission per branch.
 *
 * Only the clerk changes a batch once it is submitted (owner, October 31, 2026): the MAS can neither edit nor withdraw it,
 * nor mark it remitted, since a MAS could claim cash they have not handed over. An Entry Clerk assigned to the branch
 * (administrators: every branch) reviews it on Collections → Submitted by MAS, corrects it on the form (months, amount,
 * Waiver, removing a member), types the OR numbers, picks the MAS's handover in From Clearing and saves it through the
 * normal Collections save, which marks it Saved in the same transaction. A batch that should not be saved at all is
 * Rejected with a reason; its members can then be submitted again.
 *
 * Mark remitted (owner, October 31, 2026): when the MAS hands the cash over, the clerk marks the batch remitted at once,
 * as on Clearing, and types the OR numbers later, even after 3:00 PM. Marking records a Clearing for the MAS (Collections)
 * at that moment, or links today's clearing when it is the same cash; the batch is then saved under that clearing, so
 * its time decides the incentive (lib/remittance-workflow.ts receivedAtOf). Only the clerk can mark it.
 *
 * The incentive follows the usual 3:00 PM rule (lib/remittance-deadline.ts): kept when the cash is handed over at
 * Clearing by 3:00 PM the next working day after the OR date, otherwise forfeited and the whole amount handed over.
 *
 * Collectors (owner, November 3, 2026): an employee with the Collector role chooses Collected by MAS (their own members,
 * if they are also a MAS) or Collector. As Collector they pick whose members they collected, any MAS of their branches,
 * and ORC Yes or No for the batch. The Collector tier applies (ORC: half of the MAS incentive); the Collector is
 * accountable and remits the cash, and each payment keeps the member's MAS on record, as on the Collections form.
 */
const submissions = schema.collection_submissions;
export { MAX_SUBMISSION_ENTRIES };
const text = (value: unknown) => String(value ?? "").trim();
const sameName = (a: unknown, b: unknown) => text(a).replace(/\s+/g, " ").toLowerCase() === text(b).replace(/\s+/g, " ").toLowerCase();
const cents = (value: number) => Math.round(value * 100) / 100;

/** One member's payment as the MAS submitted it, with what the system worked out. */
export type SubmittedCollection = {
  enrollmentId: string; memberId: string; memberNumber: string; memberName: string; programId: string; programName: string;
  months: number; monthFrom: string; monthTo: string; nopFrom: number; nopTo: number; amount: number; incentive: number; remittance: number;
  orDate: string; waiver: boolean;
};
export type CollectedBy = "MAS" | "Collector";
export type CollectionSubmission = {
  id: string; branchId: string; branch: string; masEmployeeId: string; mas: string; status: "Submitted" | "Remitted" | "Rejected" | "Saved";
  entries: SubmittedCollection[]; entryCount: number; totalAmount: number; totalIncentive: number; submittedAt: string;
  returnReason: string; reviewedByName: string; reviewedAt: string; collectionIds: string[];
  /** 3:00 PM the next working day after the earliest OR date: the cash handed over by then keeps the incentive. */
  incentiveDeadline: string;
  /** Marked remitted: the clearing recorded for it, when ("YYYY-MM-DD HH:MM", Manila) and by whom. */
  clearingId: string; remittedAt: string; remittedByName: string;
  /** Collected by the submitter as MAS, or as Collector for the members of memberMas (with ORC or not). */
  collectedBy: CollectedBy; memberMasEmployeeId: string; memberMas: string; orc: boolean;
};
/** Batches still waiting for the clerk's save: just submitted, or marked remitted with the OR numbers still to type. */
const OPEN = ["Submitted", "Remitted"];
const stamp = (value: string | null | undefined) => { if (!value) return ""; const at = manilaNow(new Date(value)); return `${at.date} ${at.time}`; };

const toSubmission = (row: typeof submissions.$inferSelect, deadline = ""): CollectionSubmission => ({
  id: row.submission_id, branchId: row.branch_id, branch: row.branch, masEmployeeId: row.mas_employee_id, mas: row.mas,
  status: row.status === "Saved" ? "Saved" : row.status === "Rejected" ? "Rejected" : row.status === "Remitted" ? "Remitted" : "Submitted",
  entries: Array.isArray(row.entries) ? row.entries as SubmittedCollection[] : [], entryCount: row.entry_count,
  totalAmount: row.total_amount, totalIncentive: row.total_incentive, submittedAt: row.submitted_at,
  returnReason: text(row.return_reason), reviewedByName: text(row.reviewed_by_name), reviewedAt: row.reviewed_at ?? "",
  collectionIds: text(row.collection_ids).split(",").map(text).filter(Boolean), incentiveDeadline: deadline,
  clearingId: text(row.clearing_id), remittedAt: stamp(row.remitted_at), remittedByName: text(row.remitted_by_name),
  collectedBy: row.collected_by === "Collector" ? "Collector" : "MAS", memberMasEmployeeId: text(row.member_mas_employee_id) || row.mas_employee_id,
  memberMas: text(row.member_mas) || row.mas, orc: row.collected_by === "Collector" && row.orc === true,
});

/** Adds each submission's incentive deadline, from its earliest OR date and its branch's working days. */
async function withDeadlines(rows: Array<typeof submissions.$inferSelect>) {
  const calendars = new Map<string, Awaited<ReturnType<typeof loadWorkCalendar>>>();
  const result: CollectionSubmission[] = [];
  for (const row of rows) {
    if (!calendars.has(row.branch)) calendars.set(row.branch, await loadWorkCalendar(row.branch));
    const first = toSubmission(row).entries.map((entry) => entry.orDate).filter(Boolean).sort()[0] ?? "";
    result.push(toSubmission(row, first ? incentiveDeadline(first, calendars.get(row.branch)) : ""));
  }
  return result;
}

/** Why a MAS cannot collect on this account today, or "" when they can. */
function blockedReason(status: string, today: string) {
  if (status === "Fully Paid") return "Fully paid: no more payments.";
  if (status === "Forfeited" && !forfeitedPaymentsAllowed(today)) return "Forfeited: needs reactivation at the office.";
  return "";
}

/**
 * Who submits and whose members (owner, November 3, 2026). Collected by MAS: the submitter's own members. Collected by
 * Collector (Collector role only): the members of the chosen MAS, an active employee with the MAS role who shares one of
 * the Collector's branches. `masOptions` lists those MAS for the page.
 */
async function collectorContext(user: SessionUser, collectedBy: unknown, memberMasEmployeeId: unknown) {
  const [profile, employees] = await Promise.all([masProfile(user), getEmployees()]);
  const roles = employees.find((item) => item.id === profile.employeeId)?.roles ?? [];
  const isCollector = roles.includes("collector"), isMas = roles.includes("mas");
  const branchIds = new Set(profile.branches.map((branch) => branch.id));
  const masOptions = isCollector ? employees
    .filter((item) => item.id !== profile.employeeId && item.status.toLowerCase() === "active" && item.roles.includes("mas") && item.branchIds.some((id) => branchIds.has(id)))
    .map((item) => ({ employeeId: item.id, name: item.name, branchIds: item.branchIds.filter((id) => branchIds.has(id)) }))
    .sort((a, b) => a.name.localeCompare(b.name)) : [];
  // A Collector who is not a MAS has no members of their own, so they collect as Collector.
  const as: CollectedBy = collectedBy === "Collector" || (collectedBy !== "MAS" && isCollector && !isMas) ? "Collector" : "MAS";
  if (as === "Collector" && !isCollector) throw new Error("Only an employee with the Collector role can collect as Collector. Ask HR.");
  const memberMas = as === "Collector" ? masOptions.find((item) => item.employeeId === text(memberMasEmployeeId)) ?? null : null;
  return { profile, isCollector, isMas, masOptions, as, memberMas };
}

/** enrollment ID -> the open submission (anyone's) that already has it: saving both would pay it twice. */
async function pendingAccounts() {
  const open = await getDb().select({ id: submissions.submission_id, entries: submissions.entries }).from(submissions).where(inArray(submissions.status, OPEN));
  const pending = new Map<string, string>();
  for (const row of open) for (const entry of Array.isArray(row.entries) ? row.entries as SubmittedCollection[] : []) pending.set(entry.enrollmentId, row.id);
  return pending;
}

/**
 * The accounts the submitter may collect, in their active branches, each with today's standing and the incentive tiers
 * of its program, so the page can show the incentive before submitting: their own as MAS, or the chosen MAS's as
 * Collector. `pendingIn` names an open submission that already has the account.
 */
export async function myCollectionAccounts(user: SessionUser, options: { collectedBy?: unknown; memberMasEmployeeId?: unknown } = {}) {
  const context = await collectorContext(user, options.collectedBy, options.memberMasEmployeeId);
  const { profile } = context;
  const collector = { isCollector: context.isCollector, isMas: context.isMas, masOptions: context.masOptions, collectedBy: context.as, memberMasEmployeeId: context.memberMas?.employeeId ?? "" };
  const today = manilaNow().date;
  const ownerName = context.as === "Collector" ? context.memberMas?.name ?? "" : profile.name;
  // As Collector with no MAS chosen yet: nothing to list.
  if (!ownerName) return { profile, collector, today, accounts: [] };
  const [data, pending] = await Promise.all([loadAccountData({ mas: ownerName }), pendingAccounts()]);
  const accounts = data.accounts.flatMap((account) => {
    const branch = profile.branches.find((item) => sameName(item.name, account.branch));
    if (!branch) return [];
    const tiers = tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), branch.id);
    const base = {
      id: account.id, memberId: account.memberId, memberNumber: account.memberNumber, memberName: account.memberName, programId: account.programId, programName: account.programName,
      branchId: branch.id, branch: branch.name, basePay: account.basePay, flexible: Boolean(account.flexible), maxMonthlyPayment: account.maxMonthlyPayment ?? null, tiers,
      pendingIn: pending.get(account.id) ?? "",
    };
    try {
      const state = accountState(account, data.payments, today);
      return [{ ...base, status: state.status as string, temporarilySuspended: state.temporarilySuspended, suspendedAt: state.suspendedAt, forfeitedAt: state.forfeitedAt,
        nextMonth: state.nextMonth, nextNop: state.nextNop, lastCoveredMonth: state.lastCoveredMonth, unpaidMonths: state.unpaidMonths, latestOrDate: state.latestOrDate,
        blocked: blockedReason(state.status, today) }];
    } catch (error) {
      return [{ ...base, status: "Needs review", temporarilySuspended: false, suspendedAt: "", forfeitedAt: "", nextMonth: "", nextNop: 0, lastCoveredMonth: "", unpaidMonths: 0, latestOrDate: "",
        blocked: error instanceof Error ? `${error.message} Ask the office.` : "The account needs review at the office." }];
    }
  });
  return { profile, collector, today, accounts: accounts.sort((a, b) => a.memberName.localeCompare(b.memberName) || a.programName.localeCompare(b.programName)) };
}

/** The MAS's own collection submissions, newest first. */
export async function listMyCollectionSubmissions(user: SessionUser) {
  const rows = await getDb().select().from(submissions).where(eq(submissions.mas_employee_id, user.employeeId)).orderBy(desc(submissions.row_seq)).limit(50);
  return withDeadlines(rows);
}

/**
 * Saves the members a MAS collected from, OR date today. Members of different branches can be sent together; each
 * branch becomes its own submission (owner, November 2, 2026), since each branch's clerk saves and remits its own.
 * Everything shown to the MAS is worked out again here from the account, with the same money rules as the Collections
 * save. It cannot be changed afterwards.
 */
export async function submitCollections(user: SessionUser, input: { entries?: unknown; collectedBy?: unknown; memberMasEmployeeId?: unknown; orc?: unknown }) {
  const context = await collectorContext(user, input.collectedBy === "Collector" ? "Collector" : "MAS", input.memberMasEmployeeId);
  const { profile, memberMas } = context;
  const asCollector = context.as === "Collector";
  if (asCollector && !memberMas) throw new Error("Choose whose members you collected: a MAS of your branches.");
  const ownerName = memberMas?.name ?? profile.name;
  const orc = asCollector && input.orc === true;
  if (!profile.branches.length) throw new Error("You are not assigned to an active branch. Ask HR to assign you.");
  if (!Array.isArray(input.entries) || !input.entries.length) throw new Error("Add at least one member.");
  if (input.entries.length > MAX_SUBMISSION_ENTRIES) throw new Error(`Submit at most ${MAX_SUBMISSION_ENTRIES} members at a time.`);
  const chosen = (input.entries as Array<Record<string, unknown>>).map((entry) => ({ enrollmentId: text(entry?.enrollmentId), months: Number(entry?.months), amount: entry?.amount == null || entry.amount === "" ? null : Number(entry.amount), waiver: entry?.waiver === true }));
  const ids = chosen.map((entry) => entry.enrollmentId);
  if (ids.some((id) => !id)) throw new Error("A member in the batch is incomplete. Reload the page and try again.");
  if (new Set(ids).size !== ids.length) throw new Error("A member is in the batch twice. Add the months to one card instead.");

  // A member waiting in another submission (anyone's: the MAS's or a Collector's) would be paid twice once both are saved.
  const pending = await pendingAccounts();
  const twice = ids.find((id) => pending.has(id));
  if (twice) throw new Error(`A member in the batch is already in submission ${pending.get(twice)}, waiting for the clerk. Remove them, or tell the clerk if it needs changing.`);

  const today = manilaNow().date;
  const data = await loadAccountData({ enrollmentIds: ids });
  const entries = chosen.map((item) => {
    const account = data.accounts.find((candidate) => candidate.id === item.enrollmentId);
    if (!account) throw new Error("A member in the batch no longer has this program. Reload the page.");
    const label = `${account.memberName} (${account.programName})`;
    if (!sameName(account.mas, ownerName)) throw new Error(asCollector ? `${label} is not a member of ${ownerName}.` : `${label} is not your member.`);
    const branch = profile.branches.find((candidate) => sameName(candidate.name, account.branch));
    if (!branch) throw new Error(`${label} belongs to ${account.branch || "no branch"}, which is not one of your branches. Ask HR.`);
    const orDate = today;
    const state = accountState(account, data.payments, today);
    const blocked = blockedReason(state.status, today);
    if (blocked) throw new Error(`${label}: ${blocked}`);
    // Suspension is judged on the OR date, as the Collections save does (lib/account-rules.ts validatePayment).
    if (accountState(account, data.payments, orDate).temporarilySuspended && !item.waiver) throw new Error(`${label} is suspended. Have the member sign the Waiver, then tick Waiver.`);
    try {
      const tiers = tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), branch.id);
      const quote = masCollectionQuote({ basePay: account.basePay, flexible: Boolean(account.flexible), maxMonthlyPayment: account.maxMonthlyPayment ?? null, nextMonth: state.nextMonth, nextNop: state.nextNop, tiers }, item.months, { role: context.as, orc }, item.amount);
      // The clerk types the OR number when saving; a stand-in lets the same payment rules run now.
      validatePayment(account, data.payments, { monthFrom: quote.monthFrom, monthTo: quote.monthTo, nopFrom: quote.nopFrom, nopTo: quote.nopTo, amount: quote.amount, orDate, orNumber: "(typed by the clerk)", waiver: item.waiver ? "Waiver" : "", collectedByRole: context.as, originalMas: asCollector ? ownerName : "" }, today);
      const entry: SubmittedCollection = { enrollmentId: account.id, memberId: account.memberId, memberNumber: account.memberNumber, memberName: account.memberName, programId: account.programId, programName: account.programName, ...quote, orDate, waiver: item.waiver };
      return { branch, entry };
    } catch (error) {
      throw new Error(`${label}: ${error instanceof Error ? error.message : "cannot be collected."}`);
    }
  });

  // One submission per branch, in the order the branches first appear; all saved or none.
  const byBranch = new Map<string, { branch: { id: string; name: string }; entries: SubmittedCollection[] }>();
  for (const { branch, entry } of entries) {
    const group = byBranch.get(branch.id) ?? { branch, entries: [] };
    group.entries.push(entry);
    byBranch.set(branch.id, group);
  }
  const actor = getEncoder();
  const batches = [...byBranch.values()].map(({ branch, entries: group }) => ({
    submission_id: createReadableId("CSUB"), branch_id: branch.id, branch: branch.name, mas_employee_id: profile.employeeId, mas: profile.name, status: "Submitted",
    entries: group, entry_count: group.length, total_amount: cents(group.reduce((sum, entry) => sum + entry.amount, 0)),
    total_incentive: cents(group.reduce((sum, entry) => sum + entry.incentive, 0)), submitted_at: actor.encodedAt,
    collected_by: context.as, member_mas_employee_id: memberMas?.employeeId ?? null, member_mas: memberMas?.name ?? null, orc, ...encodedBy(),
  }));
  await inTransaction(() => currentDb().insert(submissions).values(batches));
  return { ids: batches.map((batch) => batch.submission_id), entryCount: entries.length, collectedBy: context.as, memberMas: memberMas?.name ?? "", batches: batches.map((batch) => ({ branch: batch.branch, entryCount: batch.entry_count })) };
}

/** Submissions waiting for the clerk in their branches (submitted, or marked remitted and not yet saved), oldest first. */
export async function listCollectionsForReview(user: SessionUser) {
  const scope = await reviewBranches(user);
  if (scope && !scope.length) return [];
  const waiting = inArray(submissions.status, OPEN);
  const rows = await getDb().select().from(submissions).where(scope ? and(waiting, inArray(submissions.branch_id, scope)) : waiting).orderBy(submissions.row_seq);
  return withDeadlines(rows);
}

/** A submission the clerk may save now, matching the batch's branch and accountable MAS (by ID); throws otherwise. */
export async function reviewableCollectionSubmission(user: SessionUser, id: string, branchId: string, employeeId: string, clearingId = "") {
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  if (!OPEN.includes(row.status)) throw new Error(row.status === "Saved" ? "This MAS submission was already saved." : "This MAS submission was rejected.");
  if (row.branch_id !== text(branchId) || row.mas_employee_id !== text(employeeId)) throw new Error(`This MAS submission is for ${row.branch}, ${row.mas}. Pick that MAS's handover in From Clearing.`);
  // Marked remitted: saved under the clearing recorded then, whose time decides the incentive.
  if (row.clearing_id && row.clearing_id !== text(clearingId)) throw new Error(`This batch was marked remitted at ${stamp(row.remitted_at).slice(11)}. Save it under that handover in From Clearing.`);
  return toSubmission(row);
}

/**
 * The clerk marks a submitted batch remitted the moment the MAS hands the cash over. `handover`: "" records a new
 * clearing now unless the MAS was already cleared for Collections today (then AlreadyClearedError asks which it is);
 * "same" links today's latest clearing (the same cash); "new" records a new clearing for a second handover today.
 */
export async function markCollectionSubmissionRemitted(user: SessionUser, id: string, handover: "" | "same" | "new" = "") {
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  if (row.status !== "Submitted") throw new Error(row.status === "Remitted" ? "This batch is already marked remitted." : row.status === "Saved" ? "This MAS submission was already saved." : "This MAS submission was rejected.");
  const actor = getEncoder();
  return inTransaction(async () => {
    let clearingId = "", remittedAt = new Date().toISOString();
    if (handover === "same") {
      const { clearings } = schema;
      const today = await currentDb().select({ id: clearings.clearing_id, at: clearings.cleared_at, covers: clearings.covers }).from(clearings)
        .where(and(eq(clearings.employee_id, row.mas_employee_id), eq(clearings.branch, row.branch), eq(clearings.cleared_date, manilaNow().date), ne(clearings.status, "Removed")))
        .orderBy(desc(clearings.cleared_at));
      const match = today.find((item) => coveredKinds((text(item.covers) || "Both") as ClearingCovers).includes("Collections"));
      if (!match) throw new Error(`${row.mas} has no Collections clearing today to use. Mark it remitted as a new handover.`);
      clearingId = match.id; remittedAt = match.at;
    } else {
      const cleared = await addClearing({ branch: row.branch, employeeId: row.mas_employee_id, covers: "Collections", amount: cents(row.total_amount - row.total_incentive), notes: `MAS batch ${row.submission_id} (Submit Collections)`, newHandover: handover === "new" });
      clearingId = cleared.id;
    }
    const updated = await currentDb().update(submissions).set({ status: "Remitted", clearing_id: clearingId, remitted_at: remittedAt, remitted_by_name: actor.name })
      .where(and(eq(submissions.submission_id, row.submission_id), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
    if (!updated.length) throw new Error("This MAS submission was just marked, saved or rejected by someone else.");
    return { id: row.submission_id, mas: row.mas, remittedAt: stamp(remittedAt) };
  });
}

/** Marks a submission Saved with its collection IDs. Call inside the Collections transaction: saved twice rolls back. */
export async function markCollectionSubmissionSaved(id: string, collectionIds: string[]) {
  const actor = getEncoder();
  const updated = await currentDb().update(submissions).set({ status: "Saved", collection_ids: collectionIds.join(","), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, text(id)), inArray(submissions.status, OPEN))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was just saved or rejected by someone else. Nothing was saved.");
}

/**
 * The clerk rejects a batch that should not be saved at all (for example the MAS never remitted the cash, or the members
 * did not pay), with the reason the MAS sees. Mistakes in a batch are corrected on the form instead.
 */
export async function rejectCollectionSubmission(user: SessionUser, id: string, reason: string) {
  if (text(reason).length < 3) throw new Error("Give the reason for rejecting it (at least 3 characters).");
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  if (row.status === "Remitted") throw new Error("This batch is marked remitted: the office has the cash. Review it, correct what is wrong and save it.");
  const actor = getEncoder();
  const updated = await getDb().update(submissions).set({ status: "Rejected", return_reason: text(reason).slice(0, 500), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, row.submission_id), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was already saved or returned.");
  return { id: row.submission_id };
}
