/**
 * Read-only: a clerk's submitted weeklies and what they encoded each day around them (counts and totals only, no member
 * details), to see why a day is missing from a weekly report.
 *
 *   npm run prod -- node scripts/inspect-weekly.mjs ABESIA
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const name = process.argv[2];
if (!name) throw new Error("Usage: node scripts/inspect-weekly.mjs <part of the clerk's name>");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const clerks = await sql`select employee_id, full_name, primary_branch, employment_status from employees where full_name ilike ${`%${name}%`}`;
  console.log("Clerks:", clerks);
  for (const clerk of clerks) {
    const weeks = await sql`select audit_id, report_date::text as start, end_date::text as "end", month_label, submission, status, returned_at, submitted_at, updated_at from weekly_audits where employee_id = ${clerk.employee_id} order by report_date`;
    console.log(`\n${clerk.full_name} (${clerk.employee_id}) weeklies:`, weeks);
    const monthlies = await sql`select audit_id, report_date::text as start, end_date::text as "end", month_label, submission, status from monthly_audits where employee_id = ${clerk.employee_id} order by report_date`;
    console.log("monthlies:", monthlies);
    const from = weeks[0]?.start ?? "2026-10-01";
    const days = await sql`
      select day, kind, branch, count(*)::int as n, sum(amount)::float8 as amount from (
        select (coalesce(encoded_at, date_created) at time zone 'Asia/Manila')::date::text as day, 'sale' as kind, branch, coalesce(amount_paid, 0) as amount
          from sales where encoded_by_employee_id = ${clerk.employee_id}
        union all
        select (coalesce(encoded_at, created_at) at time zone 'Asia/Manila')::date::text, 'collection', branch, coalesce(amount_collected, 0)
          from collections where encoded_by_employee_id = ${clerk.employee_id} and status = 'Posted'
      ) e where day >= (${from}::date - 3)::text group by day, kind, branch order by day, kind, branch`;
    console.log("encoded per Manila day:", days);
    const audits = await sql`select report_date::text as day, status, result from daily_audits where employee_id = ${clerk.employee_id} and report_date >= (${from}::date - 3) order by report_date`;
    console.log("daily audits:", audits);
  }
} finally {
  await sql.end();
}
