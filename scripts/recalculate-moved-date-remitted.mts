/**
 * Recalculates pending slips whose entries had their Date Remitted moved earlier with a reason, under the rule of
 * October 13, 2026 (owner): the cash counts as received on the Date Remitted, so an on-time incentive is kept
 * (lib/remittance-workflow.ts receivedAtOf). First case: CABALLERO, JENNY's five MINTAL collections of October 13
 * (OR date October 11, Date Remitted October 12, entry clerks' meeting), whose ₱474 incentive was forfeited.
 *
 * Each slip is returned (which gives the forfeited incentive back, as any rejection does) and its entries are sent for
 * approval again, so a new slip is made with the received time worked out by the new rule. Both steps use the app's own
 * remittance workflow; the Audit Log keeps every change and the returned slip keeps the reason.
 *
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/recalculate-moved-date-remitted.mts           preview
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/recalculate-moved-date-remitted.mts --apply   apply
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { keepsIncentive } from "@/lib/remittance-deadline";
import { decideCashRemittance, receivedAtOf, resubmitReturned } from "@/lib/remittance-workflow";

const SLIPS = ["REM-20261013061728-IUZM", "REM-20261013065406-0AG5"];
const REASON = "Recalculated: the Date Remitted was moved to the day the MAS remitted (entry clerks' meeting), so the cash counts as received that day (owner, October 13, 2026)";
const apply = process.argv.includes("--apply");
const rowsOf = <T,>(result: unknown) => (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];

type Entry = { id: string; or_date: string; date_remitted: string; reason: string | null; amount: number; remittance: number; forfeited: number; encoded_at: string; employee: string; branch: string; status: string; link: string };

(async () => {
  console.log(apply ? "APPLY" : "PREVIEW (nothing is changed; add --apply)");
  for (const slip of SLIPS) {
    const [remittance] = rowsOf<{ status: string; expected: number }>(await getDb().execute(sql`select status, total_remittance::float8 as expected from remittances where remittance_id = ${slip}`));
    if (!remittance) { console.log(`${slip}: not found; skipped.`); continue; }
    const entries = rowsOf<Entry>(await getDb().execute(sql`select collection_id as id, or_date::text, date_remitted::text, date_remitted_reason as reason, amount_collected::float8 as amount,
        remittance_amount::float8 as remittance, coalesce(forfeited_incentive, 0)::float8 as forfeited, to_char(encoded_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as encoded_at,
        accountable_employee_id as employee, branch, remittance_status as status, linked_remittance_id as link
      from collections where linked_remittance_id = ${slip} order by collection_id`));
    const received = await receivedAtOf(entries.map((entry) => ({ id: entry.id, encodedAt: entry.encoded_at, dateRemitted: entry.date_remitted, accountableEmployeeId: entry.employee, branch: entry.branch, kind: "Collections" as const })));
    const at = `${received.date} ${received.time}`;
    console.log(`\n${slip} (${remittance.status}, expected ₱${remittance.expected}): new received time ${at}`);
    let restored = 0;
    for (const entry of entries) {
      const kept = keepsIncentive(entry.or_date, at);
      if (kept) restored += entry.forfeited;
      console.log(`  ${entry.id} OR ${entry.or_date} DR ${entry.date_remitted} reason: ${entry.reason ?? "(none)"} | forfeited ₱${entry.forfeited} -> ${kept ? "incentive kept" : "still late"}`);
    }
    console.log(`  incentive given back: ₱${restored.toFixed(2)}`);
    if (remittance.status !== "Pending Approval" && remittance.status !== "Discrepancy") { console.log("  Not pending any more; left as it is."); continue; }
    if (!restored) { console.log("  Nothing to give back; left as it is."); continue; }
    if (!apply) continue;
    await runAsSystem(() => decideCashRemittance(slip, "reject", REASON, true));
    const created = await runAsSystem(() => resubmitReturned(entries.map((entry) => entry.id), { employeeId: "", isAdmin: true }));
    console.log(`  returned and sent again: ${created.join(", ") || "(no new slip)"}`);
  }
  process.exit(0);
})().catch((error) => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
