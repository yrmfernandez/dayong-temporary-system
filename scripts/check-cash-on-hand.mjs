/**
 * Read-only: how the clerk report's Remaining Cash on Hand (lib/clerk-report.ts) behaves day by day for each Entry
 * Clerk over a period. For every clerk and day it works out, like the daily report: Sales and Collection Net encoded that
 * day (split into cash and non-cash payment methods), Fidelity and penalty with the batches, expenses recorded that day,
 * cash forwarded to the bank dated that day, and the Cash Beg / Pending cash typed on that day's report. Then it compares
 * the report's figure (nothing carried) with a running balance that carries each day's remainder to the next.
 * Totals only; no member details. Approximates turnover short/over and Fidelity slips (left out).
 *
 *   npm run prod -- node scripts/check-cash-on-hand.mjs 2026-11-01 2026-11-23
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const [from = "2026-11-01", to = "2026-11-23"] = process.argv.slice(2);
const round = (value) => Math.round(value * 100) / 100;
const peso = (value) => round(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  console.log(`Supabase project: ${/postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown"} · ${from} to ${to}\n`);
  const methods = await sql`select method_name, coalesce(is_cash, false) as is_cash from remittance_methods`.catch(() => []);
  const cashNames = new Set(["cash", ...methods.filter((row) => row.is_cash).map((row) => String(row.method_name).trim().toLowerCase())]);
  const day = (column) => sql`(${sql(column)} at time zone 'Asia/Manila')::date`;
  const entries = await sql`
    select encoded_by_employee_id as clerk, ${day("encoded_at")}::text as day, 'sale' as kind, coalesce(payment_method, 'Cash') as method,
      coalesce(remittance_amount, amount_paid, 0)::float8 as net, coalesce(fidelity_amount, 0)::float8 as fidelity, coalesce(penalty_amount, 0)::float8 as penalty
    from sales where encoded_by_employee_id is not null and encoded_at is not null and ${day("encoded_at")} between ${from}::date and ${to}::date
    union all
    select encoded_by_employee_id, ${day("encoded_at")}::text, 'collection', coalesce(remittance_method, 'Cash'),
      coalesce(remittance_amount, amount_collected, 0)::float8, coalesce(fidelity_amount, 0)::float8, coalesce(penalty_amount, 0)::float8
    from collections where status = 'Posted' and encoded_by_employee_id is not null and encoded_at is not null and ${day("encoded_at")} between ${from}::date and ${to}::date`;
  const expenses = await sql`select encoded_by_employee_id as clerk, ${day("encoded_at")}::text as day, sum(amount)::float8 as amount from expenses
    where coalesce(status, 'Posted') = 'Posted' and encoded_at is not null and ${day("encoded_at")} between ${from}::date and ${to}::date group by 1, 2`;
  const deposits = await sql`select employee_id as clerk, deposit_date::text as day, sum(amount)::float8 as amount from bank_deposits
    where status <> 'Voided' and deposit_date between ${from}::date and ${to}::date group by 1, 2`;
  const notes = await sql`select employee_id as clerk, period_start::text as day, sum(coalesce(cash_beg, 0))::float8 as cash_beg, count(cash_beg)::int as typed,
      sum(coalesce(pending_cash, 0))::float8 as pending from report_notes where period_kind = 'daily' and period_start between ${from}::date and ${to}::date group by 1, 2`;
  const clerks = await sql`select employee_id, full_name from employees`;
  const names = new Map(clerks.map((row) => [row.employee_id, row.full_name]));

  const byClerk = new Map();
  const slot = (clerk, date) => {
    if (!byClerk.has(clerk)) byClerk.set(clerk, new Map());
    const days = byClerk.get(clerk);
    if (!days.has(date)) days.set(date, { cashNet: 0, nonCashNet: 0, fidelity: 0, penalty: 0, expenses: 0, deposits: 0, cashBeg: 0, typed: 0, pending: 0 });
    return days.get(date);
  };
  for (const row of entries) {
    const item = slot(row.clerk, row.day);
    if (cashNames.has(String(row.method).trim().toLowerCase())) item.cashNet += row.net; else item.nonCashNet += row.net;
    item.fidelity += row.fidelity; item.penalty += row.penalty;
  }
  for (const row of expenses) if (row.clerk) slot(row.clerk, row.day).expenses += row.amount;
  for (const row of deposits) slot(row.clerk, row.day).deposits += row.amount;
  for (const row of notes) { const item = slot(row.clerk, row.day); item.cashBeg += row.cash_beg; item.typed += row.typed; item.pending += row.pending; }

  for (const [clerk, days] of [...byClerk].sort((a, b) => String(names.get(a[0]) ?? a[0]).localeCompare(String(names.get(b[0]) ?? b[0])))) {
    const list = [...days].sort((a, b) => a[0].localeCompare(b[0]));
    if (!list.some(([, item]) => item.cashNet || item.nonCashNet || item.deposits)) continue;
    console.log(`${names.get(clerk) ?? clerk} (${clerk})`);
    console.log("  day         cash net   non-cash net  fid+pen   expenses   to bank   typed beg  pending | report COH  carried COH");
    let carried = 0, negative = 0, typedDays = 0, nonCash = 0;
    for (const [date, item] of list) {
      const cashIn = item.cashNet + item.nonCashNet + item.fidelity + item.penalty + item.pending;
      const out = item.expenses + item.deposits;
      const report = round(item.cashBeg + cashIn - out);
      // A running balance: yesterday's remainder carried, today's cash in (non-cash too: clerks cancel it by entering it as
      // cash forwarded to the bank), today's cash out. Typed Cash Beg and pending cash are left out.
      carried = round(carried + item.cashNet + item.nonCashNet + item.fidelity + item.penalty - out);
      if (report < 0) negative += 1;
      if (item.typed) typedDays += 1;
      nonCash += item.nonCashNet;
      console.log(`  ${date}  ${peso(item.cashNet).padStart(10)}  ${peso(item.nonCashNet).padStart(12)}  ${peso(item.fidelity + item.penalty).padStart(8)}  ${peso(item.expenses).padStart(9)}  ${peso(item.deposits).padStart(9)}  ${(item.typed ? peso(item.cashBeg) : "-").padStart(9)}  ${peso(item.pending).padStart(7)} | ${peso(report).padStart(10)}  ${peso(carried).padStart(11)}`);
    }
    console.log(`  → ${list.length} days · report COH negative on ${negative} · Cash Beg typed on ${typedDays} · non-cash counted as cash on hand ${peso(nonCash)} · carried balance at the end ${peso(carried)}\n`);
  }
} finally {
  await sql.end();
}
