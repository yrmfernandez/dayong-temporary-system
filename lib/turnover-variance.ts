import { and, eq, inArray, sql } from "drizzle-orm";

import { currentDb, getDb, schema, type Queryable } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";
import { getEncoder } from "@/lib/encoder-context";
import { manilaNow } from "@/lib/remittance-deadline";
import { TURNOVER_NOTE_MAX } from "@/lib/entry-controls";

export { TURNOVER_NOTE_MAX, varianceLabel } from "@/lib/entry-controls";

/**
 * Turnover short or over (owner, October 29, 2026). A New Sales or Collections batch saves even when its total
 * remittance is not the control total on the MAS's turnover sheet; the difference is recorded here so it is traced and
 * settled instead of blocking the clerk.
 *
 *   difference = control total − total remittance (both include Fidelity; a penalty is separate)
 *   negative: SHORT, the MAS handed over less than the entries need; positive: OVER, more than they need.
 *
 * How it is followed up:
 *   1. The batch's remittance slip records the cash at the turnover sheet amount, so it goes to Discrepancy and cannot
 *      be approved without an explanation of how it was settled (lib/remittance-workflow.ts decideCashRemittance).
 *   2. If the clerk finds the mistake and corrects the entries (a returned batch fixed in My Entries), the next slip
 *      compares the corrected entries with the same turnover total: a match settles it by itself.
 *   3. Open ones are listed in Exceptions → Turnover short or over, with the MAS, clerk, entries and note.
 *
 * In the Entry Clerk's report (owner, October 29, 2026: shown in the report, not carried as a balance): the cash
 * summary has a Turnover short/over line, the difference of the batches the clerk encoded in the period, so Remaining
 * Cash on Hand is the cash really received; and a Turnover settled line, the cash that changed hands to settle one
 * (+ the MAS paid the short, − the overage returned), in the report of the day it was settled. A report cannot be
 * approved in Audits while one of its turnover differences is still open (lib/daily-audit.ts).
 */
const text = (value: unknown) => String(value ?? "").trim();
const cents = (value: number) => Math.round(value * 100);

export type TurnoverVariance = {
  id: string; kind: string; entryIds: string[]; branch: string; mas: string; dateRemitted: string;
  controlTotal: number; systemTotal: number; difference: number; note: string; status: string; remittanceId: string;
  resolution: string; resolvedByName: string; resolvedAt: string; encodedByName: string; encodedByEmployeeId: string; encodedAt: string;
  /** Paid by MAS, Returned to MAS, No cash, or Entries corrected; blank while open. */
  settlement: string; settledCash: number; settledOn: string;
  /** What it does to the cash received: the difference, or nothing when the entries were corrected to match. */
  cashEffect: number;
};

const toVariance = (row: typeof schema.turnover_variances.$inferSelect): TurnoverVariance => ({
  id: row.variance_id, kind: row.kind, entryIds: row.entry_ids ?? [], branch: text(row.branch), mas: text(row.mas), dateRemitted: text(row.date_remitted),
  controlTotal: Number(row.control_total), systemTotal: Number(row.system_total), difference: Number(row.difference), note: text(row.note), status: row.status,
  remittanceId: text(row.remittance_id), resolution: text(row.resolution), resolvedByName: text(row.resolved_by_name), resolvedAt: text(row.resolved_at),
  encodedByName: text(row.encoded_by_name), encodedByEmployeeId: text(row.encoded_by_employee_id), encodedAt: text(row.encoded_at),
  settlement: text(row.settlement), settledCash: Number(row.settled_cash ?? 0), settledOn: text(row.settled_on),
  cashEffect: text(row.settlement) === "Entries corrected" ? 0 : Number(row.difference),
});

/** Records a saved batch's short or over, inside the batch's own transaction. Nothing is recorded when it matches. */
export async function recordTurnoverVariance(input: { kind: "New Sales" | "Collections"; entryIds: string[]; branch: string; mas: string; accountableEmployeeId: string; dateRemitted: string; controlTotal: number; systemTotal: number; note: string }) {
  const difference = (cents(input.controlTotal) - cents(input.systemTotal)) / 100;
  if (!difference || !input.entryIds.length) return null;
  const actor = getEncoder();
  const id = createReadableId("TOV");
  await currentDb().insert(schema.turnover_variances).values({
    variance_id: id, kind: input.kind, entry_ids: input.entryIds, branch: input.branch, mas: input.mas, accountable_employee_id: input.accountableEmployeeId || null,
    date_remitted: input.dateRemitted || null, control_total: input.controlTotal, system_total: input.systemTotal, difference, note: text(input.note).slice(0, TURNOVER_NOTE_MAX) || null,
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  });
  return { id, difference };
}

/** The open variance of a batch, found by any of its entries. */
export async function openVarianceFor(entryIds: string[], db: Queryable = currentDb()) {
  const ids = [...new Set(entryIds.map(text).filter(Boolean))];
  if (!ids.length) return null;
  const [row] = await db.select().from(schema.turnover_variances)
    .where(and(eq(schema.turnover_variances.status, "Open"), sql`${schema.turnover_variances.entry_ids} ?| array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`))
    .orderBy(schema.turnover_variances.row_seq).limit(1);
  return row ? toVariance(row) : null;
}

