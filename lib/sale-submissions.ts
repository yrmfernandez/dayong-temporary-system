import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import { isAdministratorRole } from "@/lib/access-control";
import type { SessionUser } from "@/lib/auth";
import { addClearing } from "@/lib/clearing";
import { coveredKinds, type ClearingCovers } from "@/lib/clearing-kinds";
import { currentDb, encodedBy, getDb, inTransaction, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getEncoder } from "@/lib/encoder-context";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";
import { incentiveDeadline, manilaNow } from "@/lib/remittance-deadline";
import { loadWorkCalendar } from "@/lib/work-calendar";

/**
 * New Sales submitted by a MAS (owner's decision 2026-10-06). The MAS fills only the sale cards on MAS New Sales; the
 * branch and MAS are their own and the Date Enrolled is the day they submit. An Entry Clerk assigned to that branch
 * (administrators: every branch) reviews it on New Sales → Submitted by MAS, adds the batch details (Date Remitted,
 * control total, Fidelity, penalty) and saves it through the normal New Sales save, which marks it Saved in the same
 * transaction.
 *
 * Review, Reject and Mark remitted work as for collections (lib/collection-submissions.ts; owner, November 3, 2026). Once
 * submitted only the clerk changes it: the clerk corrects the cards on the form and saves; the MAS can no longer edit it,
 * and it is not sent back for the MAS to fix. **Mark remitted**: when the MAS hands the cash over, the clerk records a
 * Clearing for the MAS (New Sales) at that moment, or links today's clearing when it is the same cash; the batch is then
 * saved under that clearing, so its time decides the incentive, however late the details are typed. **Reject** (only
 * before Mark remitted) is for a batch that should not be saved at all, with the reason the MAS sees; the MAS can submit
 * those sales again. A submission returned before November 3, 2026 can still be fixed and submitted again by the MAS.
 */
const submissions = schema.sale_submissions;
export const MAX_SUBMISSION_SALES = 20;
const MAX_SUBMISSION_BYTES = 300_000;
const text = (value: unknown) => String(value ?? "").trim();
/** Waiting for the clerk's save: just submitted, or marked remitted with the details still to type. */
const OPEN = ["Submitted", "Remitted"];
const stamp = (value: string | null | undefined) => { if (!value) return ""; const at = manilaNow(new Date(value)); return `${at.date} ${at.time}`; };

/** One sale card as the New Sales form keeps it (lib/types.ts NewSale); only the parts read here are typed. */
type SaleCard = { id?: string; orDate?: string; program?: { dateEnrolled?: string; branch?: string; mas?: string; amountPaid?: number | string } & Record<string, unknown> } & Record<string, unknown>;
export type SaleSubmission = {
  id: string; branchId: string; branch: string; masEmployeeId: string; mas: string; status: "Submitted" | "Remitted" | "Rejected" | "Returned" | "Saved";
  sales: SaleCard[]; saleCount: number; totalAmount: number; submittedAt: string; returnReason: string; reviewedByName: string; reviewedAt: string; saleIds: string[];
  /** 3:00 PM the next working day after the earliest application date: the cash handed over by then keeps the incentive. */
  incentiveDeadline: string;
  /** Marked remitted: the clearing recorded for it, when ("YYYY-MM-DD HH:MM", Manila) and by whom. */
  clearingId: string; remittedAt: string; remittedByName: string;
  /** Rejected: the MAS has seen it, so it no longer counts on the sidebar. */
  rejectionSeen: boolean;
};

const statusOf = (value: string): SaleSubmission["status"] =>
  value === "Saved" || value === "Remitted" || value === "Rejected" || value === "Returned" ? value : "Submitted";

const toSubmission = (row: typeof submissions.$inferSelect, deadline = ""): SaleSubmission => ({
  id: row.submission_id, branchId: row.branch_id, branch: row.branch, masEmployeeId: row.mas_employee_id, mas: row.mas,
  status: statusOf(row.status),
  sales: Array.isArray(row.sales) ? row.sales as SaleCard[] : [], saleCount: row.sale_count, totalAmount: row.total_amount,
  submittedAt: row.submitted_at, returnReason: text(row.return_reason), reviewedByName: text(row.reviewed_by_name), reviewedAt: row.reviewed_at ?? "",
  saleIds: text(row.sale_ids).split(",").map(text).filter(Boolean), incentiveDeadline: deadline,
  clearingId: text(row.clearing_id), remittedAt: stamp(row.remitted_at), remittedByName: text(row.remitted_by_name),
  rejectionSeen: Boolean(row.rejection_seen_at),
});

