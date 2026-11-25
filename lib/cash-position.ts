import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { getDb, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { cashCountProblem } from "@/lib/cash-count";
import { createReadableId } from "@/lib/readable-id";
import { validDate } from "@/lib/manila-date";
import { CARRY_START, dayBefore } from "@/lib/cash-carry";

/**
 * The real cash an Entry Clerk holds for a branch, day after day (owner, November 24, 2026): "the goal is to know how
 * much really is the cash the company have in weekly, monthly, yearly".
 *
 * - From CARRY_START, a report starts with the cash held at the start of its first day, worked out by the system: the
 *   clerk's latest cash count confirmed by Finance on or before that day, plus every cash in and out since the count.
 *   Before, Cash Beg was typed by hand on each report (owner, October 13, 2026) and often missed.
 * - A cash count is the cash physically counted at the start of a day, recorded by the clerk and confirmed by Finance or
 *   an Administrator: the first on December 1, 2026, and later ones whenever the cash is counted again (the difference
 *   from the system's figure shows then).
 * - From CARRY_START, bank and e-wallet payments are money already in the bank, not cash: they are shown on their own
 *   line, and a Cash Flow record marked non-cash (kept for its details) takes no cash out.
 * - Cash In and Out are the report's own (lib/clerk-report.ts buildClerkReport): Sales and Collection Net in cash,
 *   Fidelity, Penalty, turnover short/over and settlements; expenses, cash forwarded to bank, cash turned over to
 *   Finance. Pending cash typed on a report is not carried (it is encoded later and counted then).
 */
export { CARRY_START, dayBefore };

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: number) => Math.round(value * 100) / 100;
const branchKey = (value: unknown) => text(value).toLowerCase();
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []) as T[];
const { cash_counts: counts } = schema;

export type CashCount = { id: string; employeeId: string; employeeName: string; branch: string; date: string; amount: number; denominations: string; note: string;
  status: "Pending" | "Confirmed" | "Rejected"; decidedBy: string; decidedAt: string; decisionNote: string; recordedBy: string; recordedAt: string };

const toCount = (row: typeof counts.$inferSelect): CashCount => ({
  id: row.count_id, employeeId: row.employee_id, employeeName: text(row.employee_name), branch: row.branch, date: text(row.count_date), amount: Number(row.amount),
  denominations: text(row.denominations), note: text(row.note), status: row.status === "Confirmed" ? "Confirmed" : row.status === "Rejected" ? "Rejected" : "Pending",
  decidedBy: text(row.decided_by_name), decidedAt: text(row.decided_at), decisionNote: text(row.decision_note), recordedBy: text(row.encoded_by_name), recordedAt: text(row.encoded_at),
});

/**
 * The clerk records the cash they hold for a branch at the start of a day (on or after CARRY_START, not in the future),
 * waiting for Finance. A count still pending for the same day and branch is replaced.
 */
export async function recordCashCount(clerk: { employeeId: string; name: string }, input: { branch?: unknown; date?: unknown; amount?: unknown; denominations?: unknown; note?: unknown }, today: string) {
  const branch = text(input.branch), date = text(input.date), amount = round(Number(input.amount)), denominations = text(input.denominations), note = text(input.note).slice(0, 300);
  if (!branch) throw new Error("Choose the branch whose cash you counted.");
  if (!validDate(date) || date < CARRY_START) throw new Error(`Choose the day of the count (from ${CARRY_START}).`);
  if (date > today) throw new Error("The count cannot be for a day after today.");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter the cash counted (zero or more).");
  const problem = cashCountProblem(denominations, amount);
  if (problem) throw new Error(problem);
  const actor = getEncoder();
  return inTransaction(async (tx) => {
    const same = await tx.select().from(counts).where(and(eq(counts.employee_id, clerk.employeeId), eq(counts.count_date, date), sql`lower(${counts.branch}) = ${branchKey(branch)}`, inArray(counts.status, ["Pending", "Confirmed"])));
    if (same.some((row) => row.status === "Confirmed")) throw new Error(`The cash count of ${date} for ${branch} is already confirmed. Record a count on another day to correct it.`);
    for (const row of same) await tx.update(counts).set({ status: "Rejected", decision_note: "Replaced by a new count of the same day", decided_at: actor.encodedAt, decided_by_name: actor.name, decided_by_employee_id: actor.employeeId }).where(eq(counts.count_id, row.count_id));
    const id = createReadableId("CNT");
    await tx.insert(counts).values({ count_id: id, employee_id: clerk.employeeId, employee_name: clerk.name, branch, count_date: date, amount, denominations: denominations || null, note: note || null, status: "Pending",
      encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt });
    return { id };
  });
}

