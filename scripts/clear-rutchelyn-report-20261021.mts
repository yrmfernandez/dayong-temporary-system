/** Clear only entries traced by Audit Log to the six admin-deleted remittances.
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/clear-rutchelyn-report-20261021.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { deleteRecord, planDeletion } from "@/lib/admin-delete";
import { inTransaction } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const employee = "MD-2026-0081";
const reason = "Owner requested clearing BARRIENTOS, RUTCHELYN's October 21 report: remove entries traced to six remittances deleted by the administrator at 10:54–10:55 Manila, which were left Outstanding.";
const rows = <T,>(result: unknown): T[] => Array.isArray(result) ? result : (result as { rows: T[] }).rows;
const slips = ["REM-20261021025159-O22W", "REM-20261021025142-CILR", "REM-20261021025130-342T", "REM-20261021025124-0ZEG", "REM-20261021025118-JUVW", "REM-20261021025101-8HT6"];
const list = (values: string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

async function main() {
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table sales, collections, remittances, member_programs in share row exclusive mode`);
    const deleted = rows<{ record_id: string }>(await tx.execute(sql`select distinct a.record_id from audit_log a
      where a.table_name = 'remittances' and a.action = 'delete' and a.record_id in (${list(slips)})
        and a.changes_json->>'remarks' like '%BARRIENTOS, RUTCHELYN%'
        and not exists (select 1 from remittances r where r.remittance_id = a.record_id)`));
    if (deleted.length !== 6) throw new Error("Expected all six deleted remittances in Audit Log.");
    const traced = rows<{ id: string; kind: "sale" | "collection" }>(await tx.execute(sql`select distinct record_id as id,
      case when table_name = 'sales' then 'sale' else 'collection' end as kind from audit_log
      where table_name in ('sales', 'collections') and action = 'update'
        and changes_json->'linked_remittance_id'->>'from' in (${list(slips)})
        and changes_json->'linked_remittance_id'->>'to' is null
        and logged_at >= '2026-10-21T02:54:00Z' and logged_at < '2026-10-21T02:56:00Z'`));
    if (traced.length !== 13) throw new Error("Expected 13 traced entries.");
    const existing = rows<{ id: string; kind: "sale" | "collection"; clerk: string; status: string; link: string | null; day: string }>(await tx.execute(sql`
      select sale_id as id, 'sale' as kind, encoded_by_employee_id as clerk, remittance_status as status, linked_remittance_id as link,
        (encoded_at at time zone 'Asia/Manila')::date::text as day from sales where sale_id in (${list(traced.map((r) => r.id))})
      union all select collection_id, 'collection', encoded_by_employee_id, remittance_status, linked_remittance_id,
        (encoded_at at time zone 'Asia/Manila')::date::text from collections where collection_id in (${list(traced.map((r) => r.id))})`));
    for (const entry of existing) {
      if (entry.clerk !== employee || entry.status !== "Outstanding" || entry.link || entry.day !== "2026-10-21") throw new Error(`${entry.id}: no longer eligible.`);
      const plan = await planDeletion(entry.kind, entry.id, tx);
      console.log(`${entry.kind} ${entry.id}: ${plan.effects.join("; ")}${plan.blockers.length ? ` BLOCKED ${plan.blockers.join("; ")}` : ""}`);
      if (plan.blockers.length) throw new Error("Deletion blocked.");
      if (plan.ids.collections.some((id) => !traced.some((r) => r.id === id))) throw new Error("Cascade includes an untraced collection.");
      if (apply) await deleteRecord(entry.kind, entry.id, reason);
    }
    console.log(`${apply ? "Deleted" : "Would delete"} ${existing.length} traced entries (${existing.filter((r) => r.kind === "sale").length} New Sale, ${existing.filter((r) => r.kind === "collection").length} Collections).`);
    const remaining = rows<{ sales: number; collections: number }>(await tx.execute(sql`select
      (select count(*)::int from sales where encoded_by_employee_id = ${employee} and (encoded_at at time zone 'Asia/Manila')::date = '2026-10-21') as sales,
      (select count(*)::int from collections where encoded_by_employee_id = ${employee} and (encoded_at at time zone 'Asia/Manila')::date = '2026-10-21') as collections`))[0];
    console.log(`Today's remaining report entries: ${remaining.sales} New Sales, ${remaining.collections} Collections.`);
    if (apply && (remaining.sales || remaining.collections)) throw new Error("Today's report still has entries; rolling back for review.");
  }));
}
main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
