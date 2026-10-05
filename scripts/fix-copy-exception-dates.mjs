/**
 * Fixes the Collections whose OR date could not be read when the data was copied from Google Sheets (a year typed
 * with 3 digits), by the owner's rule of October 5, 2026: the OR date becomes the date the collection was recorded
 * (its timestamp, Manila time), or its Date Remitted when there is no timestamp. Each fixed item is marked resolved
 * in copy_exceptions. Birthdates are not touched (no rule can recover them).
 *
 *   node scripts/fix-copy-exception-dates.mjs          dry run: counts only
 *   node scripts/fix-copy-exception-dates.mjs --apply  write
 *
 * Uses DIRECT_DATABASE_URL: staging from .env.local, or production when set in the shell (cutover steps).
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const RULE = "OR date set to the recorded date (timestamp, Manila), else Date Remitted: owner's rule 2026-10-05";
const candidates = sql`
  select e.exception_id, c.collection_id,
         coalesce((coalesce(c.created_at, c.encoded_at) at time zone 'Asia/Manila')::date, c.date_remitted) as new_date
  from copy_exceptions e
  join collections c on c.collection_id = e.record_id
  where e.table_name = 'collections' and e.column_name = 'or_date' and e.resolved_at is null and c.or_date is null`;
try {
  const rows = await candidates;
  const fixable = rows.filter((row) => row.new_date);
  console.log(`Supabase project: ${project}`);
  console.log(`Collections with an unreadable OR date: ${rows.length}; fixable by the rule: ${fixable.length}.`);
  if (!apply) { console.log("Dry run. Nothing was written. Add --apply to fix them."); }
  else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (OR dates)"}, true)`;
      for (const row of fixable) {
        await tx`update collections set or_date = ${row.new_date} where collection_id = ${row.collection_id} and or_date is null`;
        await tx`update copy_exceptions set resolved_at = now(), resolved_by_name = ${RULE} where exception_id = ${row.exception_id}`;
      }
    });
    console.log(`Fixed ${fixable.length} OR date(s) and marked them resolved.`);
  }
  const [open] = await sql`select count(*)::int as n from copy_exceptions where resolved_at is null`;
  console.log(`Still open in the review list: ${open.n} (the birthdates).`);
} finally {
  await sql.end();
}