/** Adds each submission's incentive deadline, from its earliest application date and its branch's working days. */
async function withDeadlines(rows: Array<typeof submissions.$inferSelect>) {
  const calendars = new Map<string, Awaited<ReturnType<typeof loadWorkCalendar>>>();
  const result: SaleSubmission[] = [];
  for (const row of rows) {
    if (!calendars.has(row.branch)) calendars.set(row.branch, await loadWorkCalendar(row.branch));
    const first = toSubmission(row).sales.map((sale) => text(sale.orDate)).filter(Boolean).sort()[0] ?? "";
    result.push(toSubmission(row, first ? incentiveDeadline(first, calendars.get(row.branch)) : ""));
  }
  return result;
}

/** The signed-in MAS: their employee record and the active branches they are assigned to. */
export async function masProfile(user: Pick<SessionUser, "employeeId">) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === user.employeeId);
  if (!employee) throw new Error("Your sign-in account is not linked to an employee. Ask IT to link it.");
  const assigned = branches.filter((branch) => employee.branchIds.includes(branch.id) && branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name }));
  return { employeeId: employee.id, name: employee.name, branches: assigned };
}

/** The MAS saw their rejected batches, so the red number for them clears (lib/notifications.ts). */
export async function markRejectionsSeen(user: SessionUser) {
  await getDb().update(submissions).set({ rejection_seen_at: new Date().toISOString() })
    .where(and(eq(submissions.mas_employee_id, user.employeeId), eq(submissions.status, "Rejected"), isNull(submissions.rejection_seen_at)));
}

/** The MAS's own submissions, newest first. */
export async function listMySubmissions(user: SessionUser) {
  const rows = await getDb().select().from(submissions).where(eq(submissions.mas_employee_id, user.employeeId)).orderBy(desc(submissions.row_seq)).limit(50);
  return withDeadlines(rows);
}

/**
 * Saves a MAS's sale cards as a new submission, or submits again one returned before November 3, 2026. Each card's
 * Date Enrolled is the submission day, and its branch and MAS are the submitter's. The clerk checks and corrects every detail when saving.
 */
export async function submitSales(user: SessionUser, input: { submissionId?: unknown; branchId?: unknown; sales?: unknown }) {
  const profile = await masProfile(user);
  const branch = profile.branches.find((item) => item.id === text(input.branchId)) ?? (profile.branches.length === 1 && !text(input.branchId) ? profile.branches[0] : undefined);
  if (!branch) throw new Error(profile.branches.length ? "Choose one of your branches." : "You are not assigned to an active branch. Ask HR to assign you.");
  if (!Array.isArray(input.sales) || !input.sales.length) throw new Error("Add at least one sale.");
  if (input.sales.length > MAX_SUBMISSION_SALES) throw new Error(`Submit at most ${MAX_SUBMISSION_SALES} sales at a time.`);
  if (JSON.stringify(input.sales).length > MAX_SUBMISSION_BYTES) throw new Error("The submission is too large. Submit fewer sales at a time.");
  const today = manilaNow().date;
  const sales = (input.sales as SaleCard[]).map((sale) => {
    if (!sale || typeof sale !== "object" || !sale.program || typeof sale.program !== "object") throw new Error("A sale card is incomplete. Reload the page and try again.");
    return { ...sale, program: { ...sale.program, dateEnrolled: today, branch: branch.name, mas: profile.name } };
  });
  const totalAmount = Math.round(sales.reduce((sum, sale) => sum + (Number(sale.program.amountPaid) || 0), 0) * 100) / 100;
  const actor = getEncoder();
  const values = { branch_id: branch.id, branch: branch.name, mas_employee_id: profile.employeeId, mas: profile.name, status: "Submitted", sales, sale_count: sales.length, total_amount: totalAmount, submitted_at: actor.encodedAt, return_reason: null, reviewed_by_employee_id: null, reviewed_by_name: null, reviewed_at: null };
  const id = text(input.submissionId);
  if (id) {
    const updated = await getDb().update(submissions).set(values)
      .where(and(eq(submissions.submission_id, id), eq(submissions.mas_employee_id, profile.employeeId), eq(submissions.status, "Returned")))
      .returning({ id: submissions.submission_id });
    if (!updated.length) throw new Error("This submission is with the clerk, so only the clerk can change it now. Tell the clerk what needs fixing.");
    return { id, saleCount: sales.length };
  }
  const newId = createReadableId("SUB");
  await getDb().insert(submissions).values({ submission_id: newId, ...values, ...encodedBy() });
  return { id: newId, saleCount: sales.length };
}

/** Branch IDs whose submissions this user reviews; null means every branch (administrators). */
export async function reviewBranches(user: SessionUser) {
  if (user.roleNames.some(isAdministratorRole)) return null;
  const employee = (await getEmployees()).find((item) => item.id === user.employeeId);
  return employee?.branchIds ?? [];
}

/** Submissions waiting for the clerk in their branches (submitted, or marked remitted and not yet saved), oldest first. */
export async function listForReview(user: SessionUser) {
  const scope = await reviewBranches(user);
  if (scope && !scope.length) return [];
  const waiting = inArray(submissions.status, OPEN);
  const rows = await getDb().select().from(submissions).where(scope ? and(waiting, inArray(submissions.branch_id, scope)) : waiting).orderBy(submissions.row_seq);
  return withDeadlines(rows);
}

