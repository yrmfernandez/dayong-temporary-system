/**
 * Rechecks automatically submitted pending slips using the app's clearing receipt time and working-day deadline.
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/restore-clearing-incentives.mts
 * Apply: add --apply. Production: prefix the command with node scripts/prod.mjs.
 * Only restores genuinely eligible forfeited incentives. Approved/manual slips are left for review.
 * Uses the existing reject/resubmit workflow, retains the original slip with the correction reason, and records
 * a Record Corrections summary. An interrupted run can be retried; already corrected slips are no longer selected.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { keepsIncentive } from "@/lib/remittance-deadline";
import { decideCashRemittance, receivedAtOf, resubmitReturned } from "@/lib/remittance-workflow";
import { loadWorkCalendar } from "@/lib/work-calendar";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []);
type Entry = { kind: "Collections" | "New Sales"; id: string; or_date: string; date_remitted: string; amount: number; remittance: number; forfeited: number; encoded_at: string; employee: string; branch: string; status: string };
const REASON = "Incentive correction: use the recorded clearing receipt time, or the earlier Date Remitted with its saved delay reason, rather than the encoding/approval time.";

async function main() {
  const db = getDb();
  const slips = rowsOf<{ id: string; status: string; expected: number; actual: number; automatic: boolean }>(await db.execute(sql`
    select r.remittance_id as id, r.status, r.total_remittance::float8 as expected, r.gross_collection::float8 as actual,
      (r.encoded_by_user_id = 'system' and r.remarks like 'Submitted automatically%' and coalesce(trim(r.cash_count), '') = '') as automatic
    from remittances r where r.status in ('Pending Approval', 'Discrepancy') and (
      exists (select 1 from collections c where c.linked_remittance_id = r.remittance_id and c.forfeited_incentive > 0 and c.encoded_at >= '2026-10-08') or
      exists (select 1 from sales s where s.linked_remittance_id = r.remittance_id and s.forfeited_incentive > 0 and s.encoded_at >= '2026-10-08')) order by r.remittance_id`));
  let corrected = 0, total = 0;
  console.log(apply ? "APPLY" : "PREVIEW (no writes; add --apply)");
  for (const slip of slips) {
    if (!slip.automatic || slip.status !== "Pending Approval" || Math.round(slip.expected * 100) !== Math.round(slip.actual * 100)) {
      console.log(`${slip.id}: counted/manual/discrepant slip; left for review.`); continue;
    }
    const entries = rowsOf<Entry>(await db.execute(sql`
      select 'Collections' as kind, collection_id as id, or_date::text, date_remitted::text, amount_collected::float8 as amount,
        remittance_amount::float8 as remittance, coalesce(forfeited_incentive, 0)::float8 as forfeited,
        to_char(encoded_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as encoded_at,
        accountable_employee_id as employee, branch, remittance_status as status
      from collections where linked_remittance_id = ${slip.id}
      union all
      select 'New Sales', sale_id, coalesce(or_date, (date_created at time zone 'Asia/Manila')::date)::text, date_remitted::text,
        amount_paid::float8, remittance_amount::float8, coalesce(forfeited_incentive, 0)::float8,
        to_char(coalesce(encoded_at, date_created) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'),
        accountable_employee_id, branch, remittance_status from sales where linked_remittance_id = ${slip.id}`));
    if (!entries.length || entries.some((entry) => entry.status !== "Pending Remittance Approval")) throw new Error(`${slip.id}: entry statuses need review.`);
    const mappings = rowsOf<{ collection_id: string }>(await db.execute(sql`select collection_id from remittance_collections where remittance_id = ${slip.id}`));
    if (mappings.length !== entries.length || mappings.some((mapping) => !entries.some((entry) => entry.id === mapping.collection_id))) throw new Error(`${slip.id}: mapping mismatch.`);
    const received = await receivedAtOf(entries.map((entry) => ({ id: entry.id, kind: entry.kind, encodedAt: entry.encoded_at, dateRemitted: entry.date_remitted, accountableEmployeeId: entry.employee, branch: entry.branch })));
    const at = `${received.date} ${received.time}`;
    const calendar = await loadWorkCalendar(entries[0].branch);
    const restore = Math.round(entries.reduce((sum, entry) => sum + (keepsIncentive(entry.or_date, at, calendar) ? entry.forfeited : 0), 0) * 100) / 100;
    console.log(`${slip.id}: ${entries.length} entries; received ${at}; restore PHP ${restore.toFixed(2)}.`);
    if (!restore) continue;
    corrected++; total += restore;
    if (!apply) continue;
    await runAsSystem(() => decideCashRemittance(slip.id, "reject", REASON, true));
    const created = await runAsSystem(() => resubmitReturned(entries.map((entry) => entry.id), { employeeId: "", isAdmin: true }));
    if (!created.length) throw new Error(`${slip.id}: returned for correction, but no replacement slip was created; resubmit its entries.`);
    await db.execute(sql`insert into record_corrections (correction_id, module, record_id, reason, before_json, after_json, corrected_at, encoded_by_name, encoded_at)
      values (${`COR-INC-${slip.id}-${Date.now().toString(36).toUpperCase()}`}, 'Clearing incentive correction', ${slip.id}, ${REASON},
        ${JSON.stringify({ slip: slip.id, expected: slip.expected, forfeited: entries.reduce((sum, entry) => sum + entry.forfeited, 0) })}::jsonb,
        ${JSON.stringify({ replacementSlips: created, restoredIncentive: restore, receivedAt: at })}::jsonb,
        now(), 'Clearing incentive correction', now())`);
    const remaining = rowsOf<{ forfeited: number }>(await db.execute(sql`select coalesce(sum(forfeited), 0)::float8 as forfeited from (
      select forfeited_incentive as forfeited from collections where collection_id in (${sql.join(entries.map((entry) => sql`${entry.id}`), sql`, `)})
      union all select forfeited_incentive from sales where sale_id in (${sql.join(entries.map((entry) => sql`${entry.id}`), sql`, `)})) q`))[0].forfeited;
    const expectedRemaining = Math.round((entries.reduce((sum, entry) => sum + entry.forfeited, 0) - restore) * 100) / 100;
    if (Math.round(remaining * 100) !== Math.round(expectedRemaining * 100)) throw new Error(`${slip.id}: restored incentive verification failed.`);
    console.log(`  Verified replacement: ${created.join(", ")}.`);
  }
  console.log(`${apply ? "Corrected" : "Would correct"} ${corrected} slips; incentive restored PHP ${total.toFixed(2)}.`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
