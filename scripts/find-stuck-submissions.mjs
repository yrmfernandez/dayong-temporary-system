/**
 * Read-only: MAS batches still waiting in Submitted by MAS (Collections and New Sales) whose items are already saved
 * another way (owner, November 20, 2026), with the clearing each one holds. The same matching as
 * lib/submission-already-saved.ts: a collection on the same account with an overlapping NOP range; a New Sale with the
 * same application number, or of the same existing member in the same program. Close them on Collections or New Sales
 * → Submitted by MAS → Already saved: close batch.
 *
 *   npm run prod -- node scripts/find-stuck-submissions.mjs
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log(`Supabase project: ${project}\n`);
  const collections = await sql`
    select s.submission_id as id, s.status, s.branch, s.mas, s.clearing_id, s.submitted_at, s.entry_count as total,
      count(distinct e->>'enrollmentId') filter (where exists (
        select 1 from collections c where c.enrollment_id = e->>'enrollmentId' and c.status = 'Posted' and c.nop_from is not null
          and c.nop_from <= coalesce(nullif(e->>'nopTo', '')::int, (e->>'nopFrom')::int) and coalesce(c.nop_to, c.nop_from) >= (e->>'nopFrom')::int)) as saved,
      (select status from clearings k where k.clearing_id = s.clearing_id) as clearing_status
    from collection_submissions s cross join lateral jsonb_array_elements(s.entries) e
    where s.status in ('Submitted', 'Remitted') group by s.submission_id order by s.submitted_at`;
  const sales = await sql`
    select s.submission_id as id, s.status, s.branch, s.mas, s.clearing_id, s.submitted_at, s.sale_count as total,
      count(*) filter (where exists (
        select 1 from sales x where (nullif(upper(regexp_replace(coalesce(c->>'applicationNumber', ''), '[^A-Za-z0-9]', '', 'g')), '') = x.application_key)
          or (coalesce(c#>>'{member,id}', '') <> '' and coalesce(c#>>'{program,programId}', '') = x.program_id
            and x.member_number = (select m.member_number from members m where m.member_id = c#>>'{member,id}')))) as saved,
      (select status from clearings k where k.clearing_id = s.clearing_id) as clearing_status
    from sale_submissions s cross join lateral jsonb_array_elements(s.sales) c
    where s.status in ('Submitted', 'Remitted') group by s.submission_id order by s.submitted_at`;
  for (const [page, rows] of [["Collections", collections], ["New Sales", sales]]) {
    const stuck = rows.filter((row) => Number(row.saved) > 0);
    console.log(`${page}: ${rows.length} batch(es) waiting, ${stuck.length} with items already saved`);
    for (const row of stuck) {
      const all = Number(row.saved) >= Number(row.total);
      console.log(`  ${row.id} · ${row.mas} · ${row.branch} · ${row.status} · submitted ${new Date(row.submitted_at).toISOString().slice(0, 16)} · ${row.saved} of ${row.total} saved · ${all ? "close with Already saved" : "Review, remove the saved ones, save the rest"}${row.clearing_id ? ` · clearing ${row.clearing_id} (${row.clearing_status ?? "missing"})` : ""}`);
    }
    console.log("");
  }
} finally {
  await sql.end();
}
