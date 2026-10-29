/**
 * Read-only: how a month's New Sales and Collections are covered by the Entry Clerks' reports (owner, October 29, 2026:
 * the system was started around the 2nd week of October, so the clerks' October monthly reports miss the first days).
 * Counts and totals only, by source (imported old sheet -LEG-, imported old web app -WEB-, encoded in this system),
 * by whether an encoder is on record, and by branch and week. No member data. Nothing is written.
 *
 *   node scripts/inspect-month-coverage.mjs 2026-10                    staging
 *   npm run prod -- node scripts/inspect-month-coverage.mjs 2026-10    production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const month = process.argv[2] ?? "";
if (!/^\d{4}-\d{2}$/.test(month)) { console.log("Give the month as YYYY-MM, e.g. 2026-10."); process.exit(1); }
const from = `${month}-01`;
const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

try {
  console.log(`Database ${ref} (read only) · ${from} to ${to}`);
  for (const [table, id, amount] of [["sales", "sale_id", "amount_paid"], ["collections", "collection_id", "amount_collected"]]) {
    const source = sql`case when ${sql(id)} like '%-LEG-%' then 'old sheet' when ${sql(id)} like '%-WEB-%' then 'old web app' else 'this system' end`;
    const encoder = sql`case when coalesce(encoded_by_employee_id, '') = '' then 'no encoder' else 'encoder on record' end`;
    const posted = table === "collections" ? sql`and status = 'Posted'` : sql``;
    const inMonth = sql`coalesce(or_date, date_remitted) between ${from}::date and ${to}::date ${posted}`;
    console.log(`\n${table}: receipt (OR / application) date in the month`);
    console.table(await sql`select ${source} as source, ${encoder} as encoder, count(*)::int as entries, sum(${sql(amount)})::float8 as gross,
        min(coalesce(or_date, date_remitted))::text as first_date, max(coalesce(or_date, date_remitted))::text as last_date,
        min((encoded_at at time zone 'Asia/Manila')::date)::text as first_encoded, max((encoded_at at time zone 'Asia/Manila')::date)::text as last_encoded
      from ${sql(table)} where ${inMonth} group by 1, 2 order by 1, 2`);
    console.log(`${table}: by branch and week of the receipt date, entries with no encoder or encoded after the week`);
    console.table(await sql`select coalesce(branch, '—') as branch, to_char(date_trunc('week', coalesce(or_date, date_remitted)), 'YYYY-MM-DD') as week_of,
        count(*)::int as entries, count(*) filter (where coalesce(encoded_by_employee_id, '') = '')::int as no_encoder,
        count(*) filter (where coalesce(encoded_by_employee_id, '') <> '' and (encoded_at at time zone 'Asia/Manila')::date not between ${from}::date and ${to}::date)::int as encoded_outside_month,
        count(distinct mas)::int as mas
      from ${sql(table)} where ${inMonth} group by 1, 2 order by 1, 2`);
  }
  console.log("\nEntry Clerks and their branches");
  console.table(await sql`select e.employee_id, e.full_name, e.primary_branch, string_agg(distinct b.branch_name_code, ', ') as branches,
      (select min((x.encoded_at at time zone 'Asia/Manila')::date)::text from (select encoded_at from sales where encoded_by_employee_id = e.employee_id union all select encoded_at from collections where encoded_by_employee_id = e.employee_id) x) as first_encoded
    from employees e left join employee_branches eb on eb.employee_id = e.employee_id left join branches b on b.branch_id = eb.branch_id
    where lower(coalesce(e.employment_status, 'active')) = 'active'
      and (lower(coalesce(e.operational_roles, '')) like '%entry clerk%' or exists (select 1 from users u join user_roles ur on ur.user_id = u.user_id join roles r on r.role_id = ur.role_id where u.employee_id = e.employee_id and lower(r.role_name) = 'entry clerk'))
    group by 1, 2, 3 order by 3, 2`);
} finally {
  await sql.end();
}
