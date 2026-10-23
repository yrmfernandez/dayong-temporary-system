import { sql } from "drizzle-orm";

import { encodedBy, getDb, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { followSlip } from "@/lib/entry-edit";
import { createReadableId } from "@/lib/readable-id";
import { INCENTIVE_GRACE_DAYS, incentiveDeadline, manilaDateOf } from "@/lib/remittance-deadline";
import { loadWorkCalendar } from "@/lib/work-calendar";

/**
 * An Administrator decides whether the MAS or Collector keeps an entry's incentive (owner, October 23, 2026). The
 * 3:00 PM rule (lib/remittance-deadline.ts) uses the time the person was cleared, which nobody can correct afterwards,
 * so a clearing recorded late (for cash received on time) forfeited incentives that were earned.
 *
 * - "Keep": the incentive is kept whatever the time received; "Forfeit": it is forfeited whatever the time received;
 *   "" (Follow the rule): the 3:00 PM rule decides again. The decision is stored on the entry with its reason, who and
 *   when, and every later slip follows it (lib/remittance-workflow.ts forfeitsIncentive), so a returned and resubmitted
 *   slip keeps it.
 * - On a slip still pending (Pending Approval or Discrepancy) the entry's company share, the slip's line and its
 *   expected amount change at once. The actual cash stays (the difference then shows what to give back or collect), or,
 *   with moveActual (owner, October 23, 2026: slips are made with the actual equal to the expected, so the change is
 *   not cash that went missing), the actual moves by the same amount and the difference stays as it was.
 *   An entry not yet on a slip only keeps the decision. An approved entry is not changed here.
 * - An entry marked No incentive at encoding is refused: that is the encoder's own choice, corrected on the entry.
 * The Audit Log keeps every change and Record Corrections a summary.
 */
export type IncentiveDecision = "Keep" | "Forfeit" | "";
export const INCENTIVE_DECISIONS: readonly IncentiveDecision[] = ["Keep", "Forfeit", ""];

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: number) => Math.round(value * 100) / 100;
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []) as T[];

type Entry = { kind: "Collection" | "New Sale"; id: string; amount: number; share: number; forfeited: number; noIncentive: string; status: string; slip: string; slipStatus: string;
  slipAt: string; date: string; branch: string; decision: string };

async function findEntry(id: string): Promise<Entry | null> {
  const [row] = rowsOf<Entry>(await getDb().execute(sql`
    select 'Collection' as kind, c.collection_id as id, coalesce(c.amount_collected, 0)::float8 as amount, coalesce(c.remittance_amount, 0)::float8 as share,
      coalesce(c.forfeited_incentive, 0)::float8 as forfeited, coalesce(c.no_incentive_reason, '') as "noIncentive", coalesce(c.remittance_status, '') as status,
      coalesce(c.linked_remittance_id, '') as slip, coalesce(r.status, '') as "slipStatus",
      coalesce(r.date_remitted::text || ' ' || nullif(trim(r.time_remitted), ''), '') as "slipAt", coalesce(c.or_date::text, '') as date, coalesce(c.branch, '') as branch,
      coalesce(c.incentive_decision, '') as decision
    from collections c left join remittances r on r.remittance_id = c.linked_remittance_id where c.collection_id = ${id}
    union all
    select 'New Sale', s.sale_id, coalesce(s.amount_paid, 0)::float8, coalesce(s.remittance_amount, s.amount_paid, 0)::float8, coalesce(s.forfeited_incentive, 0)::float8,
      coalesce(s.no_incentive_reason, ''), coalesce(s.remittance_status, ''), coalesce(s.linked_remittance_id, ''), coalesce(r.status, ''),
      coalesce(r.date_remitted::text || ' ' || nullif(trim(r.time_remitted), ''), ''), coalesce(s.or_date::text, s.date_created::text, ''), coalesce(s.branch, ''),
      coalesce(s.incentive_decision, '')
    from sales s left join remittances r on r.remittance_id = s.linked_remittance_id where s.sale_id = ${id}`));
  return row ?? null;
}

/** Entries with a decision, for the remittance ledger: id → the decision ("Keep" or "Forfeit"), its reason, who and when. */
export async function incentiveDecisions() {
  const result = await getDb().execute(sql`select collection_id as id, incentive_decision as decision, coalesce(incentive_decision_reason, '') as reason, coalesce(incentive_decision_by, '') as "by",
      coalesce(to_char(incentive_decision_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '') as "at" from collections where coalesce(incentive_decision, '') <> ''
    union all select sale_id, incentive_decision, coalesce(incentive_decision_reason, ''), coalesce(incentive_decision_by, ''),
      coalesce(to_char(incentive_decision_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '') from sales where coalesce(incentive_decision, '') <> ''`);
  return new Map(rowsOf<{ id: string; decision: string; reason: string; by: string; at: string }>(result).map((row) => [row.id, row]));
}

