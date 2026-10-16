/**
 * Read-only: for given New Sales or Collections, their remittance slips and every clearing of the same accountable
 * person and branch from two days before to two days after the Date Remitted (owner, October 16, 2026: why an entry
 * counted as received after 3 PM). Prints IDs, times, statuses and links only.
 *
 *   npm run prod -- node scripts/inspect-entry-clearings.mjs COL-... SALE-...
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!ids.length) { console.error("Usage: node scripts/inspect-entry-clearings.mjs <entry id> [...]"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const manila = (column) => sql`to_char(${sql(column)} at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')`;
try {
  console.log(`Database ${/postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?"}`);
  for (const id of ids) {
    const [entry] = await sql`
      select 'Collection' as kind, collection_id as id, or_date::text as or_date, branch, accountable_employee_id as person, date_remitted::text as date_remitted, ${manila("encoded_at")} as encoded_at, remittance_status, linked_remittance_id, forfeited_incentive::float8 as forfeited, collection_batch_id as batch
        from collections where collection_id = ${id}
      union all
      select 'New Sale', sale_id, or_date::text, branch, accountable_employee_id, date_remitted::text, ${manila("encoded_at")}, remittance_status, linked_remittance_id, forfeited_incentive::float8, ''
        from sales where sale_id = ${id}`;
    if (!entry) { console.log(`\n${id}: not found`); continue; }
    console.log(`\n${entry.kind} ${entry.id} · OR ${entry.or_date} · branch ${entry.branch} · person ${entry.person} · Date Remitted ${entry.date_remitted} · encoded ${entry.encoded_at} · ${entry.remittance_status} on ${entry.linked_remittance_id || "—"} · forfeited ${entry.forfeited ?? 0}${entry.batch ? ` · batch ${entry.batch}` : ""}`);
    const slips = await sql`select r.remittance_id, r.status, r.date_remitted::text as date, r.time_remitted as time, ${manila("r.created_at")} as created, coalesce(r.encoded_by_name, '') as by
      from remittance_collections rc join remittances r on r.remittance_id = rc.remittance_id where rc.collection_id = ${id} order by r.created_at`;
    for (const slip of slips) console.log(`  slip ${slip.remittance_id} · ${slip.status} · received ${slip.date} ${slip.time ?? ""} · created ${slip.created} by ${slip.by}`);
    const clearings = await sql`select clearing_id, ${manila("cleared_at")} as cleared_at, cleared_date::text as cleared_date, status, covers, coalesce(remittance_id, '') as remittance_id, coalesce(encoded_by_name, '') as by
      from clearings where employee_id = ${entry.person} and lower(trim(branch)) = lower(trim(${entry.branch}))
        and cleared_date between (${entry.date_remitted}::date - 2) and (${entry.date_remitted}::date + 2) order by cleared_at`;
    if (!clearings.length) console.log("  no clearing of this person and branch within two days of the Date Remitted");
    for (const clearing of clearings) console.log(`  clearing ${clearing.clearing_id} · cleared ${clearing.cleared_at} (day ${clearing.cleared_date}) · ${clearing.status} · covers ${clearing.covers} · slip ${clearing.remittance_id || "—"}${clearing.by ? ` · by ${clearing.by}` : ""}`);
  }
} finally {
  await sql.end();
}
