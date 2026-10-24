/**
 * Read-only preview of the Month-of status rule (owner, October 24, 2026): Waiver, 60D–150D and Forfeited count from the
 * last covered month ("Month of") on the OR date's day (lib/account-rules.ts accountState). Compares each account's
 * status under the rule with the status stored now and prints how many would change, by change, with up to 15 account
 * IDs each. Nothing is written. Prints IDs and statuses only.
 *
 *   node scripts/preview-month-of-status-rule.mjs                     staging
 *   npm run prod -- node scripts/preview-month-of-status-rule.mjs     production
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, forfeitMonthsFor, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const today = todayInManila();

try {
  console.log(`Database ${ref} (read only) · today ${today}`);
  const accounts = await sql`select mp.enrollment_id, mp.member_id, mp.program_id, mp.doi::text as doi, coalesce(mp.account_status, '') as account_status, p.category_id, c.category_name,
      coalesce(p.base_pay, 0)::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max
    from member_programs mp join programs p on p.program_id = mp.program_id left join program_categories c on c.category_id = p.category_id`;
  const payments = await sql`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
    from collections where status = 'Posted'`;
  const byAccount = new Map();
  for (const p of payments) {
    const list = byAccount.get(p.enrollment_id) ?? [];
    list.push({ id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.or_date ?? "", orNumber: p.or_number ?? "", monthFrom: (p.month_from ?? "").slice(0, 7), monthTo: (p.month_to ?? "").slice(0, 7), nopFrom: p.nop_from ?? 0, nopTo: p.nop_to ?? 0, amount: p.amount, dateRemitted: "", mas: "" });
    byAccount.set(p.enrollment_id, list);
  }
  const changes = new Map();
  let same = 0, failed = 0, suspendedNow = 0;
  for (const account of accounts) {
    const base = { id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi: account.doi ?? "", branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total,
      storedStatus: account.account_status, flexible: account.flexible, maxMonthlyPayment: account.max, forfeitMonths: forfeitMonthsFor(account.category_id ?? "", account.category_name ?? "") };
    try {
      const state = accountState(base, byAccount.get(account.enrollment_id) ?? [], today);
      if (state.temporarilySuspended) suspendedNow++;
      if (state.status === account.account_status) { same++; continue; }
      const key = `${account.account_status || "(blank)"} → ${state.status}`;
      const list = changes.get(key) ?? [];
      list.push(account.enrollment_id);
      changes.set(key, list);
    } catch { failed++; }
  }
  console.log(`\nAccounts: ${accounts.length} · unchanged ${same} · history needs review (not checked) ${failed}`);
  console.log(`Temporarily suspended (Waiver needed) under the rule today: ${suspendedNow}`);
  console.log(`\nWould change (stored → under the Month-of rule):`);
  for (const [key, ids] of [...changes].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${key}: ${ids.length}${ids.length ? ` · e.g. ${ids.slice(0, 15).join(", ")}` : ""}`);
  }
  const newlyForfeited = [...changes].filter(([key]) => key.endsWith("→ Forfeited")).reduce((sum, [, ids]) => sum + ids.length, 0);
  console.log(`\nNewly Forfeited: ${newlyForfeited}. A stored Forfeited stays on programs that are not Pay the Balance, and forfeited accounts take no payments.`);
} finally {
  await sql.end();
}