/** Finance or an Administrator confirms a count (it becomes the starting point) or rejects it with a note. Not one's own. */
export async function decideCashCount(id: string, decision: "confirm" | "reject", note: string, by: { employeeId: string; name: string; isAdmin: boolean }) {
  if (decision === "reject" && text(note).length < 3) throw new Error("Say why the count is rejected (the clerk sees it).");
  const actor = getEncoder();
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(counts).where(eq(counts.count_id, text(id))).for("update");
    if (!row) throw new Error("Cash count not found.");
    if (row.status !== "Pending") throw new Error(`This cash count is already ${row.status.toLowerCase()}.`);
    if (row.employee_id === by.employeeId && !by.isAdmin) throw new Error("Another person confirms your own cash count.");
    await tx.update(counts).set({ status: decision === "confirm" ? "Confirmed" : "Rejected", decided_by_employee_id: actor.employeeId, decided_by_name: actor.name, decided_at: actor.encodedAt, decision_note: text(note).slice(0, 300) || null })
      .where(eq(counts.count_id, row.count_id));
    return toCount({ ...row, status: decision === "confirm" ? "Confirmed" : "Rejected" });
  });
}

/** Cash counts, newest first: one clerk's (their report) or every clerk's (Finance), with pending ones first for Finance. */
export async function listCashCounts(employeeId = "", limit = 200): Promise<CashCount[]> {
  const rows = await getDb().select().from(counts).where(employeeId ? eq(counts.employee_id, employeeId) : undefined).orderBy(desc(counts.count_date), desc(counts.row_seq)).limit(limit);
  return rows.map(toCount);
}

/** The latest confirmed count of each branch of the clerk on or before `day` (by lowercase branch). */
export async function confirmedCountsOn(employeeId: string, day: string): Promise<Map<string, CashCount>> {
  const rows = await getDb().select().from(counts).where(and(eq(counts.employee_id, employeeId), eq(counts.status, "Confirmed"), lte(counts.count_date, day)))
    .orderBy(desc(counts.count_date), desc(counts.row_seq));
  const latest = new Map<string, CashCount>();
  for (const row of rows) if (!latest.has(branchKey(row.branch))) latest.set(branchKey(row.branch), toCount(row));
  return latest;
}

/**
 * The cash in from the entries a clerk encoded, by lowercase branch and Manila day encoded, from `from` to `to`: the
 * company share (Net) of cash payments only (the report's rule: a blank method is cash; `cashNames` from Master Data),
 * plus Fidelity and penalty with the batches. One grouped query, so a report can start months after the count.
 */
export async function entryCashByDay(employeeId: string, from: string, to: string, cashNames: Set<string>) {
  if (from > to) return [] as Array<{ branch: string; day: string; cashNet: number; fidelity: number; penalty: number }>;
  const names = [...cashNames].map((name) => name.toLowerCase());
  const isCash = (column: string) => sql`(coalesce(trim(${sql.raw(column)}), '') = '' or lower(trim(${sql.raw(column)})) in (${sql.join(names.map((name) => sql`${name}`), sql`, `)}))`;
  const result = await getDb().execute(sql`
    select branch, day, sum(cash_net)::float8 as "cashNet", sum(fidelity)::float8 as fidelity, sum(penalty)::float8 as penalty from (
      select lower(trim(coalesce(branch, ''))) as branch, ((coalesce(encoded_at, date_created)) at time zone 'Asia/Manila')::date::text as day,
        case when ${isCash("payment_method")} then least(coalesce(remittance_amount, amount_paid, 0), coalesce(amount_paid, 0)) else 0 end as cash_net, coalesce(fidelity_amount, 0) as fidelity, coalesce(penalty_amount, 0) as penalty
      from sales where encoded_by_employee_id = ${employeeId} and ((coalesce(encoded_at, date_created)) at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date
      union all
      select lower(trim(coalesce(branch, ''))), ((coalesce(encoded_at, created_at)) at time zone 'Asia/Manila')::date::text,
        case when ${isCash("remittance_method")} then least(coalesce(remittance_amount, amount_collected, 0), coalesce(amount_collected, 0)) else 0 end, coalesce(fidelity_amount, 0), coalesce(penalty_amount, 0)
      from collections where encoded_by_employee_id = ${employeeId} and lower(coalesce(status, '')) = 'posted'
        and ((coalesce(encoded_at, created_at)) at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date
    ) entries group by branch, day`);
  return rowsOf<{ branch: string; day: string; cashNet: number; fidelity: number; penalty: number }>(result)
    .map((row) => ({ branch: text(row.branch), day: text(row.day), cashNet: Number(row.cashNet) || 0, fidelity: Number(row.fidelity) || 0, penalty: Number(row.penalty) || 0 }));
}
