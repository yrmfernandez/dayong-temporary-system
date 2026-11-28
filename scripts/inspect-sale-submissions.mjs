/**
 * Read-only: the latest MAS New Sales submissions (Submit New Sales), to see whether a submit reached the server. IDs,
 * times, counts, totals and sizes only; no member names or personal details.
 *
 *   npm run prod -- node scripts/inspect-sale-submissions.mjs [how many, default 15]
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const limit = Math.min(100, Math.max(1, Number(process.argv[2]) || 15));

try {
  console.log(`Supabase project: ${/postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown"}\n`);
  const rows = await sql`select submission_id, branch, mas_employee_id, status, sale_count, total_amount, length(sales::text) as bytes,
      (submitted_at at time zone 'Asia/Manila')::text as submitted_manila
    from sale_submissions order by row_seq desc limit ${limit}`;
  if (!rows.length) console.log("No submissions.");
  for (const row of rows) console.log(`${row.submission_id} · ${row.status} · ${row.branch} · MAS ${row.mas_employee_id} · ${row.sale_count} sale(s) · ${row.total_amount} · ${row.bytes} bytes · submitted ${row.submitted_manila}`);
} finally {
  await sql.end();
}
