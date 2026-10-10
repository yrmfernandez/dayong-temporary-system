/**
 * Clears payroll runs (owner, October 10, 2026: the runs made so far are tests). Dry run first: lists every run with
 * its period, status, employees, net total, its cash transaction and the commissions it paid. With --apply, in one
 * transaction: each run's adjustments, lines and the run itself are deleted; for a Paid run, its payroll cash-out
 * (Cash Transactions, reference Payroll) is deleted and the commissions it paid go back to Pending, so Finance can pay
 * them again. Every deleted or changed row is kept in the Audit Log. Prints amounts and IDs only (no member data).
 *
 *   node scripts/clear-payroll-runs.mjs                      dry run on staging
 *   npm run prod -- node scripts/clear-payroll-runs.mjs      dry run on production
 *   ... --apply                                              clear them
 *   ... --only=PAY-...,PAY-...                               only these runs
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const only = (process.argv.find((item) => item.startsWith("--only="))?.slice(7) ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const peso = (value) => Number(value ?? 0).toLocaleString("en-PH", { style: "currency", currency: "PHP" });

try {
  const runs = await sql`select payroll_id, period_from::text as period_from, period_to::text as period_to, status, employee_count, net_total, cash_transaction_id,
      (select count(*)::int from payroll_lines l where l.payroll_id = r.payroll_id) as lines,
      (select count(*)::int from payroll_adjustments a where a.payroll_id = r.payroll_id) as adjustments
    from payroll_runs r ${only.length ? sql`where payroll_id in ${sql(only)}` : sql``} order by period_from, payroll_id`;
  console.log(`Supabase project: ${project} · ${runs.length} payroll run(s)${only.length ? " (chosen)" : ""}${apply ? "" : " · dry run"}\n`);
  if (only.length && runs.length !== only.length) console.log(`Not found: ${only.filter((id) => !runs.some((run) => run.payroll_id === id)).join(", ")}\n`);
  const plan = [];
  for (const run of runs) {
    const lineRows = await sql`select commission_ids from payroll_lines where payroll_id = ${run.payroll_id}`;
    const commissionIds = [...new Set(lineRows.flatMap((row) => String(row.commission_ids ?? "").split(",").map((id) => id.trim()).filter(Boolean)))];
    // Commissions this run paid: Paid, with the run's ID as their reference (lib/payroll.ts pays them as "<run> · <ref>").
    const paidCommissions = commissionIds.length ? await sql`select commission_id from commissions where commission_id in ${sql(commissionIds)} and status = 'Paid' and reference_number like ${`${run.payroll_id}%`}` : [];
    const cash = await sql`select transaction_id, amount from cash_transactions where (reference_type = 'Payroll' and reference_id = ${run.payroll_id})${run.cash_transaction_id ? sql` or transaction_id = ${run.cash_transaction_id}` : sql``}`;
    plan.push({ run, paidCommissions: paidCommissions.map((row) => row.commission_id), cash });
    console.log(`${run.payroll_id} · ${run.period_from} to ${run.period_to} · ${run.status || "?"} · ${run.employee_count ?? run.lines} employee(s) · net ${peso(run.net_total)} · ${run.lines} line(s), ${run.adjustments} adjustment(s)`);
    if (cash.length) console.log(`   cash-out to delete: ${cash.map((row) => `${row.transaction_id} (${peso(row.amount)})`).join(", ")}`);
    if (paidCommissions.length) console.log(`   commissions back to Pending: ${paidCommissions.map((row) => row.commission_id).join(", ")}`);
  }
  if (!runs.length) console.log("Nothing to clear.");
  else if (!apply) console.log(`\nDry run: nothing was written. Add --apply to clear ${runs.length === 1 ? "it" : `these ${runs.length}`}.`);
  else {
    const done = await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (clear payroll runs)"}, true)`;
      let cash = 0, commissions = 0, lines = 0, adjustments = 0;
      for (const { run, paidCommissions, cash: cashRows } of plan) {
        if (cashRows.length) cash += (await tx`delete from cash_transactions where transaction_id in ${tx(cashRows.map((row) => row.transaction_id))}`).count;
        if (paidCommissions.length) commissions += (await tx`update commissions set status = 'Pending', paid_at = null, reference_number = null where commission_id in ${tx(paidCommissions)}`).count;
        adjustments += (await tx`delete from payroll_adjustments where payroll_id = ${run.payroll_id}`).count;
        lines += (await tx`delete from payroll_lines where payroll_id = ${run.payroll_id}`).count;
        await tx`delete from payroll_runs where payroll_id = ${run.payroll_id}`;
      }
      return { cash, commissions, lines, adjustments };
    });
    console.log(`\nCleared ${runs.length} payroll run(s): ${done.lines} line(s), ${done.adjustments} adjustment(s), ${done.cash} cash transaction(s) deleted, ${done.commissions} commission(s) back to Pending.`);
  }
} finally {
  await sql.end();
}