/** One submission the clerk may act on: found and in one of their branches. */
async function clerkRow(user: SessionUser, id: string) {
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  return row;
}

const closedMessage = (status: string) => status === "Saved" ? "This MAS submission was already saved." : status === "Rejected" ? "This MAS submission was rejected." : "This MAS submission was returned to the MAS.";

/** A submission the clerk may save now, matching the batch's branch and MAS (and its handover once marked remitted); throws otherwise. */
export async function reviewableSubmission(user: SessionUser, id: string, branch: string, mas: string, clearingId = "") {
  const row = await clerkRow(user, id);
  if (!OPEN.includes(row.status)) throw new Error(closedMessage(row.status));
  if (row.branch !== text(branch) || row.mas !== text(mas)) throw new Error(`This MAS submission is for ${row.branch}, ${row.mas}. Keep that branch and MAS.`);
  // Marked remitted: saved under the clearing recorded then, whose time decides the incentive.
  if (row.clearing_id && row.clearing_id !== text(clearingId)) throw new Error(`This batch was marked remitted at ${stamp(row.remitted_at).slice(11)}. Open it again from Submitted by MAS to save it under that handover.`);
  return toSubmission(row);
}

/**
 * The clerk marks a submitted batch remitted the moment the MAS hands the cash over. `handover`: "" records a new
 * clearing now unless the MAS was already cleared for New Sales today (then AlreadyClearedError asks which it is);
 * "same" links today's latest clearing (the same cash); "new" records a new clearing for a second handover today.
 */
export async function markSaleSubmissionRemitted(user: SessionUser, id: string, handover: "" | "same" | "new" = "") {
  const row = await clerkRow(user, id);
  if (row.status !== "Submitted") throw new Error(row.status === "Remitted" ? "This batch is already marked remitted." : closedMessage(row.status));
  const actor = getEncoder();
  return inTransaction(async () => {
    let clearingId = "", remittedAt = new Date().toISOString();
    if (handover === "same") {
      const { clearings } = schema;
      const today = await currentDb().select({ id: clearings.clearing_id, at: clearings.cleared_at, covers: clearings.covers }).from(clearings)
        .where(and(eq(clearings.employee_id, row.mas_employee_id), eq(clearings.branch, row.branch), eq(clearings.cleared_date, manilaNow().date), ne(clearings.status, "Removed")))
        .orderBy(desc(clearings.cleared_at));
      const match = today.find((item) => coveredKinds((text(item.covers) || "Both") as ClearingCovers).includes("New Sales"));
      if (!match) throw new Error(`${row.mas} has no New Sales clearing today to use. Mark it remitted as a new handover.`);
      clearingId = match.id; remittedAt = match.at;
    } else {
      const cleared = await addClearing({ branch: row.branch, employeeId: row.mas_employee_id, covers: "New Sales", notes: `MAS batch ${row.submission_id} (Submit New Sales)`, newHandover: handover === "new" });
      clearingId = cleared.id;
    }
    const updated = await currentDb().update(submissions).set({ status: "Remitted", clearing_id: clearingId, remitted_at: remittedAt, remitted_by_name: actor.name })
      .where(and(eq(submissions.submission_id, row.submission_id), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
    if (!updated.length) throw new Error("This MAS submission was just marked, saved or rejected by someone else.");
    return { id: row.submission_id, mas: row.mas, remittedAt: stamp(remittedAt) };
  });
}

/** Marks a submission Saved with its sale IDs. Call inside the New Sales transaction: a submission saved twice rolls back. */
export async function markSubmissionSaved(id: string, saleIds: string[]) {
  const actor = getEncoder();
  const updated = await currentDb().update(submissions).set({ status: "Saved", sale_ids: saleIds.join(","), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, text(id)), inArray(submissions.status, OPEN))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was just saved or rejected by someone else. Nothing was saved.");
}

/**
 * The clerk rejects a batch that should not be saved at all (for example the MAS never remitted the cash, or the members
 * did not enroll), with the reason the MAS sees. Mistakes in a batch are corrected on the form instead.
 */
export async function rejectSaleSubmission(user: SessionUser, id: string, reason: string) {
  if (text(reason).length < 3) throw new Error("Give the reason for rejecting it (at least 3 characters).");
  const row = await clerkRow(user, id);
  if (row.status === "Remitted") throw new Error("This batch is marked remitted: the office has the cash. Review it, correct what is wrong and save it.");
  const actor = getEncoder();
  const updated = await getDb().update(submissions).set({ status: "Rejected", return_reason: text(reason).slice(0, 500), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, row.submission_id), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was already saved or rejected.");
  return { id: row.submission_id };
}
