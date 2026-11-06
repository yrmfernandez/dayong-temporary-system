import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";

import { normalizeRoleName } from "@/lib/access-control";
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
import { shortCached } from "@/lib/short-cache";
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
 * Collectors (owner, November 3, 2026): an employee with the Collector role chooses Collected by MAS (their own members)
 * or Collector. As Collector they start on the members assigned to them (owner, November 6, 2026; lib/member-transfer.ts
 * assignCollector), or pick whose members they collected, anyone holding accounts in their branches, their own included,
 * and ORC Yes or No for the batch. Assigned members can be of several MAS, so a batch is one per branch and MAS: the
 * clerk saves each as a Collector batch of one MAS. The Collector tier applies (ORC: half of the MAS incentive); the
 * MAS incentive only on an account they hold with no Collector assigned, like any MAS, or when the clerk ticks Collected
 * by MAS on the form (owner, November 6, 2026; collectorOnlyAccount below); the
 * Collector is accountable and remits the cash, and each payment keeps the member's MAS on record, as on the Collections
 * form. Every employee is a virtual MAS (lib/workspace-session.ts), so a Collector needs no MAS role to have the choice
 * (owner, November 6, 2026); it starts on the workspace open, and can be changed on the page.
 *
 * Forgotten batches (owner, November 4, 2026): the batch being filled is kept on the server (collection_drafts), each
 * member with the day they were added. After midnight the nightly job sends what is left from earlier days, OR date the
 * day added, and the clerk is warned to contact the MAS so the cash is remitted. See autoSubmitCollectionDrafts.
 */
const submissions = schema.collection_submissions;
const drafts = schema.collection_drafts;
export { MAX_SUBMISSION_ENTRIES };
const text = (value: unknown) => String(value ?? "").trim();
const sameName = (a: unknown, b: unknown) => text(a).replace(/\s+/g, " ").toLowerCase() === text(b).replace(/\s+/g, " ").toLowerCase();
const cents = (value: number) => Math.round(value * 100) / 100;
/** A batch may run past what one Submit takes (MAX_SUBMISSION_ENTRIES); the page asks to submit it in parts. */
const MAX_DRAFT_ENTRIES = 100;

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
  /** Sent by the nightly job because it was never submitted. masContact (clerk's list only): who to call about the cash. */
  autoSubmitted: boolean; masContact: string;
  /** Rejected: the MAS has seen it, so it no longer counts on the sidebar. */
  rejectionSeen: boolean;
  /** Saved (the MAS's own list only): the Fidelity the clerk recorded with this batch. */
  fidelity: number;
};
/** One member in the batch being filled. `amount`: typed on a flexible program; "" is its Base Pay, or the minimum if none. */
export type DraftItem = { enrollmentId: string; months: number; amount: string; waiver: boolean; addedOn: string };
/** Batches still waiting for the clerk's save: just submitted, or marked remitted with the OR numbers still to type. */
const OPEN = ["Submitted", "Remitted"];
const stamp = (value: string | null | undefined) => { if (!value) return ""; const at = manilaNow(new Date(value)); return `${at.date} ${at.time}`; };

/**
 * Until November 4, 2026 (about 2:55 PM Manila) a batch was kept newest first; since then first added first. Batches
 * sent before that are turned around when read, so the clerk sees every batch in the order it was collected.
 */
const NEWEST_FIRST_UNTIL = Date.parse("2026-11-04T07:00:00Z");
const entriesOf = (row: typeof submissions.$inferSelect) => {
  const entries = Array.isArray(row.entries) ? row.entries as SubmittedCollection[] : [];
  return new Date(row.submitted_at).getTime() < NEWEST_FIRST_UNTIL ? [...entries].reverse() : entries;
};

