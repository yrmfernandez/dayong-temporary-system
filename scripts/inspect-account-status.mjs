/**
 * Read-only: why a member's account shows its status (owner, October 26, 2026: PH-73684484 still Forfeited after its
 * record was corrected). For each of the member's accounts: program, DOI, the stored status, the status worked out
 * from its receipts with and without a Forfeited carried from the old system (forfeit_held, migration 0029), every
 * posted receipt (OR date, months, NOP, amount) and who changed the stored status, and when (Audit Log). Then, across
 * all accounts: how many are stored Forfeited although their receipts alone do not make them forfeited, and who stored
 * that status, and the member numbers of those held only as carried from the old system (owner, October 29, 2026: to
 * reopen one by one in Member Corrections). IDs, dates, amounts and statuses only; no names. Nothing is written.
 *
 *   npm run prod -- node scripts/inspect-account-status.mjs PH-73684484
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, forfeitMonthsFor, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const number = process.argv[2]?.trim();
if (!number) { console.error("Usage: node scripts/inspect-account-status.mjs <member number>"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const today = todayInManila();

const accountsWhere = (where) => sql`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, mp.doi::text as doi, mp.account_status, mp.forfeit_held, mp.status as enrollment_status,
    p.program_name, p.category_id, c.category_name, coalesce(p.base_pay, 0)::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total,
    coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max
  from member_programs mp join programs p on p.program_id = mp.program_id left join program_categories c on c.category_id = p.category_id where ${where}`;
const paymentsOf = async (ids) => ids.length ? sql`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
  from collections where enrollment_id in ${sql(ids)} and status = 'Posted' order by or_date, nop_from` : [];
const toPayment = (p) => ({ id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.or_date, orNumber: p.or_number ?? "", monthFrom: (p.month_from ?? "").slice(0, 7), monthTo: (p.month_to ?? "").slice(0, 7), nopFrom: p.nop_from ?? 0, nopTo: p.nop_to ?? 0, amount: p.amount, dateRemitted: "", mas: "" });
const states = (account, list) => {
  const base = { id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi: account.doi ?? "", branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total, flexible: account.flexible, maxMonthlyPayment: account.max, forfeitMonths: forfeitMonthsFor(account.category_id, account.category_name ?? "") };
  const run = (forfeitHeld) => { try { return accountState({ ...base, storedStatus: account.account_status ?? "", forfeitHeld }, list, today); } catch (error) { return { status: `error: ${error instanceof Error ? error.message : error}` }; } };
  return { withStored: run(Boolean(account.forfeit_held)), receiptsOnly: run(false) };
};

try {
  console.log(`Database ${ref} (read only) · today ${today} · member ${number}`);
  const accounts = await accountsWhere(sql`mp.member_number = ${number}`);
  if (!accounts.length) console.log("No accounts with that member number.");
  const payments = await paymentsOf(accounts.map((account) => account.enrollment_id));
  for (const account of accounts) {
    const list = payments.filter((p) => p.enrollment_id === account.enrollment_id).map(toPayment);
    const { withStored, receiptsOnly } = states(account, list);
    console.log(`\n${account.enrollment_id} · ${account.program_name} · DOI ${account.doi} · enrollment ${account.enrollment_status || "-"} · stored ${account.account_status || "-"}${account.forfeit_held ? " (held: carried from the old system)" : ""}`);
    console.log(`  shown now: ${withStored.status}`);
    console.log(`  from the receipts alone: ${receiptsOnly.status}${receiptsOnly.paidThrough ? ` · paid through ${receiptsOnly.paidThrough} · 60D/suspended ${receiptsOnly.suspendedAt} · forfeited from ${receiptsOnly.forfeitedAt}` : ""}`);
    console.table(list.map((p) => ({ id: p.id, orDate: p.orDate, months: `${p.monthFrom}..${p.monthTo}`, nop: `${p.nopFrom}-${p.nopTo}`, amount: p.amount })));
    const history = await sql`select to_char(logged_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as at, coalesce(user_name, user_id, '') as by, changes_json -> 'account_status' as change
      from audit_log where table_name = 'member_programs' and record_id = ${account.enrollment_id} and changes_json ? 'account_status' order by logged_at`;
    console.log(`  stored status changes: ${history.length ? "" : "none logged"}`);
    for (const row of history) console.log(`    ${row.at} · ${row.by || "?"} · ${JSON.stringify(row.change)}`);
  }

  const stuck = await accountsWhere(sql`mp.account_status = 'Forfeited'`);
  const stuckPayments = await paymentsOf(stuck.map((account) => account.enrollment_id));
  const byAccount = new Map();
  for (const p of stuckPayments) byAccount.set(p.enrollment_id, [...(byAccount.get(p.enrollment_id) ?? []), toPayment(p)]);
  const heldOnly = stuck.filter((account) => { const { receiptsOnly } = states(account, byAccount.get(account.enrollment_id) ?? []); return receiptsOnly.status !== "Forfeited" && !String(receiptsOnly.status).startsWith("error"); });
  console.log(`\nAll accounts stored Forfeited: ${stuck.length}; Forfeited although the receipts alone say otherwise: ${heldOnly.length} (held as carried from the old system: ${heldOnly.filter((a) => a.forfeit_held).length}; to reopen on the next recalculation: ${heldOnly.filter((a) => !a.forfeit_held).length})`);
  if (heldOnly.length) {
    const who = await sql`select coalesce(nullif(a.user_name, ''), a.user_id, '(not logged)') as by, count(*)::int as n from (
        select distinct on (record_id) record_id, user_name, user_id from audit_log where table_name = 'member_programs' and record_id in ${sql(heldOnly.map((a) => a.enrollment_id))}
          and changes_json -> 'account_status' ->> 'to' = 'Forfeited' order by record_id, logged_at desc) a group by 1 order by 2 desc`;
    const logged = who.reduce((sum, row) => sum + row.n, 0);
    console.log(`  who last stored Forfeited on them: ${who.map((row) => `${row.by} ${row.n}`).join(", ") || "none logged"}${heldOnly.length - logged ? `; not in the Audit Log (imported or before logging) ${heldOnly.length - logged}` : ""}`);
    for (const account of heldOnly.filter((a) => a.forfeit_held)) {
      const { receiptsOnly } = states(account, byAccount.get(account.enrollment_id) ?? []);
      console.log(`    ${account.member_number || "(no member number)"} · ${account.enrollment_id} · ${account.program_name} · from the receipts alone: ${receiptsOnly.status}${receiptsOnly.paidThrough ? ` · paid through ${receiptsOnly.paidThrough}` : ""}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
