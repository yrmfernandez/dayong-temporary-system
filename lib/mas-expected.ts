import { sql } from "drizzle-orm";

import { currentDb } from "@/lib/db";

/**
 * What each MAS was expected to collect in a period, for the CVE (%) columns of the per-MAS report (owner, October 11,
 * 2026: CVE% = Collection GROSS ÷ CVE GROSS, the sheet's G/J). An account counts when it is open (not Forfeited or
 * Paid) and its monthly due falls in the period: each month after the DOI's month, on the DOI's day (the last day of a
 * shorter month). CVE ACCTS = accounts with a due in the period; CVE GROSS = their monthly dues added up (a yearly
 * report adds every month's). Accounts are those of the report's branches, by the MAS name on the account.
 */
export type Expected = { accounts: number; gross: number };
const text = (value: unknown) => String(value ?? "").trim();
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const iso = (year: number, month: number, day: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

/** Due dates of a monthly account from the month after its DOI, within [from, to]: the rule expectedByMas counts in SQL (the tests compare the two). */
export function duesIn(doi: string, from: string, to: string) {
  const [dy, dm, dd] = doi.split("-").map(Number);
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const dues: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    if (y * 12 + m <= dy * 12 + dm) continue; // the DOI's month is the New Sale
    const due = iso(y, m, dd);
    if (due >= from && due <= to) dues.push(due);
  }
  return dues;
}

/**
 * MAS name (lower case) → expected accounts and amount for [from, to] in these branches. Counted in the database
 * (November 10, 2026), the same rule as duesIn: every open account of the branch came to the server on each clerk report,
 * about 12% of all rows read in production (pg_stat_statements, November 5–10), only to be added up here; now one row per
 * MAS comes back. Each month of the period after the DOI's month has a due on the DOI's day, or on the month's last day
 * when the month is shorter; it counts when it falls within [from, to].
 */
export async function expectedByMas(from: string, to: string, branches: string[]): Promise<Map<string, Expected>> {
  const result = new Map<string, Expected>();
  const names = branches.map((branch) => text(branch).toLowerCase()).filter(Boolean);
  if (!names.length) return result;
  const rows = rowsOf<{ mas: string; accounts: number; gross: number }>(await currentDb().execute(sql`
    with accounts as (
      select mp.enrollment_id, lower(trim(coalesce(mp.mas, ''))) as mas, mp.doi, coalesce(p.base_pay, 0) as rate
      from member_programs mp join programs p on p.program_id = mp.program_id
      where lower(trim(coalesce(mp.branch, ''))) in (${sql.join(names.map((name) => sql`${name}`), sql`, `)})
        and coalesce(mp.account_status, '') not in ('Forfeited', 'Paid', 'Fully Paid') and mp.doi is not null and mp.doi <= ${to}::date
        and trim(coalesce(mp.mas, '')) <> ''),
    months as (select month::date as month from generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month') as month),
    -- A month's first day after the DOI is a month after the DOI's month. Dues per account first: no count(distinct).
    per_account as (
      select a.mas, a.rate, count(*) as dues from accounts a join months m on m.month > a.doi
      where m.month + (least(extract(day from a.doi)::int, extract(day from m.month + interval '1 month' - interval '1 day')::int) - 1) between ${from}::date and ${to}::date
      group by a.enrollment_id, a.mas, a.rate)
    select mas, count(*)::int as accounts, round(sum(rate * dues), 2)::float8 as gross from per_account group by mas`));
  for (const row of rows) result.set(row.mas, { accounts: Number(row.accounts), gross: Number(row.gross) });
  return result;
}
