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

/** Due dates of a monthly account from the month after its DOI, within [from, to]. */
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

/** MAS name (lower case) → expected accounts and amount for [from, to] in these branches. */
export async function expectedByMas(from: string, to: string, branches: string[]): Promise<Map<string, Expected>> {
  const result = new Map<string, Expected>();
  const names = branches.map((branch) => text(branch).toLowerCase()).filter(Boolean);
  if (!names.length) return result;
  const accounts = rowsOf<{ mas: string; doi: string; rate: number }>(await currentDb().execute(sql`
    select lower(trim(coalesce(mp.mas, ''))) as mas, mp.doi::text as doi, coalesce(p.base_pay, 0)::float8 as rate
    from member_programs mp join programs p on p.program_id = mp.program_id
    where lower(trim(coalesce(mp.branch, ''))) in (${sql.join(names.map((name) => sql`${name}`), sql`, `)})
      and coalesce(mp.account_status, '') not in ('Forfeited', 'Paid', 'Fully Paid') and mp.doi is not null and mp.doi <= ${to}::date`));
  for (const account of accounts) {
    const dues = duesIn(account.doi, from, to);
    if (!dues.length || !account.mas) continue;
    const entry = result.get(account.mas) ?? { accounts: 0, gross: 0 };
    entry.accounts += 1;
    entry.gross = Math.round((entry.gross + dues.length * Number(account.rate)) * 100) / 100;
    result.set(account.mas, entry);
  }
  return result;
}
