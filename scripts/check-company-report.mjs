/**
 * Read-only: rebuilds the Company Reports figures for a period straight from the database, with the same rules as
 * lib/reports.ts buildOperationalReport, and lists what can make them look wrong (owner, October 27, 2026: "it seems
 * not reading correctly"). Compare its totals with the screen for the same dates and branch.
 *
 *   npm run prod -- node scripts/check-company-report.mjs 2026-10-01 2026-10-31 [BRANCH]
 *
 * Rules the report uses: New Sales on the Manila day they were saved (date_created), gross = amount paid; posted
 * Collections on their OR date, gross = amount collected; company share = the saved remittance amount (gross when none
 * is saved, so no incentive); incentives = gross less company share; expenses posted by expense date; approved
 * remittances by Date Remitted (less Fidelity counted in them); bank deposits = the clerks' Bank deposits (not voided)
 * plus posted cash inflows whose category mentions deposit (since October 27, 2026; before, only the latter). Totals, counts, branch names and IDs only; no member data. Nothing is written.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const [from, to, branch = ""] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) { console.error("Usage: node scripts/check-company-report.mjs <from YYYY-MM-DD> <to YYYY-MM-DD> [branch]"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const peso = (value) => `₱${Number(value ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const branchIs = (column) => branch ? sql`and trim(${sql(column)}) = ${branch}` : sql``;
const saleDay = sql`(date_created at time zone 'Asia/Manila')::date`;

try {
  console.log(`Database ${ref} (read only) · ${from} to ${to}${branch ? ` · branch ${branch}` : " · all branches"}`);
  const [s] = await sql`select count(*)::int as n, coalesce(sum(amount_paid), 0)::float8 as gross, coalesce(sum(coalesce(remittance_amount, amount_paid)), 0)::float8 as share,
      coalesce(sum(penalty_amount), 0)::float8 as penalty, count(*) filter (where remittance_amount is null)::int as unpriced
    from sales where ${saleDay} between ${from}::date and ${to}::date ${branchIs("branch")}`;
  const [c] = await sql`select count(*)::int as n, coalesce(sum(amount_collected), 0)::float8 as gross, coalesce(sum(coalesce(nullif(remittance_amount, 0), amount_collected)), 0)::float8 as share,
      coalesce(sum(penalty_amount), 0)::float8 as penalty, count(*) filter (where remittance_amount is null)::int as unpriced,
      count(*) filter (where remittance_amount > amount_collected)::int as share_above_gross
    from collections where lower(trim(status)) = 'posted' and or_date between ${from}::date and ${to}::date ${branchIs("branch")}`;
  const [e] = await sql`select coalesce(sum(amount), 0)::float8 as total, count(*)::int as n from expenses where lower(trim(status)) = 'posted' and expense_date between ${from}::date and ${to}::date ${branchIs("branch")}`;
  const [r] = await sql`select coalesce(sum(coalesce(total_remittance, 0) - case when coalesce(remarks, '') like '%(employee''s own money)%' then coalesce(fidelity_amount, 0) else 0 end), 0)::float8 as total, count(*)::int as n
    from remittances where status = 'Approved' and date_remitted between ${from}::date and ${to}::date ${branchIs("branch")}`;
  const [d] = await sql`select (select coalesce(sum(amount), 0) from cash_transactions where direction = 'inflow' and lower(category) like '%deposit%' and lower(trim(coalesce(status, 'posted'))) = 'posted'
      and transaction_date between ${from}::date and ${to}::date ${branchIs("branch")})::float8
    + (select coalesce(sum(amount), 0) from bank_deposits where coalesce(status, 'Posted') <> 'Voided' and deposit_date between ${from}::date and ${to}::date ${branchIs("branch")})::float8 as total`;
  const gross = s.gross + c.gross, net = s.share + c.share, expected = net - e.total;
  console.log("\nWhat the report should show:");
  console.log(`  Entries ${s.n + c.n} (New Sales ${s.n}, Collections ${c.n})`);
  console.log(`  Gross ${peso(gross)} (New Sales ${peso(s.gross)}, Collections ${peso(c.gross)})`);
  console.log(`  Incentives ${peso(gross - net)} · Company share ${peso(net)} · Penalties ${peso(s.penalty + c.penalty)}`);
  console.log(`  Posted expenses ${peso(e.total)} (${e.n}) · Expected remittance ${peso(expected)}`);
  console.log(`  Approved remittances ${peso(r.total)} (${r.n} slips by Date Remitted) · Difference ${peso(expected - r.total)} · Bank deposits ${peso(d.total)}`);

  console.log("\nBy branch (gross · entries):");
  for (const row of await sql`select branch, sum(gross)::float8 as gross, sum(n)::int as n from (
      select coalesce(nullif(trim(branch), ''), 'Unassigned') as branch, amount_paid as gross, 1 as n from sales where ${saleDay} between ${from}::date and ${to}::date ${branchIs("branch")}
      union all select coalesce(nullif(trim(branch), ''), 'Unassigned'), amount_collected, 1 from collections where lower(trim(status)) = 'posted' and or_date between ${from}::date and ${to}::date ${branchIs("branch")}
    ) x group by 1 order by 1`) console.log(`  ${row.branch}: ${peso(row.gross)} · ${row.n}`);

  console.log("\nThings that can make it look wrong:");
  const [late] = await sql`select count(*)::int as n, coalesce(sum(amount_paid), 0)::float8 as gross, min(or_date)::text as earliest from sales
    where ${saleDay} between ${from}::date and ${to}::date ${branchIs("branch")} and or_date is not null and or_date < ${from}::date`;
  console.log(`  New Sales saved in the period with an application date before it (counted here by the day saved): ${late.n} · ${peso(late.gross)}${late.n ? ` · earliest application date ${late.earliest}` : ""}`);
  const [early] = await sql`select count(*)::int as n, coalesce(sum(amount_paid), 0)::float8 as gross from sales
    where or_date between ${from}::date and ${to}::date ${branchIs("branch")} and ${saleDay} > ${to}::date`;
  console.log(`  New Sales with an application date in the period but saved after it (not counted here): ${early.n} · ${peso(early.gross)}`);
  const byDay = await sql`select ${saleDay}::text as day, count(*)::int as n, count(*) filter (where coalesce(encoded_by_employee_id, '') = '')::int as imported from sales
    where ${saleDay} between ${from}::date and ${to}::date ${branchIs("branch")} group by 1 having count(*) filter (where coalesce(encoded_by_employee_id, '') = '') > 20 order by 2 desc limit 5`;
  for (const row of byDay) console.log(`  ${row.day}: ${row.n} New Sales saved that day, ${row.imported} without an encoder (an import?)`);
  console.log(`  Collections never priced (incentive counted as 0): ${c.unpriced} · New Sales never priced: ${s.unpriced}`);
  if (c.share_above_gross) console.log(`  Collections whose saved company share is above the amount collected (incentive shown as 0): ${c.share_above_gross}`);
  const [voided] = await sql`select count(*)::int as n, coalesce(sum(amount_collected), 0)::float8 as gross from collections where lower(trim(status)) <> 'posted' and or_date between ${from}::date and ${to}::date ${branchIs("branch")}`;
  console.log(`  Collections in the period not Posted (voided etc., left out): ${voided.n} · ${peso(voided.gross)}`);
  const [dup] = await sql`select count(*)::int as n, coalesce(sum(amount_collected), 0)::float8 as gross from collections where legacy_duplicate and lower(trim(status)) = 'posted' and or_date between ${from}::date and ${to}::date ${branchIs("branch")}`;
  console.log(`  Posted collections flagged as possible old-sheet duplicates (counted; review in Exceptions): ${dup.n} · ${peso(dup.gross)}`);
  const [future] = await sql`select count(*)::int as n from collections where lower(trim(status)) = 'posted' and or_date > (now() at time zone 'Asia/Manila')::date`;
  console.log(`  Posted collections with an OR date after today (anywhere): ${future.n}`);
  const [slips] = await sql`select count(*)::int as n, coalesce(sum(total_remittance), 0)::float8 as total from remittances r where status = 'Approved' and date_remitted between ${from}::date and ${to}::date ${branchIs("branch")}
    and exists (select 1 from remittance_collections rc join collections c on c.collection_id = rc.collection_id where rc.remittance_id = r.remittance_id and c.or_date < ${from}::date)`;
  console.log(`  Approved slips in the period that include collections with an OR date before it (cash for an earlier period): ${slips.n} · ${peso(slips.total)}`);

  // Clerk reports count what each clerk encoded, by the Manila day it was encoded (lib/clerk-report.ts → todays-entries
  // "encoded"), only entries with an encoder; Company Reports count collections by OR date, imports included.
  const encodedDay = sql`(coalesce(encoded_at, created_at) at time zone 'Asia/Manila')::date`;
  const posted = sql`lower(trim(status)) = 'posted'`;
  const rows = await sql`select coalesce(nullif(trim(branch), ''), 'Unassigned') as branch,
      coalesce(sum(amount_collected) filter (where or_date between ${from}::date and ${to}::date), 0)::float8 as company,
      coalesce(sum(amount_collected) filter (where coalesce(encoded_by_employee_id, '') <> '' and ${encodedDay} between ${from}::date and ${to}::date), 0)::float8 as clerks,
      coalesce(sum(amount_collected) filter (where or_date between ${from}::date and ${to}::date and coalesce(encoded_by_employee_id, '') = ''), 0)::float8 as imported,
      coalesce(sum(amount_collected) filter (where coalesce(encoded_by_employee_id, '') <> '' and ${encodedDay} between ${from}::date and ${to}::date and not (or_date between ${from}::date and ${to}::date)), 0)::float8 as encoded_here_or_elsewhere,
      coalesce(sum(amount_collected) filter (where coalesce(encoded_by_employee_id, '') <> '' and or_date between ${from}::date and ${to}::date and not (${encodedDay} between ${from}::date and ${to}::date)), 0)::float8 as or_here_encoded_elsewhere
    from collections where ${posted} ${branchIs("branch")} and (or_date between ${from}::date - 400 and ${to}::date + 400) group by 1 order by 1`;
  console.log("\nCollections by branch: Company Reports (OR date) vs clerk reports (date encoded, encoded entries only)");
  console.log("  branch: company · clerks · difference = old-sheet imports (company only) − encoded in the period with an OR date outside it (clerks only) + OR date in the period, encoded outside it (company only)");
  for (const row of rows) {
    if (!row.company && !row.clerks) continue;
    const diff = row.company - row.clerks;
    console.log(`  ${row.branch}: ${peso(row.company)} · ${peso(row.clerks)} · ${diff ? `${diff > 0 ? "+" : "−"}${peso(Math.abs(diff))} = ${peso(row.imported)} − ${peso(row.encoded_here_or_elsewhere)} + ${peso(row.or_here_encoded_elsewhere)}` : "match"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
