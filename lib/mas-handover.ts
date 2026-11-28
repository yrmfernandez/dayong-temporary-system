import { and, eq, inArray, sql } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth";
import { addClearing, type ClearingCovers } from "@/lib/clearing";
import { coveredKinds } from "@/lib/clearing-kinds";
import { addDeposit } from "@/lib/clerk-cash";
import { listCollectionsForReview } from "@/lib/collection-submissions";
import { currentDb, getDb, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { cleanHandoverLines, handoverBatchMethod, handoverCountOn, handoverReceived, handoverText, handoverVarianceNote, HANDOVER_NOTE_MAX, HANDOVER_NOTE_MIN, mergeHandoverLines, storedHandoverLines, type HandoverLine, type HandoverMethod } from "@/lib/handover-rules";
import { toCents } from "@/lib/money";
import { calculateSaleIncentive, tiersForBranch } from "@/lib/remittance";
import { manilaNow } from "@/lib/remittance-deadline";
import { getPaymentMethods } from "@/lib/remittance-methods";
import { listForReview, reviewBranches } from "@/lib/sale-submissions";
import { recordTurnoverVariance } from "@/lib/turnover-variance";

/**
 * One handover per Mark remitted (owner, November 28, 2026; from December 1, 2026). The rules are in
 * lib/handover-rules.ts. Before, Mark remitted was pressed on New Sales and again on Collections: the second made its
 * own clearing at a later time (an incentive could be forfeited for cash received in time) and each batch was counted on
 * its own. Now Mark remitted on either page opens one window for every batch the MAS is waiting to remit in the branch:
 *
 *   1. the batches ticked are marked remitted together under one clearing (covers both kinds), at one time;
 *   2. how it was remitted (one line per method) and the cash counted are kept on that clearing (handover_lines);
 *   3. the batches are then saved as usual, without a cash count or method of their own (handoverForSave);
 *   4. when the last of them is saved, the short or over of the whole handover is worked out from the entries saved
 *      under it and recorded once, on that last batch (settleHandover), so its slip goes to Discrepancy as today.
 */
const text = (value: unknown) => String(value ?? "").trim();
const manilaStamp = (value: string | Date | null | undefined) => { if (!value) return ""; const now = manilaNow(new Date(value)); return `${now.date} ${now.time}`; };
const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
const rowsOf = <T>(result: unknown) => (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];

export type HandoverBatch = {
  kind: "New Sales" | "Collections"; id: string; count: number; collected: number; incentive: number;
  /** What the MAS should hand over for it: collected − incentive, or the whole amount once the deadline passed. */
  toRemit: number; late: boolean; deadline: string; submittedAt: string;
};
export type EarlierHandover = { id: string; at: string; covers: string; received: number; text: string; closed: boolean; counted: boolean };

/** New Sale incentive estimate of a submitted card (the save works it out again). */
function saleIncentiveOf(card: Record<string, unknown>, programs: Awaited<ReturnType<typeof getPrograms>>, branchId: string) {
  const program = (card.program ?? {}) as Record<string, unknown>;
  const amount = Number(program.amountPaid) || 0;
  const found = programs.find((item) => item.id === text(program.programId));
  if (!found || !(amount > 0)) return 0;
  try {
    const quote = calculateSaleIncentive({ ...found, incentiveTiers: tiersForBranch(found.incentiveTiers, branchId), cashOnSpot: program.cashOnSpot === true || card.cashOnSpot === true }, amount);
    return card.noIncentive === true || program.noIncentive === true ? 0 : quote.incentive;
  } catch { return 0; }
}

/** What the window lists: the MAS's batches still waiting to be remitted in the branch, today's handovers, the methods. */
export async function handoverOptions(user: SessionUser, employeeId: string, branchId: string) {
  const scope = await reviewBranches(user);
  if (scope && !scope.includes(text(branchId))) throw new Error("This branch is not one you are assigned to as Entry Clerk.");
  const [sales, collections, programs, methods, branches] = await Promise.all([listForReview(user), listCollectionsForReview(user), getPrograms(), getPaymentMethods(), getBranches()]);
  const branch = branches.find((item) => item.id === text(branchId));
  if (!branch) throw new Error("Branch not found.");
  const now = manilaNow(), stamp = `${now.date} ${now.time}`;
  const mine = <T extends { masEmployeeId: string; branchId: string; status: string }>(list: T[]) => list.filter((item) => item.masEmployeeId === text(employeeId) && item.branchId === branch.id && item.status === "Submitted");
  const batches: HandoverBatch[] = [];
  for (const item of mine(sales)) {
    const late = Boolean(item.incentiveDeadline) && stamp > item.incentiveDeadline;
    const incentive = late ? 0 : Math.round(item.sales.reduce((sum, card) => sum + saleIncentiveOf(card as Record<string, unknown>, programs, branch.id), 0) * 100) / 100;
    batches.push({ kind: "New Sales", id: item.id, count: item.saleCount, collected: item.totalAmount, incentive, toRemit: (toCents(item.totalAmount) - toCents(incentive)) / 100, late, deadline: item.incentiveDeadline, submittedAt: item.submittedAt });
  }
  for (const item of mine(collections)) {
    const late = Boolean(item.incentiveDeadline) && stamp > item.incentiveDeadline;
    const incentive = late ? 0 : item.totalIncentive;
    batches.push({ kind: "Collections", id: item.id, count: item.entryCount, collected: item.totalAmount, incentive, toRemit: (toCents(item.totalAmount) - toCents(incentive)) / 100, late, deadline: item.incentiveDeadline, submittedAt: item.submittedAt });
  }
  const mas = [...mine(sales), ...mine(collections)][0]?.mas ?? "";
  const { clearings } = schema;
  const today = await getDb().select().from(clearings)
    .where(and(eq(clearings.employee_id, text(employeeId)), eq(clearings.branch, branch.name), eq(clearings.cleared_date, now.date), sql`${clearings.status} <> 'Removed'`))
    .orderBy(clearings.cleared_at);
  const earlier: EarlierHandover[] = today.map((row) => {
    const lines = storedHandoverLines(row.handover_lines);
    return { id: row.clearing_id, at: manilaStamp(row.cleared_at), covers: text(row.covers) || "Both", received: handoverReceived(lines), text: handoverText(lines), closed: Boolean(row.handover_closed_at), counted: lines.length > 0 };
  });
  const active: HandoverMethod[] = methods.filter((item) => item.status === "active").map((item) => ({ name: item.name, isCash: item.isCash, requiresReference: item.requiresReference }));
  return { mas, branch: branch.name, branchId: branch.id, batches, earlier, methods: active, countOn: handoverCountOn(now.date) };
}

/**
 * Marks the ticked batches remitted now as one handover with its method lines and count. `handover`: "new" records a
 * new clearing (its time decides the incentive); a clearing ID adds them to that earlier handover of today, which keeps
 * its time, its lines added to (Part of the earlier handover).
 */
export async function markHandover(user: SessionUser, input: { employeeId?: unknown; branchId?: unknown; batchIds?: unknown; lines?: unknown; note?: unknown; handover?: unknown }) {
  const employeeId = text(input.employeeId), branchId = text(input.branchId), note = text(input.note), handover = text(input.handover) || "new";
  const options = await handoverOptions(user, employeeId, branchId);
  if (!options.countOn) throw new Error("The handover count starts on December 1, 2026.");
  const ids = new Set((Array.isArray(input.batchIds) ? input.batchIds : []).map(text).filter(Boolean));
  const picked = options.batches.filter((batch) => ids.has(batch.id));
  if (!ids.size) throw new Error("Tick at least one batch the MAS is handing over.");
  if (picked.length !== ids.size) throw new Error("A batch ticked is no longer waiting to be remitted (marked, saved or rejected meanwhile). Close the window and open it again.");
  const { lines, problem } = cleanHandoverLines(input.lines, options.methods);
  if (problem) throw new Error(problem);
  if (note.length > HANDOVER_NOTE_MAX) throw new Error(`The note must be ${HANDOVER_NOTE_MAX} characters or fewer.`);
  const expected = picked.reduce((cents, batch) => cents + toCents(batch.toRemit), 0) / 100;
  const received = handoverReceived(lines);
  const estimate = (toCents(received) - toCents(expected)) / 100;
  if (estimate && note.length < HANDOVER_NOTE_MIN) throw new Error(`${estimate < 0 ? "Short" : "Over"} by ${peso(Math.abs(estimate))}: write a note (at least ${HANDOVER_NOTE_MIN} characters), e.g. MAS to pay Monday.`);
  const kinds = [...new Set(picked.map((batch) => batch.kind))];
  const covers: ClearingCovers = kinds.length > 1 ? "Both" : kinds[0];
  const actor = getEncoder();
  const { clearings } = schema;
  return inTransaction(async () => {
    let clearingId = "", clearedAt = "";
    if (handover === "new") {
      const cleared = await addClearing({ branch: options.branch, employeeId, covers, amount: received, notes: `Mark remitted: ${picked.map((batch) => batch.id).join(", ")}`, newHandover: true });
      clearingId = cleared.id;
      await currentDb().update(clearings).set({ handover_lines: lines, handover_note: note || null }).where(eq(clearings.clearing_id, clearingId));
    } else {
      const [row] = await currentDb().select().from(clearings).where(eq(clearings.clearing_id, handover)).for("update");
      if (!row || row.employee_id !== employeeId || row.branch !== options.branch || text(row.cleared_date) !== manilaNow().date || row.status === "Removed") throw new Error("That earlier handover is not one of today's for this MAS and branch. Record a new handover.");
      if (row.handover_closed_at) throw new Error(`The ${manilaStamp(row.cleared_at).slice(11)} handover was already counted and closed when its last batch was saved. Record this as a new handover.`);
      const merged = mergeHandoverLines(storedHandoverLines(row.handover_lines), lines);
      const both = new Set([...coveredKinds((text(row.covers) || "Both") as ClearingCovers), ...kinds]);
      await currentDb().update(clearings).set({
        handover_lines: merged, handover_note: [text(row.handover_note), note].filter(Boolean).join(" / ").slice(0, 300) || null,
        amount: handoverReceived(merged), covers: both.size > 1 ? "Both" : [...both][0],
      }).where(eq(clearings.clearing_id, row.clearing_id));
      clearingId = row.clearing_id;
    }
    const [clearing] = await currentDb().select({ at: clearings.cleared_at }).from(clearings).where(eq(clearings.clearing_id, clearingId));
    clearedAt = clearing.at;
    const remit = { status: "Remitted", clearing_id: clearingId, remitted_at: clearedAt, remitted_by_name: actor.name };
    const saleIds = picked.filter((batch) => batch.kind === "New Sales").map((batch) => batch.id);
    const collectionIds = picked.filter((batch) => batch.kind === "Collections").map((batch) => batch.id);
    const updated = [
      ...(saleIds.length ? await currentDb().update(schema.sale_submissions).set(remit).where(and(inArray(schema.sale_submissions.submission_id, saleIds), eq(schema.sale_submissions.status, "Submitted"))).returning({ id: schema.sale_submissions.submission_id }) : []),
      ...(collectionIds.length ? await currentDb().update(schema.collection_submissions).set(remit).where(and(inArray(schema.collection_submissions.submission_id, collectionIds), eq(schema.collection_submissions.status, "Submitted"))).returning({ id: schema.collection_submissions.submission_id }) : []),
    ];
    if (updated.length !== picked.length) throw new Error("A batch was just marked remitted, saved or rejected by someone else. Nothing was recorded; open the window again.");
    return { clearingId, remittedAt: manilaStamp(clearedAt), mas: options.mas, batches: picked.length, kinds, received, expected, estimate };
  });
}

/**
 * The handover a batch is saved under, when it was counted at Mark remitted: the method the batch takes (one bank or
 * e-wallet method alone, otherwise cash) and its lines. Null for a clearing without a count (the batch's own cash count
 * or turnover total applies, as before). Refused once the handover is closed: its short or over is already recorded.
 */
export async function handoverForSave(clearingId: string) {
  if (!text(clearingId)) return null;
  const [row] = await currentDb().select({ lines: schema.clearings.handover_lines, closedAt: schema.clearings.handover_closed_at, at: schema.clearings.cleared_at }).from(schema.clearings).where(eq(schema.clearings.clearing_id, text(clearingId)));
  const lines = storedHandoverLines(row?.lines);
  if (!row || !lines.length) return null;
  if (row.closedAt) throw new Error(`The ${manilaStamp(row.at).slice(11)} handover was already counted and closed when its last batch was saved. For more money, mark it remitted as a new handover.`);
  return { lines, ...handoverBatchMethod(lines) };
}

/**
 * Inside a batch's save, after its submission is marked Saved: when no batch of the handover is still waiting, the short
 * or over of the whole handover is recorded once, on this batch (received − every entry saved under the clearing, with
 * Fidelity and penalties), and any bank or e-wallet line of a cash handover goes to Bank Deposits as money forwarded to
 * the bank, so cash on hand is the cash counted. Returns null while batches are still waiting.
 */
export async function settleHandover(input: { clearingId: string; kind: "New Sales" | "Collections"; entryIds: string[]; batchTotal: number; branch: string; mas: string; accountableEmployeeId: string; dateRemitted: string }) {
  const { clearings } = schema;
  const [row] = await currentDb().select().from(clearings).where(eq(clearings.clearing_id, input.clearingId)).for("update");
  const lines = storedHandoverLines(row?.handover_lines);
  if (!row || !lines.length) return null;
  if (row.handover_closed_at) throw new Error("This handover was already counted and closed. For more money, mark it remitted as a new handover.");
  const [waiting] = rowsOf<{ count: number }>(await currentDb().execute(sql`select count(*)::int as count from (
    select submission_id from sale_submissions where clearing_id = ${row.clearing_id} and status = 'Remitted'
    union all select submission_id from collection_submissions where clearing_id = ${row.clearing_id} and status = 'Remitted') waiting`));
  if (Number(waiting?.count) > 0) return { waiting: Number(waiting.count), variance: null };
  const [totals] = rowsOf<{ expected: number; sales: number; collections: number }>(await currentDb().execute(sql`select coalesce(sum(due), 0)::float8 as expected, count(*) filter (where kind = 'S')::int as sales, count(*) filter (where kind = 'C')::int as collections from (
    select 'S' as kind, coalesce(remittance_amount, 0) + coalesce(fidelity_amount, 0) + coalesce(penalty_amount, 0) as due from sales where clearing_id = ${row.clearing_id}
    union all select 'C', coalesce(remittance_amount, 0) + coalesce(fidelity_amount, 0) + coalesce(penalty_amount, 0) from collections where clearing_id = ${row.clearing_id} and lower(coalesce(status, '')) = 'posted') saved`));
  const expected = toCents(Number(totals?.expected) || 0) / 100;
  const difference = (toCents(handoverReceived(lines)) - toCents(expected)) / 100;
  const kinds = [Number(totals?.sales) ? "New Sales" : "", Number(totals?.collections) ? "Collections" : ""].filter(Boolean).join(" + ") || input.kind;
  const variance = await recordTurnoverVariance({
    kind: input.kind, entryIds: input.entryIds, branch: input.branch, mas: input.mas, accountableEmployeeId: input.accountableEmployeeId, dateRemitted: input.dateRemitted,
    controlTotal: (toCents(input.batchTotal) + toCents(difference)) / 100, systemTotal: input.batchTotal,
    note: handoverVarianceNote(row.clearing_id, lines, expected, kinds, text(row.handover_note)),
  });
  if (handoverBatchMethod(lines).cash) {
    const clerk = getEncoder();
    for (const line of lines.filter((item) => !item.cash)) {
      await addDeposit({ date: manilaNow().date, amount: line.amount, bankAccount: line.method, transferType: line.method, mas: input.mas, remarks: `${line.reference ? `Ref ${line.reference} · ` : ""}Paid by MAS with handover ${row.clearing_id}`.slice(0, 200) }, { employeeId: clerk.employeeId, name: clerk.name, branch: input.branch });
    }
  }
  await currentDb().update(clearings).set({ handover_closed_at: new Date().toISOString(), handover_variance_id: variance?.id ?? null }).where(eq(clearings.clearing_id, row.clearing_id));
  return { waiting: 0, variance, expected, received: handoverReceived(lines) };
}

/** The handover shown on the encoding form: its lines and whether it is closed. */
export async function handoverSummary(clearingId: string) {
  const [row] = await getDb().select().from(schema.clearings).where(eq(schema.clearings.clearing_id, text(clearingId)));
  const lines = storedHandoverLines(row?.handover_lines);
  if (!row || !lines.length) return null;
  const method = handoverBatchMethod(lines);
  return { id: row.clearing_id, at: manilaStamp(row.cleared_at), lines, text: handoverText(lines), received: handoverReceived(lines), method: method.method, reference: method.reference, cash: method.cash, closed: Boolean(row.handover_closed_at), note: text(row.handover_note) };
}

export type { HandoverLine };