export async function decideIncentive(input: { id: string; decision: string; reason: string; moveActual?: boolean }) {
  const id = text(input.id), decision = text(input.decision) as IncentiveDecision, reason = text(input.reason).slice(0, 300);
  if (!INCENTIVE_DECISIONS.includes(decision)) throw new Error("Choose Keep, Forfeit, or Follow the rule.");
  if (reason.length < 5) throw new Error("Enter the reason for the decision (at least 5 characters).");
  const entry = await findEntry(id);
  if (!entry) throw new Error("Entry not found.");
  if (entry.noIncentive) throw new Error("This entry was marked No incentive when it was encoded. Correct the entry instead.");
  if (entry.status === "Remitted" || entry.slipStatus === "Approved") throw new Error("This entry's remittance is already approved; its incentive is not changed here.");
  const incentive = entry.forfeited > 0 ? entry.forfeited : round(entry.amount - entry.share);
  const pending = Boolean(entry.slip) && ["Pending Approval", "Discrepancy"].includes(entry.slipStatus);
  // What the incentive should be now: on a pending slip the decision (or the rule, against the slip's time received)
  // applies at once; otherwise the next slip applies it.
  let forfeit = entry.forfeited > 0;
  if (pending && incentive > 0) {
    if (decision === "Keep") forfeit = false;
    else if (decision === "Forfeit") forfeit = true;
    else {
      const deadline = incentiveDeadline(manilaDateOf(entry.date), await loadWorkCalendar(entry.branch));
      forfeit = Boolean(entry.slipAt) && !INCENTIVE_GRACE_DAYS.includes(entry.slipAt.slice(0, 10)) && Boolean(deadline) && entry.slipAt > deadline;
    }
  }
  const share = forfeit ? entry.amount : round(entry.amount - incentive);
  const actor = getEncoder();
  const before = { decision: entry.decision, companyShare: entry.share, forfeited: entry.forfeited };
  const after = { decision, companyShare: share, forfeited: forfeit ? incentive : 0 };
  return inTransaction(async (tx) => {
    const fields = { incentive_decision: decision || null, incentive_decision_reason: decision ? reason : null, incentive_decision_by: decision ? actor.name : null, incentive_decision_at: decision ? new Date().toISOString() : null };
    const changesFigures = pending && (forfeit !== entry.forfeited > 0);
    if (entry.kind === "Collection") {
      await tx.update(schema.collections).set({ ...fields, ...(changesFigures ? { remittance_amount: share, forfeited_incentive: forfeit ? incentive : null } : {}) }).where(sql`collection_id = ${id}`);
    } else {
      await tx.update(schema.sales).set({ ...fields, ...(changesFigures ? { remittance_amount: share, mas_incentive: round(entry.amount - share), forfeited_incentive: forfeit ? incentive : null } : {}) }).where(sql`sale_id = ${id}`);
    }
    let slip = changesFigures ? await followSlip(tx, id, entry.slip, share) : null;
    const actualMoved = Boolean(input.moveActual && slip);
    if (input.moveActual && slip) {
      // gross_collection already holds the new expected; the actual moves by the same amount, so the difference stays.
      const [moved] = rowsOf<{ difference: number }>(await tx.execute(sql`update remittances set total_remittance = round((coalesce(total_remittance, 0) + ${slip.expectedChange})::numeric, 2),
          difference = round((coalesce(total_remittance, 0) + ${slip.expectedChange} - coalesce(gross_collection, 0))::numeric, 2),
          status = case when status = 'Discrepancy' and round((coalesce(total_remittance, 0) + ${slip.expectedChange} - coalesce(gross_collection, 0))::numeric, 2) = 0 then 'Pending Approval' else status end
        where remittance_id = ${slip.slipId} returning difference::float8 as difference`));
      slip = { ...slip, difference: round(Number(moved?.difference ?? 0)) };
    }
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Incentive decision", record_id: id,
      reason: `${decision ? `${decision} the incentive` : "Follow the 3:00 PM rule"}: ${reason}`,
      before_json: before, after_json: { ...after, slip: slip ? { id: slip.slipId, expectedChange: slip.expectedChange, actualMoved, difference: slip.difference } : null },
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
    return { id, decision, forfeited: forfeit, incentive, companyShare: share, slip, actualMoved, applied: changesFigures ? "now" : pending ? "unchanged" : "next slip" };
  });
}
