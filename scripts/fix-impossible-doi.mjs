/**
 * Replaces impossible DOIs (October 9, 2026), such as 1943-08-26 on a DSP-290 account (a birth date typed as the DOI).
 * Owner's rule: use the account's OR date / application date, and if it has none, the remittance date. In order:
 *   1. its New Sale's OR (application) date (same member number and program);
 *      (a source date that is itself before the cut-off or in the future is skipped);
 *   2. the OR date of its first posted collection;
 *   3. its New Sale's Date Remitted, then its first collection's Date Remitted.
 * The payment status is recalculated from the new DOI (lib/account-rules.ts); an account with no date at all is listed
 * and left. Every change is in the Audit Log and a summary in Record Corrections. Prints IDs, codes and dates only.
 *
 *   node scripts/fix-impossible-doi.mjs                         dry run on staging (DOIs before 2000-01-01)
 *   node scripts/fix-impossible-doi.mjs --before=2010-01-01     another cut-off
 *   npm run prod -- node scripts/fix-impossible-doi.mjs [--apply]
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const before = process.argv.find((arg) => arg.startsWith("--before="))?.slice(9) || "2000-01-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error("--before must be YYYY-MM-DD.");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const today = todayInManila();
const text = (value) => String(value ?? "").trim();

try {
  console.log(`Supabase project: ${project} · DOIs before ${before}${apply ? "" : " · dry run"}\n`);
  const accounts = await sql`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, mp.doi::text as doi, mp.account_status,
      p.program_code, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.flexible, p.max_monthly_payment::float8 as max,
      (select min(s.or_date)::text from sales s where s.member_number = mp.member_number and s.program_id = mp.program_id) as sale_or,
      (select min(c.or_date)::text from collections c where c.enrollment_id = mp.enrollment_id and lower(coalesce(c.status, '')) = 'posted') as first_or,
      (select min(s.date_remitted)::text from sales s where s.member_number = mp.member_number and s.program_id = mp.program_id) as sale_remitted,
      (select min(c.date_remitted)::text from collections c where c.enrollment_id = mp.enrollment_id) as first_remitted
    from member_programs mp join programs p on p.program_id = mp.program_id
    where mp.doi < ${before} order by mp.enrollment_id`;
  let fixed = 0, left = 0;
  for (const account of accounts) {
    // A source date carrying the same impossible date (a New Sale OR date of 1943) is skipped too.
    const [doi, source] = [[account.sale_or, "New Sale OR date"], [account.first_or, "first collection OR date"], [account.sale_remitted, "New Sale Date Remitted"], [account.first_remitted, "first collection Date Remitted"]]
      .find(([date]) => date && date >= before && date <= today) ?? ["", ""];
    if (!doi) { left++; console.log(`${account.enrollment_id} · ${account.program_code} · DOI ${account.doi}: no OR or remittance date; left as is`); continue; }
    const payments = (await sql`select collection_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
        from collections where enrollment_id = ${account.enrollment_id} and lower(coalesce(status, '')) = 'posted'`)
      .map((row) => ({ id: row.collection_id, enrollmentId: account.enrollment_id, orDate: row.or_date, orNumber: text(row.or_number), monthFrom: text(row.month_from), monthTo: text(row.month_to), nopFrom: Number(row.nop_from), nopTo: Number(row.nop_to), amount: Number(row.amount), dateRemitted: "", mas: "" }));
    let status = account.account_status;
    try {
      status = accountState({ id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi, branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total, storedStatus: "", flexible: account.flexible, maxMonthlyPayment: account.max }, payments, today).status;
    } catch { /* the history has its own problem; the DOI is still corrected and the stored status kept */ }
    console.log(`${account.enrollment_id} · ${account.program_code} · DOI ${account.doi} → ${doi} (${source}) · status ${account.account_status || "—"} → ${status || "—"}`);
    if (apply) {
      await sql.begin(async (tx) => {
        await tx`select set_config('app.user_name', 'DOI fix', true)`;
        await tx`update member_programs set doi = ${doi}, account_status = ${status} where enrollment_id = ${account.enrollment_id}`;
        await tx`insert into record_corrections ${tx({ correction_id: `COR-DOI-${account.enrollment_id}-${Date.now().toString(36).toUpperCase()}`, module: "DOI fix", record_id: account.enrollment_id,
          reason: `Impossible DOI replaced by the ${source} (owner, October 9, 2026)`, before_json: { doi: account.doi, status: account.account_status }, after_json: { doi, status },
          corrected_at: new Date().toISOString(), encoded_by_name: "DOI fix", encoded_at: new Date().toISOString() })}`;
      });
    }
    fixed++;
  }
  console.log(`\n${accounts.length} account(s) with a DOI before ${before} · ${apply ? "fixed" : "would fix"} ${fixed} · left ${left}`);
  if (!apply) console.log("Dry run: nothing was written. Add --apply to fix.");
} finally {
  await sql.end();
}
