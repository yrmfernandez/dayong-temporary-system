import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb, encodedBy, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Notices to Explain (NTE). A notice is in force for 90 days from the date issued; an employee with 3 or more in force
 * at once is subject to suspension. Withdrawn notices (issued by mistake) no longer count.
 * The employee sees their own notices in My Notices (October 10, 2026): they confirm receipt, and while a notice is in
 * force they write (and may revise) their explanation, which administrators read in the Employees page.
 */
export const NTE_DAYS = 90;
export const SUSPENSION_THRESHOLD = 3;
const notices = schema.notices_to_explain;
const text = (value: unknown) => String(value ?? "").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type Nte = { id: string; employeeId: string; employeeName: string; issuedOn: string; expiresOn: string; reason: string; details: string; status: "Active" | "Expired" | "Withdrawn"; withdrawnReason: string; issuedBy: string;
  acknowledgedAt: string; explanation: string; explainedAt: string };
export const EXPLANATION_MAX = 5000;

/** Every notice with its standing today, and per employee the notices in force and whether they are subject to suspension. */
const toNte = (row: typeof notices.$inferSelect, today: string, names: Map<string, string>): Nte => ({
  id: row.nte_id, employeeId: row.employee_id, employeeName: names.get(row.employee_id) ?? row.employee_id, issuedOn: row.issued_on, expiresOn: row.expires_on,
  reason: row.reason, details: text(row.details), status: row.status === "Withdrawn" ? "Withdrawn" : row.expires_on < today ? "Expired" : "Active",
  withdrawnReason: text(row.withdrawn_reason), issuedBy: text(row.encoded_by_name),
  acknowledgedAt: text(row.acknowledged_at), explanation: text(row.explanation), explainedAt: text(row.explained_at),
});

export async function listNtes() {
  const today = manilaNow().date;
  const [rows, employees] = await Promise.all([getDb().select().from(notices).orderBy(desc(notices.issued_on), desc(notices.row_seq)), getEmployees()]);
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  const list: Nte[] = rows.map((row) => toNte(row, today, names));
  const inForce = new Map<string, Nte[]>();
  for (const nte of list) if (nte.status === "Active") inForce.set(nte.employeeId, [...(inForce.get(nte.employeeId) ?? []), nte]);
  const standing = [...inForce].map(([employeeId, active]) => ({
    employeeId, employeeName: names.get(employeeId) ?? employeeId, active: active.length,
    subjectToSuspension: active.length >= SUSPENSION_THRESHOLD,
    // The earliest expiry is when the count next drops.
    nextExpiry: active.map((nte) => nte.expiresOn).sort()[0] ?? "",
  })).sort((a, b) => b.active - a.active || a.employeeName.localeCompare(b.employeeName));
  return { notices: list, standing, today, days: NTE_DAYS, threshold: SUSPENSION_THRESHOLD };
}

export async function issueNte(input: Record<string, unknown>) {
  const employeeId = text(input.employeeId), issuedOn = text(input.issuedOn) || manilaNow().date, reason = text(input.reason), details = text(input.details);
  if (!employeeId) throw new Error("Choose the employee.");
  if (!validDate(issuedOn) || issuedOn > manilaNow().date) throw new Error("Enter a valid date issued, today or earlier.");
  if (reason.length < 3 || reason.length > 200) throw new Error("Give the reason for the notice (3 to 200 characters).");
  if (details.length > 2000) throw new Error("The details must be 2,000 characters or fewer.");
  if (!(await getEmployees()).some((employee) => employee.id === employeeId)) throw new Error("Employee not found.");
  const id = createReadableId("NTE");
  await getDb().insert(notices).values({ nte_id: id, employee_id: employeeId, issued_on: issuedOn, expires_on: addDays(issuedOn, NTE_DAYS), reason, details: details || null, status: "Active", ...encodedBy() });
  return { id };
}

/** Withdraws a notice issued by mistake; it stays on record but no longer counts. */
export async function withdrawNte(id: string, reason: string) {
  if (text(reason).length < 3) throw new Error("Give the reason for withdrawing the notice (at least 3 characters).");
  const updated = await getDb().update(notices).set({ status: "Withdrawn", withdrawn_reason: text(reason) }).where(and(eq(notices.nte_id, text(id)), eq(notices.status, "Active"))).returning({ id: notices.nte_id });
  if (!updated.length) throw new Error("Notice not found or already withdrawn.");
  return { id };
}

/** The signed-in employee's own notices (My Notices), newest first, and how many in force count against them. */
export async function listMyNtes(employeeId: string) {
  const today = manilaNow().date;
  const rows = employeeId ? await getDb().select().from(notices).where(eq(notices.employee_id, employeeId)).orderBy(desc(notices.issued_on), desc(notices.row_seq)) : [];
  const list = rows.map((row) => toNte(row, today, new Map()));
  return { notices: list, active: list.filter((nte) => nte.status === "Active").length, today, days: NTE_DAYS, threshold: SUSPENSION_THRESHOLD, explanationMax: EXPLANATION_MAX };
}

/** The employee confirms they received the notice (the first time they open it in My Notices). */
export async function acknowledgeNte(id: string, employeeId: string) {
  const updated = await getDb().update(notices).set({ acknowledged_at: sql`now()` })
    .where(and(eq(notices.nte_id, text(id)), eq(notices.employee_id, employeeId), isNull(notices.acknowledged_at))).returning({ id: notices.nte_id });
  return { id, changed: updated.length > 0 };
}

/** The employee's written explanation; it can be revised while the notice is in force. Saving it also confirms receipt. */
export async function explainNte(id: string, employeeId: string, explanation: string) {
  const reply = text(explanation);
  if (reply.length < 3) throw new Error("Write your explanation (at least 3 characters).");
  if (reply.length > EXPLANATION_MAX) throw new Error(`Your explanation must be ${EXPLANATION_MAX.toLocaleString("en-US")} characters or fewer.`);
  const updated = await getDb().update(notices).set({ explanation: reply, explained_at: sql`now()`, acknowledged_at: sql`coalesce(${notices.acknowledged_at}, now())` })
    .where(and(eq(notices.nte_id, text(id)), eq(notices.employee_id, employeeId), eq(notices.status, "Active"), sql`${notices.expires_on} >= ${manilaNow().date}::date`))
    .returning({ id: notices.nte_id });
  if (!updated.length) throw new Error("This notice is not yours, or it is no longer in force (expired or withdrawn).");
  return { id };
}
