import { and, desc, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Clearing (owner's decision, October 8, 2026). The entry clerk checks a MAS's or employee's physical receipts and bank
 * slips, then lists them here. That moment is when the cash was received:
 *   - New Sales and Collections are saved only for an accountable person cleared for that branch on the batch's Date
 *     Remitted, so encoding cannot bypass the check;
 *   - the clearing time decides the incentive deadline (3:00 PM the day after the OR date), however late the entries
 *     are encoded; without a clearing the encoding time is used (lib/remittance-workflow.ts receivedAtOf);
 *   - a clearing stays Open until that person's entries for the day are sent for approval (Encoded), or it is Removed.
 * A person may be cleared again the same day once their earlier clearing is Encoded (a second handover).
 *
 * Progress (owner, October 9, 2026): each line also shows how far that person's entries have got, worked out from the
 * New Sales and Collections it covers (`withProgress`): Waiting for encoding → Waiting for receipt (in My Entries
 * without a receipt photo) → For approval (sent for remittance approval) → Approved (every entry Remitted), or Returned.
 * A line leaves the page after 11:59 PM of its day only once Approved (or Removed); anything unfinished stays listed.
 */
const { clearings } = schema;
const text = (value: unknown) => String(value ?? "").trim();
/** "YYYY-MM-DD HH:MM" in Manila for a stored moment. */
const manilaStamp = (value: string | Date | null | undefined) => { if (!value) return ""; const now = manilaNow(new Date(value)); return `${now.date} ${now.time}`; };

export type ClearingStage = "Waiting for encoding" | "Waiting for receipt" | "For approval" | "Returned" | "Approved" | "Removed";
export type Clearing = {
  id: string; branch: string; employeeId: string; employeeName: string; clearedAt: string; clearedDate: string;
  amount: number | null; notes: string; status: "Open" | "Encoded" | "Removed"; remittanceId: string; closedAt: string; closedReason: string; clearedBy: string;
  /** Where its entries stand (getClearingPage only). */
  stage?: ClearingStage;
  entries?: { total: number; receipt: number; approval: number; returned: number; approved: number };
};
const toClearing = (row: typeof clearings.$inferSelect): Clearing => ({
  id: row.clearing_id, branch: row.branch, employeeId: row.employee_id, employeeName: text(row.employee_name), clearedAt: manilaStamp(row.cleared_at), clearedDate: text(row.cleared_date),
  amount: row.amount ?? null, notes: text(row.notes), status: (row.status as Clearing["status"]) ?? "Open", remittanceId: text(row.remittance_id), closedAt: manilaStamp(row.closed_at),
  closedReason: text(row.closed_reason), clearedBy: text(row.encoded_by_name),
});

/** Days back the Clearing page looks for unfinished lines. */
const UNFINISHED_DAYS = 60;
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

/**
 * Adds each clearing's stage from the entries it covers. An entry (New Sale or Collection of that accountable person
 * and branch) belongs to the latest clearing made on or after its Date Remitted and, when the encoding time is known,
 * no later than it was encoded. The line's stage is its least advanced entry's: Returned, Waiting for receipt,
 * For approval, then Approved.
 */
export async function withProgress(list: Clearing[]): Promise<Clearing[]> {
  const live = list.filter((item) => item.status !== "Removed");
  if (!live.length) return list.map((item) => ({ ...item, stage: item.status === "Removed" ? "Removed" : "Waiting for encoding" }));
  const ids = [...new Set(live.map((item) => item.employeeId))];
  const latest = live.map((item) => item.clearedDate).sort().at(-1)!;
  const earliest = addDays(live.map((item) => item.clearedDate).sort()[0], -UNFINISHED_DAYS);
  const { collections, sales, receipt_photos: photos } = schema;
  const [collectionRows, saleRows, photoRows] = await Promise.all([
    currentDb().select({ id: collections.collection_id, employeeId: collections.accountable_employee_id, branch: collections.branch, dateRemitted: collections.date_remitted, status: collections.remittance_status, encodedAt: collections.encoded_at })
      .from(collections).where(and(inArray(collections.accountable_employee_id, ids), sql`lower(coalesce(${collections.status}, '')) = 'posted'`, gte(collections.date_remitted, earliest), sql`${collections.date_remitted} <= ${latest}`)),
    currentDb().select({ id: sales.sale_id, employeeId: sql<string>`coalesce(${sales.accountable_employee_id}, ${sales.mas_employee_id})`, branch: sales.branch, dateRemitted: sales.date_remitted, status: sales.remittance_status, encodedAt: sales.encoded_at })
      .from(sales).where(and(or(inArray(sales.accountable_employee_id, ids), inArray(sales.mas_employee_id, ids)), gte(sales.date_remitted, earliest), sql`${sales.date_remitted} <= ${latest}`)),
    currentDb().select({ entryIds: photos.entry_ids }).from(photos).where(sql`${photos.uploaded_at} >= ${`${earliest}T00:00:00+08:00`}`),
  ]);
  const photographed = new Set(photoRows.flatMap((row) => text(row.entryIds).split(",").map(text)).filter(Boolean));
  const empty = () => ({ total: 0, receipt: 0, approval: 0, returned: 0, approved: 0 });
  const counts = new Map(live.map((item) => [item.id, empty()]));
  const key = (value: string) => text(value).toLowerCase();
  for (const entry of [...collectionRows, ...saleRows]) {
    const dateRemitted = text(entry.dateRemitted), encodedAt = manilaStamp(entry.encodedAt as string | Date | null);
    const owner = live.filter((item) => item.employeeId === entry.employeeId && key(item.branch) === key(entry.branch ?? "") && item.clearedDate >= dateRemitted && (!encodedAt || item.clearedAt <= encodedAt))
      .sort((a, b) => b.clearedAt.localeCompare(a.clearedAt))[0];
    if (!owner) continue;
    const tally = counts.get(owner.id)!;
    const status = text(entry.status);
    tally.total++;
    if (status === "Remitted") tally.approved++;
    else if (status === "Returned") tally.returned++;
    else if (status === "Outstanding" && !photographed.has(entry.id)) tally.receipt++;
    else tally.approval++;
  }
  return list.map((item) => {
    if (item.status === "Removed") return { ...item, stage: "Removed" as const };
    const entries = counts.get(item.id)!;
    const stage: ClearingStage = !entries.total ? "Waiting for encoding" : entries.returned ? "Returned" : entries.receipt ? "Waiting for receipt" : entries.approval ? "For approval" : "Approved";
    return { ...item, stage, entries };
  });
}

/**
 * The Clearing page: today's clearings, and earlier ones not yet Approved (up to 60 days back), each with its progress;
 * with the branches and their people. An earlier day's line leaves once Approved or Removed.
 */
export async function getClearingPage() {
  const today = manilaNow().date;
  const [rows, branches, employees] = await Promise.all([
    currentDb().select().from(clearings).where(or(eq(clearings.cleared_date, today), and(ne(clearings.status, "Removed"), gte(clearings.cleared_date, addDays(today, -UNFINISHED_DAYS))))).orderBy(desc(clearings.cleared_at)),
    getBranches(), getEmployees(),
  ]);
  const listed = (await withProgress(rows.map(toClearing))).filter((item) => item.clearedDate === today || item.stage !== "Approved");
  return {
    today,
    clearings: listed,
    branches: branches.filter((branch) => branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name })),
    employees: employees.filter((employee) => employee.status.toLowerCase() === "active").map((employee) => ({ id: employee.id, name: employee.name, roles: employee.roles, branchIds: employee.branchIds })),
  };
}

