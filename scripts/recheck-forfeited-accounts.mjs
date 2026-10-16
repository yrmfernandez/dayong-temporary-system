/**
 * New forfeiture rule (owner, October 16, 2026): Pay the Balance programs are forfeited only after more than 12 months
 * without payment; other programs after more than 6 (forfeitMonthsFor in lib/account-rules.ts). On Pay the Balance
 * programs a stored Forfeited no longer holds (the owner: wait the full 12 months), so screens that work the status out
 * already show it right; this stores the worked-out status on those accounts, so lists and filters that read the stored
 * status agree. Prints IDs and statuses only.
 *
 *   node scripts/recheck-forfeited-accounts.mjs                    dry run (staging)
 *   npm run prod -- node scripts/recheck-forfeited-accounts.mjs [--apply]
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, forfeitMonthsFor, PAY_THE_BALANCE_CATEGORY_ID, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const today = todayInManila();
class DryRun extends Error {}

try {
  console.log(`Database ${ref}${apply ? " (APPLY)" : " (dry run)"} · today ${today}`);
  await sql.begin(async (tx) => {
    const accounts = await tx`select mp.enrollment_id, mp.member_id, mp.program_id, mp.doi::text as doi, mp.account_status, p.program_name, p.category_id, c.category_name,
        coalesce(p.base_pay, 0)::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, coalesce(p.flexible, false) as flexible, p.max_monthly_payment::float8 as max
      from member_programs mp join programs p on p.program_id = mp.program_id left join program_categories c on c.category_id = p.category_id
      where mp.account_status = 'Forfeited' and (p.category_id = ${PAY_THE_BALANCE_CATEGORY_ID} or lower(trim(c.category_name)) = 'pay the balance')
      for update of mp`;
    const ids = accounts.map((account) => account.enrollment_id);
    const payments = ids.length ? await tx`select collection_id, enrollment_id, or_date::text as or_date, or_number, month_from, month_to, nop_from, nop_to, amount_collected::float8 as amount
      from collections where enrollment_id in ${tx(ids)} and status = 'Posted'` : [];
    const reopen = [], kept = [], failed = [];
    for (const account of accounts) {
      const list = payments.filter((p) => p.enrollment_id === account.enrollment_id).map((p) => ({ id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.or_date, orNumber: p.or_number ?? "", monthFrom: (p.month_from ?? "").slice(0, 7), monthTo: (p.month_to ?? "").slice(0, 7), nopFrom: p.nop_from ?? 0, nopTo: p.nop_to ?? 0, amount: p.amount, dateRemitted: "", mas: "" }));
      const base = { id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi: account.doi ?? "", branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total, storedStatus: account.account_status, flexible: account.flexible, maxMonthlyPayment: account.max };
      try {
        const atRule = accountState({ ...base, forfeitMonths: forfeitMonthsFor(account.category_id, account.category_name ?? "") }, list, today);
        if (atRule.status !== "Forfeited") reopen.push({ id: account.enrollment_id, program: account.program_name, status: atRule.status, forfeitedAt: atRule.forfeitedAt });
        else kept.push({ id: account.enrollment_id, program: account.program_name, why: `more than 12 months without payment (forfeited since ${atRule.forfeitedAt})` });
      } catch (error) { failed.push({ id: account.enrollment_id, program: account.program_name, why: error instanceof Error ? error.message : "payments do not fit" }); }
    }
    console.log(`\nPay the Balance accounts stored Forfeited: ${accounts.length}`);
    console.log(`\nReopened (within 12 months of their last payment):${reopen.length}`);
    for (const item of reopen) console.log(`  ${item.id} · ${item.program} · Forfeited → ${item.status} (would be forfeited from ${item.forfeitedAt})`);
    console.log(`\nKept Forfeited: ${kept.length}`);
    for (const item of kept) console.log(`  ${item.id} · ${item.program} · ${item.why}`);
    if (failed.length) { console.log(`\nNot checked (history needs review): ${failed.length}`); for (const item of failed) console.log(`  ${item.id} · ${item.program} · ${item.why}`); }
    for (const item of reopen) await tx`update member_programs set account_status = ${item.status} where enrollment_id = ${item.id}`;
    if (reopen.length) {
      const stamp = new Date().toISOString();
      await tx`select set_config('app.user_name', 'Forfeiture rule recheck', true)`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-FORFEIT-PTB-${Date.now().toString(36).toUpperCase()}`, module: "Account status", record_id: "Pay the Balance", reason: "New rule (owner, October 16, 2026): Pay the Balance programs are not forfeited until more than 12 months without payment. Accounts within 12 months of their last payment reopened.", before_json: reopen.map((item) => ({ id: item.id, status: "Forfeited" })), after_json: reopen.map((item) => ({ id: item.id, status: item.status })), corrected_at: stamp, encoded_by_name: "Forfeiture rule recheck", encoded_at: stamp })}`;
    }
    if (!apply) throw new DryRun();
  });
  console.log(apply ? "\nApplied." : "");
} catch (error) {
  if (error instanceof DryRun) console.log("\nDry run rolled back. Add --apply to write.");
  else throw error;
} finally {
  await sql.end();
}