/** The variance on a slip, open or settled (the Discrepancy breakdown and Remittances show it). */
export async function varianceOfSlip(remittanceId: string, db: Queryable = getDb()) {
  const [row] = await db.select().from(schema.turnover_variances).where(eq(schema.turnover_variances.remittance_id, text(remittanceId))).orderBy(schema.turnover_variances.row_seq).limit(1);
  return row ? toVariance(row) : null;
}

/** Variances of several slips, by slip. */
export async function variancesOfSlips(remittanceIds: string[]) {
  const ids = [...new Set(remittanceIds.map(text).filter(Boolean))];
  if (!ids.length) return new Map<string, TurnoverVariance>();
  const rows = await getDb().select().from(schema.turnover_variances).where(inArray(schema.turnover_variances.remittance_id, ids));
  return new Map(rows.map((row) => [text(row.remittance_id), toVariance(row)]));
}

/**
 * Links the variance to the slip made for its batch, with the difference as it is now: a batch corrected to match the
 * turnover sheet settles it ("Entries corrected"); one corrected only in part keeps the difference that is left.
 */
export async function linkVarianceToSlip(tx: Queryable, variance: TurnoverVariance, remittanceId: string, offset: number) {
  const actor = getEncoder();
  const left = cents(offset) / 100;
  await tx.update(schema.turnover_variances).set(!left
    ? { remittance_id: remittanceId, status: "Resolved", resolution: "Entries corrected: they now match the turnover sheet.", resolved_by_name: actor.name, resolved_at: actor.encodedAt, settlement: "Entries corrected", settled_cash: 0, settled_on: manilaNow().date }
    : { remittance_id: remittanceId, difference: left, system_total: (cents(variance.controlTotal) - cents(left)) / 100 })
    .where(eq(schema.turnover_variances.variance_id, variance.id));
}

/**
 * The slip's decision. Approved settles the variance with the approver's explanation and how it was settled: `cash`
 * means the difference changed hands now (the MAS paid the short, or the overage was returned to them), which goes in
 * the clerk's report of today; otherwise no cash moved (explained). Rejected leaves it open for the next slip.
 */
export async function decideVariance(tx: Queryable, remittanceId: string, decision: "approve" | "reject", reason: string, cash = false) {
  const t = schema.turnover_variances;
  if (decision === "reject") {
    await tx.update(t).set({ remittance_id: null }).where(and(eq(t.remittance_id, remittanceId), eq(t.status, "Open")));
    return;
  }
  const [open] = await tx.select().from(t).where(and(eq(t.remittance_id, remittanceId), eq(t.status, "Open")));
  if (!open) return;
  const actor = getEncoder();
  const difference = Number(open.difference);
  await tx.update(t).set({
    status: "Resolved", resolution: text(reason).slice(0, 500) || "Approved.", resolved_by_name: actor.name, resolved_at: actor.encodedAt,
    settlement: cash ? (difference < 0 ? "Paid by MAS" : "Returned to MAS") : "No cash", settled_cash: cash ? -difference : 0, settled_on: manilaNow().date,
  }).where(eq(t.variance_id, open.variance_id));
}

const manilaDayOf = (value: string) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value)) : "";

/**
 * The clerk's turnover lines for a report: the differences of the batches they encoded in the period (by the Manila
 * day encoded), and the cash that settled one in the period (by the day settled). `branch` "" = every branch.
 */
export async function clerkTurnover(employeeId: string, from: string, to: string, branch = "") {
  const t = schema.turnover_variances;
  const rows = await getDb().select().from(t).where(and(eq(t.encoded_by_employee_id, employeeId),
    sql`(((${t.encoded_at} at time zone 'Asia/Manila')::date between ${from}::date and ${to}::date) or (${t.settled_on} between ${from}::date and ${to}::date and coalesce(${t.settled_cash}, 0) <> 0))`))
    .orderBy(t.row_seq);
  const sameBranch = (value: string) => !branch || text(value).toLowerCase() === branch.trim().toLowerCase();
  const all = rows.map(toVariance).filter((item) => sameBranch(item.branch));
  const encoded = all.filter((item) => { const day = manilaDayOf(item.encodedAt); return day >= from && day <= to; });
  const settled = all.filter((item) => item.settledCash && item.settledOn >= from && item.settledOn <= to);
  return {
    encoded, settled,
    shortOver: encoded.reduce((total, item) => total + cents(item.cashEffect), 0) / 100,
    settledCash: settled.reduce((total, item) => total + cents(item.settledCash), 0) / 100,
    open: encoded.filter((item) => item.status === "Open"),
  };
}

/** Open variances, newest first (Exceptions). */
export async function openVariances(limit = 300) {
  const rows = await getDb().select().from(schema.turnover_variances).where(eq(schema.turnover_variances.status, "Open")).orderBy(sql`${schema.turnover_variances.row_seq} desc`).limit(limit);
  return rows.map(toVariance);
}