/** Clearings New Sales and Collections can encode for: every Open one, and today's Encoded ones (a second batch). */
export async function getEncodableClearings() {
  const today = manilaNow().date;
  const rows = await currentDb().select().from(clearings)
    .where(or(eq(clearings.status, "Open"), and(eq(clearings.cleared_date, today), eq(clearings.status, "Encoded"))))
    .orderBy(desc(clearings.cleared_at));
  return rows.map(toClearing);
}

/** Lists a MAS or employee as cleared now, for one branch. */
export async function addClearing(input: { branch: string; employeeId: string; amount?: unknown; notes?: unknown }) {
  const branchName = text(input.branch), employeeId = text(input.employeeId), notes = text(input.notes);
  const amountText = text(input.amount), amount = amountText ? Number(amountText) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("The amount must be zero or a positive number.");
  if (notes.length > 300) throw new Error("Notes must be 300 characters or fewer.");
  const [branches, employees] = await Promise.all([getBranches(), getEmployees()]);
  const branch = branches.find((item) => item.name === branchName && item.status === "active");
  const employee = employees.find((item) => item.id === employeeId && item.status.toLowerCase() === "active");
  if (!branch) throw new Error("Choose the branch.");
  if (!employee) throw new Error("Choose an active MAS or employee.");
  if (!employee.branchIds.includes(branch.id)) throw new Error(`${employee.name} is not assigned to ${branch.name}. Add the branch in Employees → Edit first.`);
  const now = new Date(), day = manilaNow(now).date;
  const [open] = await currentDb().select({ id: clearings.clearing_id }).from(clearings)
    .where(and(eq(clearings.employee_id, employee.id), eq(clearings.branch, branch.name), eq(clearings.cleared_date, day), eq(clearings.status, "Open")));
  if (open) throw new Error(`${employee.name} is already cleared for ${branch.name} today and not yet encoded.`);
  const id = createReadableId("CLR");
  await currentDb().insert(clearings).values({
    clearing_id: id, branch: branch.name, employee_id: employee.id, employee_name: employee.name, cleared_at: now.toISOString(), cleared_date: day,
    amount, notes: notes || null, status: "Open", ...encodedBy(),
  });
  return { id, employeeName: employee.name, branch: branch.name, clearedAt: manilaStamp(now) };
}

