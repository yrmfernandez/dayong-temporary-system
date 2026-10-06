import { and, desc, eq, inArray } from "drizzle-orm";

import { isAdministratorRole } from "@/lib/access-control";
import type { SessionUser } from "@/lib/auth";
import { currentDb, encodedBy, getDb, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getEncoder } from "@/lib/encoder-context";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * New Sales submitted by a MAS (owner's decision 2026-10-06). The MAS fills only the sale cards on MAS New Sales; the
 * branch and MAS are their own and the Date Enrolled is the day they submit. An Entry Clerk assigned to that branch
 * (administrators: every branch) reviews it on New Sales → Submitted by MAS, adds the batch details (Date Remitted,
 * control total, Fidelity, penalty) and saves it through the normal New Sales save, which marks it Saved in the same
 * transaction; or returns it to the MAS with a reason, and the MAS edits and submits it again.
 */
const submissions = schema.sale_submissions;
export const MAX_SUBMISSION_SALES = 20;
const MAX_SUBMISSION_BYTES = 300_000;
const text = (value: unknown) => String(value ?? "").trim();

/** One sale card as the New Sales form keeps it (lib/types.ts NewSale); only the parts read here are typed. */
type SaleCard = { id?: string; program?: { dateEnrolled?: string; branch?: string; mas?: string; amountPaid?: number | string } & Record<string, unknown> } & Record<string, unknown>;
export type SaleSubmission = {
  id: string; branchId: string; branch: string; masEmployeeId: string; mas: string; status: "Submitted" | "Returned" | "Saved";
  sales: SaleCard[]; saleCount: number; totalAmount: number; submittedAt: string; returnReason: string; reviewedByName: string; reviewedAt: string; saleIds: string[];
};

const toSubmission = (row: typeof submissions.$inferSelect): SaleSubmission => ({
  id: row.submission_id, branchId: row.branch_id, branch: row.branch, masEmployeeId: row.mas_employee_id, mas: row.mas,
  status: row.status === "Saved" ? "Saved" : row.status === "Returned" ? "Returned" : "Submitted",
  sales: Array.isArray(row.sales) ? row.sales as SaleCard[] : [], saleCount: row.sale_count, totalAmount: row.total_amount,
  submittedAt: row.submitted_at, returnReason: text(row.return_reason), reviewedByName: text(row.reviewed_by_name), reviewedAt: row.reviewed_at ?? "",
  saleIds: text(row.sale_ids).split(",").map(text).filter(Boolean),
});

/** The signed-in MAS: their employee record and the active branches they are assigned to. */
export async function masProfile(user: SessionUser) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === user.employeeId);
  if (!employee) throw new Error("Your sign-in account is not linked to an employee. Ask IT to link it.");
  const assigned = branches.filter((branch) => employee.branchIds.includes(branch.id) && branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name }));
  return { employeeId: employee.id, name: employee.name, branches: assigned };
}

/** The MAS's own submissions, newest first. */
export async function listMySubmissions(user: SessionUser) {
  const rows = await getDb().select().from(submissions).where(eq(submissions.mas_employee_id, user.employeeId)).orderBy(desc(submissions.row_seq)).limit(50);
  return rows.map(toSubmission);
}

/**
 * Saves a MAS's sale cards as a submission, or updates one still waiting or returned. Each card's Date Enrolled is the
 * submission day, and its branch and MAS are the submitter's. The clerk checks every detail again when saving.
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
      .where(and(eq(submissions.submission_id, id), eq(submissions.mas_employee_id, profile.employeeId), inArray(submissions.status, ["Submitted", "Returned"])))
      .returning({ id: submissions.submission_id });
    if (!updated.length) throw new Error("This submission was already saved by the clerk, so it can no longer be changed.");
    return { id, saleCount: sales.length };
  }
  const newId = createReadableId("SUB");
  await getDb().insert(submissions).values({ submission_id: newId, ...values, ...encodedBy() });
  return { id: newId, saleCount: sales.length };
}

/** Branch IDs whose submissions this user reviews; null means every branch (administrators). */
async function reviewBranches(user: SessionUser) {
  if (user.roleNames.some(isAdministratorRole)) return null;
  const employee = (await getEmployees()).find((item) => item.id === user.employeeId);
  return employee?.branchIds ?? [];
}

/** Submissions waiting for review in the clerk's branches, oldest first. */
export async function listForReview(user: SessionUser) {
  const scope = await reviewBranches(user);
  if (scope && !scope.length) return [];
  const waiting = eq(submissions.status, "Submitted");
  const rows = await getDb().select().from(submissions).where(scope ? and(waiting, inArray(submissions.branch_id, scope)) : waiting).orderBy(submissions.row_seq);
  return rows.map(toSubmission);
}

/** A submission the clerk may save now, matching the batch's branch and MAS; throws otherwise. */
export async function reviewableSubmission(user: SessionUser, id: string, branch: string, mas: string) {
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  if (row.status !== "Submitted") throw new Error(row.status === "Saved" ? "This MAS submission was already saved." : "This MAS submission was returned to the MAS.");
  if (row.branch !== text(branch) || row.mas !== text(mas)) throw new Error(`This MAS submission is for ${row.branch}, ${row.mas}. Keep that branch and MAS.`);
  return toSubmission(row);
}

/** Marks a submission Saved with its sale IDs. Call inside the New Sales transaction: a submission saved twice rolls back. */
export async function markSubmissionSaved(id: string, saleIds: string[]) {
  const actor = getEncoder();
  const updated = await currentDb().update(submissions).set({ status: "Saved", sale_ids: saleIds.join(","), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, text(id)), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was just saved or returned by someone else. Nothing was saved.");
}

/** The clerk sends a submission back to the MAS with what to fix. */
export async function returnSubmission(user: SessionUser, id: string, reason: string) {
  if (text(reason).length < 3) throw new Error("Tell the MAS what to fix (at least 3 characters).");
  const [row] = await getDb().select().from(submissions).where(eq(submissions.submission_id, text(id)));
  if (!row) throw new Error("The MAS submission was not found.");
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(row.branch_id)) throw new Error("This MAS submission belongs to a branch you are not assigned to.");
  const actor = getEncoder();
  const updated = await getDb().update(submissions).set({ status: "Returned", return_reason: text(reason).slice(0, 500), reviewed_by_employee_id: actor.employeeId, reviewed_by_name: actor.name, reviewed_at: actor.encodedAt })
    .where(and(eq(submissions.submission_id, row.submission_id), eq(submissions.status, "Submitted"))).returning({ id: submissions.submission_id });
  if (!updated.length) throw new Error("This MAS submission was already saved or returned.");
  return { id: row.submission_id };
}
