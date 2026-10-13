/**
 * Collector incentive 10% from month 13 on D-350 (5Y), D-370 and D-320 (owner, October 13, 2026: their Collector tiers
 * were 0%, so GOTUAL, FLORYL JAY earned nothing on his MINTAL collections). Months 1-12 stay as they are.
 * Then recalculates the pending slips named with --slips= (default: Gotual's REM-20261013082847-TH8J): the slip is
 * returned, its entries are saved again through the returned-batch editor (which recalculates each incentive with the
 * new tiers; lib/batch-edit.ts), and sent for approval again. The Audit Log and Record Corrections keep every change.
 *
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/set-collector-tiers.mts            preview (rolled back: nothing saved)
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/set-collector-tiers.mts --apply
 */
import { sql } from "drizzle-orm";

import { getReturnedBatch, saveReturnedBatch } from "@/lib/batch-edit";
import { getDb } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { decideCashRemittance, resubmitReturned } from "@/lib/remittance-workflow";

const PROGRAMS = ["D-350 (5Y)", "D-370", "D-320"];
const RATE = 10;
const apply = process.argv.includes("--apply");
const chosen = process.argv.find((arg) => arg.startsWith("--slips="))?.slice("--slips=".length).split(",").map((id) => id.trim()).filter(Boolean);
const SLIPS = chosen?.length ? chosen : ["REM-20261013082847-TH8J"];
const REASON = "Recalculated: the Collector incentive of D-350 (5Y), D-370 and D-320 is 10% from month 13 (owner, October 13, 2026)";
const rowsOf = <T,>(result: unknown) => (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];

(async () => {
  console.log(apply ? "APPLY" : "PREVIEW (nothing is changed; add --apply)");
  const tiers = rowsOf<{ id: string; program: string; from: number; to: number; amount: number }>(await getDb().execute(sql`select i.incentive_id as id, p.program_name as program, i.from_month as from, i.to_month as to, i.incentive_amount::float8 as amount
    from program_incentives i join programs p on p.program_id = i.program_id
    where p.program_name in (${sql.join(PROGRAMS.map((name) => sql`${name}`), sql`, `)}) and i.role = 'Collector' and i.from_month >= 13 and i.branch_id is null order by p.program_name, i.from_month`));
  for (const tier of tiers) console.log(`  ${tier.program} Collector months ${tier.from}-${tier.to}: ${tier.amount}% -> ${RATE}%`);
  if (tiers.length !== PROGRAMS.length) throw new Error(`Expected one Collector tier from month 13 for each of ${PROGRAMS.join(", ")}; found ${tiers.length}. Nothing changed.`);
  for (const slip of SLIPS) {
    const entries = rowsOf<{ id: string; amount: number; remittance: number; nop_from: number; nop_to: number }>(await getDb().execute(sql`select collection_id as id, amount_collected::float8 as amount, remittance_amount::float8 as remittance, nop_from, nop_to from collections where linked_remittance_id = ${slip} order by collection_id`));
    console.log(`\n${slip}: ${entries.map((entry) => `${entry.id} NOP ${entry.nop_from}-${entry.nop_to} ₱${entry.amount} (incentive now ₱${(entry.amount - entry.remittance).toFixed(2)})`).join("; ")}`);
  }
  if (!apply) process.exit(0);

  await getDb().execute(sql`update program_incentives set incentive_amount = ${RATE} where incentive_id in (${sql.join(tiers.map((tier) => sql`${tier.id}`), sql`, `)})`);
  console.log(`\nCollector tiers set to ${RATE}%.`);
  for (const slip of SLIPS) {
    const ids = rowsOf<{ id: string }>(await getDb().execute(sql`select collection_id as id from collections where linked_remittance_id = ${slip}`)).map((row) => row.id);
    const by = { employeeId: "", isAdmin: true };
    await runAsSystem(() => decideCashRemittance(slip, "reject", REASON, true));
    const batch = await getReturnedBatch(ids, by);
    await runAsSystem(() => saveReturnedBatch({ ids, dateRemitted: batch.dateRemitted, dateRemittedReason: batch.dateRemittedReason, paymentMethod: batch.paymentMethod, paymentReference: batch.paymentReference, collectedBy: batch.collectedBy,
      penalty: batch.penalty, penaltyNote: batch.penaltyNote, fidelity: batch.fidelity, note: REASON,
      entries: batch.entries.map((entry) => ({ id: entry.id, orNumber: entry.orNumber, orDate: entry.orDate, amount: entry.amount, monthTo: entry.monthTo, backdateReason: entry.backdateReason })) }, by));
    const created = await runAsSystem(() => resubmitReturned(ids, by));
    const after = rowsOf<{ id: string; amount: number; remittance: number }>(await getDb().execute(sql`select collection_id as id, amount_collected::float8 as amount, remittance_amount::float8 as remittance from collections where collection_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) order by collection_id`));
    console.log(`${slip}: returned, recalculated, sent again as ${created.join(", ") || "(none)"} · ${after.map((entry) => `${entry.id} incentive ₱${(entry.amount - entry.remittance).toFixed(2)}`).join("; ")}`);
  }
  process.exit(0);
})().catch((error) => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