const toSubmission = (row: typeof submissions.$inferSelect, deadline = ""): CollectionSubmission => ({
  id: row.submission_id, branchId: row.branch_id, branch: row.branch, masEmployeeId: row.mas_employee_id, mas: row.mas,
  status: row.status === "Saved" ? "Saved" : row.status === "Rejected" ? "Rejected" : row.status === "Remitted" ? "Remitted" : "Submitted",
  entries: entriesOf(row), entryCount: row.entry_count,
  totalAmount: row.total_amount, totalIncentive: row.total_incentive, submittedAt: row.submitted_at,
  returnReason: text(row.return_reason), reviewedByName: text(row.reviewed_by_name), reviewedAt: row.reviewed_at ?? "",
  collectionIds: text(row.collection_ids).split(",").map(text).filter(Boolean), incentiveDeadline: deadline,
  clearingId: text(row.clearing_id), remittedAt: stamp(row.remitted_at), remittedByName: text(row.remitted_by_name),
  collectedBy: row.collected_by === "Collector" ? "Collector" : "MAS", memberMasEmployeeId: text(row.member_mas_employee_id) || row.mas_employee_id,
  memberMas: text(row.member_mas) || row.mas, orc: row.collected_by === "Collector" && row.orc === true,
  autoSubmitted: row.auto_submitted === true, masContact: "", rejectionSeen: Boolean(row.rejection_seen_at), fidelity: 0,
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

/** Role names are stored as written ("Collector"), so they are always compared normalized. */
const holdsRole = (roles: readonly string[], role: string) => roles.some((item) => normalizeRoleName(item) === role);
const holderKey = (mas: unknown, branch: unknown) => `${text(mas).replace(/\s+/g, " ").toLowerCase()}|${text(branch).replace(/\s+/g, " ").toLowerCase()}`;

/** Who holds accounts in which branch: a few hundred pairs, read for a minute at a time. */
function accountHolders() {
  const accounts = schema.member_programs;
  return shortCached("account-holders", 60_000, async () => (await getDb().selectDistinct({ mas: accounts.mas, branch: accounts.branch }).from(accounts)).map((row) => holderKey(row.mas, row.branch)));
}

/**
 * Who submits and whose members (owner, November 3, 2026). Collected by MAS: the submitter's own members. Collected by
 * Collector (Collector role only): the members of the chosen person, an active employee holding accounts in one of the
 * Collector's branches. That is not only the MAS role: every employee is a virtual MAS, so a clerk or another Collector
 * can hold accounts, and so can the Collector themself (`own`, listed first). `masOptions` lists them for the page.
 * As Collector with nobody chosen: the members assigned to them. With no choice yet it follows the workspace: their MAS
 * workspace is MAS; the Collector workspace is Collector.
 */
async function collectorContext(user: Pick<SessionUser, "employeeId"> & Partial<Pick<SessionUser, "roleNames">>, collectedBy: unknown, memberMasEmployeeId: unknown) {
  const [profile, employees] = await Promise.all([masProfile(user), getEmployees()]);
  const isCollector = holdsRole(employees.find((item) => item.id === profile.employeeId)?.roles ?? [], "collector");
  const holders = new Set(isCollector ? await accountHolders() : []);
  const masOptions = !isCollector ? [] : employees
    .filter((item) => item.status.toLowerCase() === "active")
    .map((item) => ({ employeeId: item.id, name: item.name, own: item.id === profile.employeeId, branchIds: profile.branches.filter((branch) => holders.has(holderKey(item.name, branch.name))).map((branch) => branch.id) }))
    .filter((item) => item.branchIds.length)
    .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  const workspace = user.roleNames ?? [];
  const startsAsCollector = holdsRole(workspace, "collector") && !holdsRole(workspace, "mas");
  const as: CollectedBy = collectedBy === "Collector" || (collectedBy !== "MAS" && isCollector && startsAsCollector) ? "Collector" : "MAS";
  if (as === "Collector" && !isCollector) throw new Error("Only an employee with the Collector role can collect as Collector. Ask HR.");
  const memberMas = as === "Collector" ? masOptions.find((item) => item.employeeId === text(memberMasEmployeeId)) ?? null : null;
  return { profile, isCollector, masOptions, as, memberMas };
}
type SubmitContext = Awaited<ReturnType<typeof collectorContext>>;
/**
 * Why an employee with the Collector role cannot send this account as MAS, or "" (owner, November 6, 2026). An account with
 * a Collector assigned earns the Collector incentive; the MAS incentive needs No Collector on it, or the clerk ticking
 * Collected by MAS on the form. A MAS who is not a Collector is not limited: their member stays theirs to collect.
 */
const collectorOnlyAccount = (context: Pick<SubmitContext, "as" | "isCollector">, account: { collectorEmployeeId?: string }) =>
  context.as === "MAS" && context.isCollector && account.collectorEmployeeId ? "It has a Collector assigned: submit it as Collector." : "";
type Choice = { enrollmentId: string; months: number; amount: number | null; waiver: boolean };

/**
 * One member of a batch, worked out again from the account with the same money rules as the Collections save; `day` is
 * the OR date, and the account is judged as of that day. Sent automatically (`auto`), a suspended account goes through
 * without Waiver ticked: the member paid, and the clerk's form still asks for the Waiver before saving.
 */
function batchEntry(context: SubmitContext, data: Awaited<ReturnType<typeof loadAccountData>>, item: Choice, day: string, orc: boolean, auto = false) {
  const { profile, memberMas } = context;
  const asCollector = context.as === "Collector", assigned = asCollector && !memberMas;
  const ownerName = memberMas?.name ?? profile.name;
  const account = data.accounts.find((candidate) => candidate.id === item.enrollmentId);
  if (!account) throw new Error("A member in the batch no longer has this program. Reload the page.");
  const label = `${account.memberName} (${account.programName})`;
  if (assigned ? account.collectorEmployeeId !== profile.employeeId : !sameName(account.mas, ownerName)) throw new Error(assigned ? `${label} is not assigned to you.` : asCollector ? `${label} is not a member of ${ownerName}.` : `${label} is not your member.`);
  const onlyAsCollector = collectorOnlyAccount(context, account);
  if (onlyAsCollector) throw new Error(`${label}: ${onlyAsCollector}`);
  const branch = profile.branches.find((candidate) => sameName(candidate.name, account.branch));
  if (!branch) throw new Error(`${label} belongs to ${account.branch || "no branch"}, which is not one of your branches. Ask HR.`);
  const state = accountState(account, data.payments, day);
  const blocked = blockedReason(state.status, day);
  if (blocked) throw new Error(`${label}: ${blocked}`);
  // Suspension is judged on the OR date, as the Collections save does (lib/account-rules.ts validatePayment).
  if (state.temporarilySuspended && !item.waiver && !auto) throw new Error(`${label} is suspended. Have the member sign the Waiver, then tick Waiver.`);
  try {
    const tiers = tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), branch.id);
    const quote = masCollectionQuote({ basePay: account.basePay, flexible: Boolean(account.flexible), maxMonthlyPayment: account.maxMonthlyPayment ?? null, flexibleBasePay: account.flexibleBasePay ?? null, nextMonth: state.nextMonth, nextNop: state.nextNop, tiers }, item.months, { role: context.as, orc }, item.amount);
    // The clerk types the OR number when saving; a stand-in lets the same payment rules run now.
    validatePayment(account, data.payments, { monthFrom: quote.monthFrom, monthTo: quote.monthTo, nopFrom: quote.nopFrom, nopTo: quote.nopTo, amount: quote.amount, orDate: day, orNumber: "(typed by the clerk)", waiver: item.waiver || auto ? "Waiver" : "", collectedByRole: context.as, originalMas: asCollector ? account.mas : "" }, day);
    const entry: SubmittedCollection = { enrollmentId: account.id, memberId: account.memberId, memberNumber: account.memberNumber, memberName: account.memberName, programId: account.programId, programName: account.programName, ...quote, orDate: day, waiver: item.waiver };
    return { branch, entry, owner: { employeeId: account.masEmployeeId ?? "", name: account.mas } };
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : "cannot be collected."}`);
  }
}

/** One submission per branch and MAS, in the order they first appear. */
function batchRows(context: SubmitContext, entries: Array<ReturnType<typeof batchEntry>>, orc: boolean, auto = false) {
  const { profile, memberMas } = context;
  const batches = new Map<string, { branch: { id: string; name: string }; owner: { employeeId: string; name: string }; entries: SubmittedCollection[] }>();
  for (const { branch, entry, owner } of entries) {
    const key = holderKey(owner.name, branch.id);
    const group = batches.get(key) ?? { branch, owner, entries: [] };
    group.entries.push(entry);
    batches.set(key, group);
  }
  const actor = getEncoder();
  const asCollector = context.as === "Collector";
  return [...batches.values()].map(({ branch, owner, entries: group }) => ({
    submission_id: createReadableId("CSUB"), branch_id: branch.id, branch: branch.name, mas_employee_id: profile.employeeId, mas: profile.name, status: "Submitted",
    entries: group, entry_count: group.length, total_amount: cents(group.reduce((sum, entry) => sum + entry.amount, 0)),
    total_incentive: cents(group.reduce((sum, entry) => sum + entry.incentive, 0)), submitted_at: actor.encodedAt,
    collected_by: context.as, member_mas_employee_id: asCollector ? memberMas?.employeeId ?? (owner.employeeId || null) : null, member_mas: asCollector ? owner.name : null, orc, auto_submitted: auto, ...encodedBy(),
  }));
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
 * of its program, so the page can show the incentive before submitting: their own as MAS; as Collector, those assigned to
 * them or the chosen person's. `pendingIn` names an open submission that already has the account.
 */
export async function myCollectionAccounts(user: SessionUser, options: { collectedBy?: unknown; memberMasEmployeeId?: unknown } = {}) {
  const context = await collectorContext(user, options.collectedBy, options.memberMasEmployeeId);
  const { profile } = context;
  const collector = { isCollector: context.isCollector, masOptions: context.masOptions, collectedBy: context.as, memberMasEmployeeId: context.memberMas?.employeeId ?? "" };
  const today = manilaNow().date;
  const assigned = context.as === "Collector" && !context.memberMas;
  const [data, pending] = await Promise.all([loadAccountData(assigned ? { collectorEmployeeId: profile.employeeId } : { mas: context.memberMas?.name ?? profile.name }), pendingAccounts()]);
  const accounts = data.accounts.flatMap((account) => {
    const branch = profile.branches.find((item) => sameName(item.name, account.branch));
    if (!branch) return [];
    const tiers = tiersForBranch(data.incentives.filter((tier) => tier.programId === account.programId), branch.id);
    const base = {
      id: account.id, memberId: account.memberId, memberNumber: account.memberNumber, memberName: account.memberName, programId: account.programId, programName: account.programName, mas: account.mas,
      branchId: branch.id, branch: branch.name, basePay: account.basePay, flexible: Boolean(account.flexible), maxMonthlyPayment: account.maxMonthlyPayment ?? null, flexibleBasePay: account.flexibleBasePay ?? null, tiers,
      pendingIn: pending.get(account.id) ?? "",
    };
    try {
      const state = accountState(account, data.payments, today);
      return [{ ...base, status: state.status as string, temporarilySuspended: state.temporarilySuspended, suspendedAt: state.suspendedAt, forfeitedAt: state.forfeitedAt,
        nextMonth: state.nextMonth, nextNop: state.nextNop, lastCoveredMonth: state.lastCoveredMonth, unpaidMonths: state.unpaidMonths, latestOrDate: state.latestOrDate,
        blocked: blockedReason(state.status, today) || collectorOnlyAccount(context, account) }];
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
  const list = await withDeadlines(rows);
  // Fidelity is typed by the clerk when saving, on the batch's first collection (app/api/collections/route.ts).
  const ids = list.flatMap((item) => item.collectionIds);
  if (!ids.length) return list;
  const { collections } = schema;
  const added = await getDb().select({ id: collections.collection_id, fidelity: collections.fidelity_amount }).from(collections).where(and(inArray(collections.collection_id, ids), gt(collections.fidelity_amount, 0)));
  const fidelityOf = new Map(added.map((item) => [item.id, item.fidelity ?? 0]));
  return list.map((item) => ({ ...item, fidelity: cents(item.collectionIds.reduce((sum, id) => sum + (fidelityOf.get(id) ?? 0), 0)) }));
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
  const entries = chosen.map((item) => batchEntry(context, data, item, today, orc));

  // All saved or none; the members sent leave the batch kept for the nightly job.
  const batches = batchRows(context, entries, orc);
  await inTransaction(async () => {
    await currentDb().insert(submissions).values(batches);
    await removeFromDraft(profile.employeeId, ids);
  });
  return { ids: batches.map((batch) => batch.submission_id), entryCount: entries.length, collectedBy: context.as, memberMas: memberMas?.name ?? "", batches: batches.map((batch) => ({ branch: batch.branch, memberMas: batch.member_mas ?? "", entryCount: batch.entry_count })) };
}

const draftItems = (row: { entries: unknown } | undefined) => (Array.isArray(row?.entries) ? row.entries as DraftItem[] : []);

/** Keeps `entries` as the person's batch, or removes the row when nothing is left. */
async function writeDraft(employeeId: string, entries: DraftItem[]) {
  if (!entries.length) await currentDb().delete(drafts).where(eq(drafts.employee_id, employeeId));
  else await currentDb().update(drafts).set({ entries, updated_at: new Date().toISOString() }).where(eq(drafts.employee_id, employeeId));
}

async function removeFromDraft(employeeId: string, ids: string[]) {
  const [row] = await currentDb().select({ entries: drafts.entries }).from(drafts).where(eq(drafts.employee_id, employeeId));
  if (row) await writeDraft(employeeId, draftItems(row).filter((item) => !ids.includes(item.enrollmentId)));
}

/** The batch the person is still filling, for any of their devices. */
export async function myCollectionDraft(user: SessionUser) {
  const [row] = await getDb().select().from(drafts).where(eq(drafts.employee_id, user.employeeId));
  return row ? { entries: draftItems(row), collectedBy: row.collected_by, memberMasEmployeeId: text(row.member_mas_employee_id), orc: row.orc } : null;
}

/** Saves the batch as it stands on the page. A member already in it keeps the day they were added; a new one is today's. */
export async function saveCollectionDraft(user: SessionUser, input: { entries?: unknown; collectedBy?: unknown; memberMasEmployeeId?: unknown; orc?: unknown }) {
  if (!user.employeeId) throw new Error("Your sign-in account is not linked to an employee. Ask IT to link it.");
  if (!Array.isArray(input.entries) || input.entries.length > MAX_DRAFT_ENTRIES) throw new Error("The batch has too many members. Submit some first.");
  const [row] = await getDb().select({ entries: drafts.entries }).from(drafts).where(eq(drafts.employee_id, user.employeeId));
  const added = new Map(draftItems(row).map((item) => [item.enrollmentId, item.addedOn]));
  const today = manilaNow().date;
  const entries: DraftItem[] = (input.entries as Array<Record<string, unknown>>).filter((entry) => text(entry?.enrollmentId)).map((entry) => ({
    enrollmentId: text(entry.enrollmentId), months: Number(entry.months) || 1, amount: text(entry.amount), waiver: entry.waiver === true, addedOn: added.get(text(entry.enrollmentId)) ?? today,
  }));
  if (!entries.length) { await getDb().delete(drafts).where(eq(drafts.employee_id, user.employeeId)); return; }
  const values = { collected_by: input.collectedBy === "Collector" ? "Collector" : "MAS", member_mas_employee_id: text(input.memberMasEmployeeId) || null, orc: input.orc === true, entries, updated_at: new Date().toISOString() };
  await getDb().insert(drafts).values({ employee_id: user.employeeId, ...values }).onConflictDoUpdate({ target: drafts.employee_id, set: values });
}

/**
 * Nightly (lib/nightly-jobs.ts): members left in a batch from an earlier day are sent to the clerk as if submitted that
 * day, as of that day, so forgetting neither moves the incentive deadline nor costs the member a Waiver. A member already
 * waiting in a submission, paid since the day added, or no longer on the program is dropped. One that cannot be sent stays in the batch, where the
 * MAS sees why, and is tried again the next night; members added today stay too.
 */
export async function autoSubmitCollectionDrafts() {
  const today = manilaNow().date;
  const rows = (await getDb().select().from(drafts)).filter((row) => draftItems(row).some((item) => item.addedOn < today));
  const result = { batches: 0, members: 0, held: 0, failed: 0 };
  if (!rows.length) return result;
  const ids = rows.flatMap((row) => draftItems(row).map((item) => item.enrollmentId));
  const [pending, data] = await Promise.all([pendingAccounts(), loadAccountData({ enrollmentIds: ids })]);
  for (const row of rows) {
    try {
      const context = await collectorContext({ employeeId: row.employee_id }, row.collected_by, row.member_mas_employee_id);
      const orc = context.as === "Collector" && row.orc;
      const keep: DraftItem[] = [];
      const entries: Array<ReturnType<typeof batchEntry>> = [];
      for (const item of draftItems(row)) {
        if (item.addedOn >= today) { keep.push(item); continue; }
        if (pending.has(item.enrollmentId)) continue;
        try {
          const account = data.accounts.find((candidate) => candidate.id === item.enrollmentId);
          if (!account || accountState(account, data.payments, today).latestOrDate >= item.addedOn) continue;
          entries.push(batchEntry(context, data, { ...item, amount: item.amount.trim() ? Number(item.amount) : null }, item.addedOn, orc, true));
          pending.set(item.enrollmentId, "");
        } catch (error) {
          console.error(`Automatic collection submission: kept in the batch of ${row.employee_id}.`, error);
          keep.push(item); result.held++;
        }
      }
      const batches = entries.length ? batchRows(context, entries, orc, true) : [];
      await inTransaction(async () => {
        if (batches.length) await currentDb().insert(submissions).values(batches);
        await writeDraft(row.employee_id, keep);
      });
      result.batches += batches.length; result.members += entries.length;
    } catch (error) {
      console.error(`Automatic collection submission failed for ${row.employee_id}.`, error);
      result.failed++;
    }
  }
  return result;
}

/** The MAS saw their rejected batches, so the red number for them clears (lib/notifications.ts). */
export async function markRejectionsSeen(user: SessionUser) {
  await getDb().update(submissions).set({ rejection_seen_at: new Date().toISOString() })
    .where(and(eq(submissions.mas_employee_id, user.employeeId), eq(submissions.status, "Rejected"), isNull(submissions.rejection_seen_at)));
}

/** Submissions waiting for the clerk in their branches (submitted, or marked remitted and not yet saved), oldest first. */
export async function listCollectionsForReview(user: SessionUser) {
  const scope = await reviewBranches(user);
  if (scope && !scope.length) return [];
  const waiting = inArray(submissions.status, OPEN);
  const rows = await getDb().select().from(submissions).where(scope ? and(waiting, inArray(submissions.branch_id, scope)) : waiting).orderBy(submissions.row_seq);
  const list = await withDeadlines(rows);
  if (!list.length) return list;
  // The clerk contacts whoever has not handed the cash over.
  const employees = await getEmployees();
  return list.map((item) => ({ ...item, masContact: text(employees.find((employee) => employee.id === item.masEmployeeId)?.contact) }));
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
