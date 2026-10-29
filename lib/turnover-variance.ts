import { and, eq, inArray, sql } from "drizzle-orm";

import { currentDb, getDb, schema, type Queryable } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";
import { getEncoder } from "@/lib/encoder-context";
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
 */
const text = (value: unknown) => String(value ?? "").trim();
const cents = (value: number) => Math.round(value * 100);

export type TurnoverVariance = {
  id: string; kind: string; entryIds: string[]; branch: string; mas: string; dateRemitted: string;
  controlTotal: number; systemTotal: number; difference: number; note: string; status: string; remittanceId: string;
  resolution: string; resolvedByName: string; resolvedAt: string; encodedByName: string; encodedAt: string;
};

const toVariance = (row: typeof schema.turnover_variances.$inferSelect): TurnoverVariance => ({
  id: row.variance_id, kind: row.kind, entryIds: row.entry_ids ?? [], branch: text(row.branch), mas: text(row.mas), dateRemitted: text(row.date_remitted),
  controlTotal: Number(row.control_total), systemTotal: Number(row.system_total), difference: Number(row.difference), note: text(row.note), status: row.status,
  remittanceId: text(row.remittance_id), resolution: text(row.resolution), resolvedByName: text(row.resolved_by_name), resolvedAt: text(row.resolved_at),
  encodedByName: text(row.encoded_by_name), encodedAt: text(row.encoded_at),
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

/** Links the variance to the slip made for its batch. A batch corrected to match the turnover sheet settles it. */
export async function linkVarianceToSlip(tx: Queryable, varianceId: string, remittanceId: string, offset: number) {
  const settled = cents(offset) === 0;
  const actor = getEncoder();
  await tx.update(schema.turnover_variances).set(settled
    ? { remittance_id: remittanceId, status: "Resolved", resolution: "Entries corrected: they now match the turnover sheet.", resolved_by_name: actor.name, resolved_at: actor.encodedAt }
    : { remittance_id: remittanceId })
    .where(eq(schema.turnover_variances.variance_id, varianceId));
}

/** The slip's decision: approved settles the variance with the approver's explanation; rejected leaves it open for the next slip. */
export async function decideVariance(tx: Queryable, remittanceId: string, decision: "approve" | "reject", reason: string) {
  const actor = getEncoder();
  await tx.update(schema.turnover_variances).set(decision === "approve"
    ? { status: "Resolved", resolution: text(reason).slice(0, 500) || "Approved.", resolved_by_name: actor.name, resolved_at: actor.encodedAt }
    : { remittance_id: null })
    .where(and(eq(schema.turnover_variances.remittance_id, remittanceId), eq(schema.turnover_variances.status, "Open")));
}

/** Open variances, newest first (Exceptions). */
export async function openVariances(limit = 300) {
  const rows = await getDb().select().from(schema.turnover_variances).where(eq(schema.turnover_variances.status, "Open")).orderBy(sql`${schema.turnover_variances.row_seq} desc`).limit(limit);
  return rows.map(toVariance);
}
