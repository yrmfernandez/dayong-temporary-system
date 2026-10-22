/** Read-only: recorded expense accounts that are not on the new account list (owner, October 22, 2026), with counts and totals.
 * node scripts/prod.mjs node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/_tmp-expense-accounts.mts
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { inTransaction } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { EXPENSE_ACCOUNTS } from "@/lib/expense-options";

nextEnv.loadEnvConfig(process.cwd());
const rows = <T,>(result: unknown): T[] => Array.isArray(result) ? result : (result as { rows: T[] }).rows;

runAsSystem(() => inTransaction(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  const found = rows<{ account: string; status: string; count: number; total: number; first: string; last: string }>(await tx.execute(sql`
    select coalesce(nullif(trim(category), ''), '(blank)') as account, coalesce(nullif(trim(status), ''), 'Posted') as status, count(*)::int as count,
      coalesce(sum(amount), 0)::float8 as total, min(expense_date)::text as first, max(expense_date)::text as last
    from expenses group by 1, 2 order by 1, 2`));
  const listed = new Set<string>(EXPENSE_ACCOUNTS);
  const off = found.filter((row) => !listed.has(row.account) && !row.account.startsWith("Others: "));
  console.log(`Expense accounts in use: ${new Set(found.map((row) => row.account)).size}; not on the new list: ${new Set(off.map((row) => row.account)).size}\n`);
  for (const row of off) console.log(`${row.account} | ${row.status} | ${row.count} expense(s) | ${row.total.toFixed(2)} | ${row.first} to ${row.last}`);
})).then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