/** Takes an Open clearing off the list (listed by mistake), with the reason. */
export async function removeClearing(input: { id: string; reason: string }) {
  const id = text(input.id), reason = text(input.reason);
  if (reason.length < 3 || reason.length > 300) throw new Error("Give the reason for removing it (3–300 characters).");
  const updated = await currentDb().update(clearings).set({ status: "Removed", closed_at: new Date().toISOString(), closed_reason: reason })
    .where(and(eq(clearings.clearing_id, id), eq(clearings.status, "Open"))).returning({ id: clearings.clearing_id });
  if (!updated.length) throw new Error("Only an Open clearing can be removed.");
  return { id };
}

/** The same branch, ignoring case and outer spaces. */
const sameBranch = (branch: string) => sql`lower(trim(${clearings.branch})) = ${text(branch).toLowerCase()}`;

/**
 * Clearings that cover a batch of these people, branch and Date Remitted: one made that day (Open, or Encoded for an
 * earlier handover the same day), or one still Open from a later day (cleared today for cash remitted yesterday).
 */
const covering = (employeeIds: string[], branch: string, dateRemitted: string) => and(
  inArray(clearings.employee_id, employeeIds.map(text)), sameBranch(branch), ne(clearings.status, "Removed"),
  or(eq(clearings.cleared_date, text(dateRemitted)), and(eq(clearings.status, "Open"), gt(clearings.cleared_date, text(dateRemitted)))),
);

/** Which of these employees (same name, for example) is cleared for the branch and Date Remitted, or "". */
export async function clearedEmployee(employeeIds: string[], branch: string, dateRemitted: string) {
  const ids = employeeIds.map(text).filter(Boolean);
  if (!ids.length) return "";
  const [row] = await currentDb().select({ id: clearings.employee_id }).from(clearings).where(covering(ids, branch, dateRemitted)).orderBy(desc(clearings.cleared_at)).limit(1);
  return row?.id ?? "";
}

/**
 * Why a batch cannot be saved yet, or "" when its accountable person is cleared for the branch on the Date Remitted
 * (see `covering`). The message says when and where they were cleared instead, so a wrong Date Remitted or branch is
 * easy to spot.
 */
export async function clearingProblem(employeeId: string, employeeName: string, branch: string, dateRemitted: string) {
  // Tests about other rules treat everyone as cleared (scripts/test-encoder-tracking.cjs); the clearing test turns this off.
  if ((globalThis as { dayongClearingNotRequired?: boolean }).dayongClearingNotRequired) return "";
  if (await clearedEmployee([employeeId], branch, dateRemitted)) return "";
  const others = await currentDb().select({ branch: clearings.branch, day: clearings.cleared_date, status: clearings.status }).from(clearings)
    .where(and(eq(clearings.employee_id, text(employeeId)), ne(clearings.status, "Removed"), gte(clearings.cleared_date, manilaNow(new Date(Date.now() - 7 * 86400000)).date)))
    .orderBy(desc(clearings.cleared_at)).limit(3);
  const seen = others.length ? ` They are cleared ${others.map((row) => `for ${row.branch} on ${row.day} (${row.status})`).join(", ")}; check the branch and Date Remitted.` : "";
  return `${employeeName || employeeId} is not in Clearing for ${branch} on ${dateRemitted}.${seen || " Check their receipts and bank slips, list them in Clearing, then encode."}`;
}

/**
 * When the cash of a batch was received: the latest clearing of that person, branch and day at or before `encodedAt`
 * ("YYYY-MM-DD HH:MM"), else their earliest that day; "" when there is none.
 */
export async function clearedAt(employeeId: string, branch: string, day: string, encodedAt = "") {
  const rows = await currentDb().select({ at: clearings.cleared_at }).from(clearings)
    .where(covering([employeeId], branch, day))
    .orderBy(clearings.cleared_at);
  const stamps = rows.map((row) => manilaStamp(row.at)).filter(Boolean);
  if (!stamps.length) return "";
  return (encodedAt ? stamps.filter((stamp) => stamp <= encodedAt).at(-1) : undefined) ?? stamps[0];
}

/** Marks a person's Open clearings covering the branch and day as Encoded once their entries are sent for approval. */
export async function closeClearings(employeeId: string, branch: string, day: string, remittanceId: string) {
  if (!text(employeeId) || !text(day)) return 0;
  const updated = await currentDb().update(clearings).set({ status: "Encoded", remittance_id: remittanceId, closed_at: new Date().toISOString() })
    .where(and(covering([employeeId], branch, day), eq(clearings.status, "Open")))
    .returning({ id: clearings.clearing_id });
  return updated.length;
}

/** Open clearings, for the sidebar number on Clearing. */
export async function countOpenClearings() {
  const [row] = await currentDb().select({ count: sql<number>`count(*)::int` }).from(clearings).where(eq(clearings.status, "Open"));
  return Number(row?.count ?? 0);
}
