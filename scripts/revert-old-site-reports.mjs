/**
 * Undoes scripts/complete-old-site-reports.mjs for October 2026 (owner, October 31, 2026: "let's just revert what we
 * did to week 1, let's not continue adding it to this month"). The old web app and old sheet records stay as company
 * records but leave the Entry Clerks' reports:
 *   - New Sales and Collections the completion gave a clerk get back their encoder and encoded date from before
 *     (audit_log, user "Old records report completion"); one changed again in those columns since is listed, not touched.
 *   - The expenses (EXP-WEB-…, EXP-LEG-…) and bank / GCash remittances (DEP-WEB-…) it added are deleted (the audit log
 *     keeps a copy of each deleted row).
 * The incentives recalculated by scripts/reprice-legacy-weeks.mjs are kept (owner). Prints counts and totals only.
 *
 *   node scripts/revert-old-site-reports.mjs                     plan on staging (.env.local): reads only
 *   npm run prod -- node scripts/revert-old-site-reports.mjs [--apply]
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const BY = "Old records report completion", REVERT_BY = "Old records report completion undone";
const COLUMNS = ["encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"];
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const same = (a, b) => (a == null || a === "" ? null : new Date(a).getTime() || String(a)) === (b == null || b === "" ? null : new Date(b).getTime() || String(b));

const sql = postgres(url, { max: 1, onnotice: () => {} });
console.log(`Supabase project ${project}.${apply ? "" : " Plan only: nothing is written."}\n`);
try {
  const tables = { sales: "sale_id", collections: "collection_id" };
  const plan = { sales: [], collections: [] }, changedSince = [];
  for (const [table, key] of Object.entries(tables)) {
    const logged = await sql`select record_id, changes_json from audit_log where table_name = ${table} and user_name = ${BY} and action = 'update' order by logged_at`;
    const ids = logged.map((row) => row.record_id);
    const current = new Map((ids.length ? await sql`select ${sql(key)} as id, ${sql(COLUMNS)} from ${sql(table)} where ${sql(key)} in ${sql(ids)}` : []).map((row) => [row.id, row]));
    for (const { record_id: id, changes_json: changes } of logged) {
      const row = current.get(id);
      if (!row) { changedSince.push(`${table} ${id}: no longer exists`); continue; }
      const before = {}, moved = [];
      for (const column of COLUMNS) {
        if (!changes[column]) continue;
        before[column] = changes[column].from;
        if (!same(row[column], changes[column].to)) moved.push(column);
      }
      if (moved.length) changedSince.push(`${table} ${id}: ${moved.join(", ")} changed since`);
      else plan[table].push({ id, before });
    }
  }
  const [expenses] = await sql`select count(*)::int as n, coalesce(sum(amount), 0)::float8 as amount from expenses where expense_id like 'EXP-WEB-%' or expense_id like 'EXP-LEG-%'`;
  const [deposits] = await sql`select count(*)::int as n, coalesce(sum(amount), 0)::float8 as amount from bank_deposits where deposit_id like 'DEP-WEB-%'`;
  const byClerk = await sql`select encoded_by_name as clerk, count(*)::int as n from (
      select encoded_by_name from sales where sale_id in ${sql(plan.sales.map((item) => item.id).concat("-"))}
      union all select encoded_by_name from collections where collection_id in ${sql(plan.collections.map((item) => item.id).concat("-"))}) x group by 1 order by 1`;

  console.log("Entries leaving each clerk's reports:");
  console.table(byClerk);
  console.log(`New Sales: ${plan.sales.length}; Collections: ${plan.collections.length} get their encoder and encoded date back.`);
  console.log(`Expenses deleted: ${expenses.n} (₱${money(expenses.amount)}); bank / GCash remittances deleted: ${deposits.n} (₱${money(deposits.amount)}).`);
  if (changedSince.length) { console.log(`\nLeft as they are (${changedSince.length}):`); for (const line of changedSince) console.log(`  ${line}`); }

  if (!apply) console.log("\nPlan only. Add --apply to write.");
  else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${REVERT_BY}, true)`;
      for (const [table, key] of Object.entries(tables)) for (const item of plan[table]) await tx`update ${tx(table)} set ${tx(item.before)} where ${tx(key)} = ${item.id}`;
      await tx`delete from expenses where expense_id like 'EXP-WEB-%' or expense_id like 'EXP-LEG-%'`;
      await tx`delete from bank_deposits where deposit_id like 'DEP-WEB-%'`;
      await tx`insert into record_corrections ${tx({
        correction_id: `COR-WEB-REPORTS-UNDO-2026-10-${Date.now().toString(36).toUpperCase()}`, module: REVERT_BY, record_id: "REPORTS-2026-10",
        reason: "Owner, October 31, 2026: revert the old web app and old sheet records added to the Entry Clerks' October 2026 reports; not added to this month. Incentives recalculated on October 30 are kept.",
        before_json: null, after_json: { newSales: plan.sales.length, collections: plan.collections.length, expensesDeleted: expenses.n, depositsDeleted: deposits.n, leftAsTheyAre: changedSince.length },
        corrected_at: new Date().toISOString(), encoded_by_name: REVERT_BY, encoded_at: new Date().toISOString(),
      })}`;
    });
    console.log(`\nApplied: ${plan.sales.length} New Sales and ${plan.collections.length} Collections back as before; ${expenses.n} expenses and ${deposits.n} remittances deleted.`);
  }
} finally {
  await sql.end();
}
