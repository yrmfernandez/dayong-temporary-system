/**
 * Moves expenses recorded under older account names to the company's expense accounts (owner, October 22, 2026; the
 * list is lib/expense-options.ts). Voided expenses move too, so the register reads one way. Only the account name
 * (`category`) changes; amounts, dates, payees and status stay. Afterwards every expense must be on the list (or
 * "Others: <detail>"), otherwise nothing is saved. One transaction; the Audit Log keeps each row's change and Record
 * Corrections a summary.
 *
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/move-expense-accounts-20261022.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { encodedBy, inTransaction, schema } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { EXPENSE_ACCOUNTS } from "@/lib/expense-options";
import { createReadableId } from "@/lib/readable-id";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const rows = <T,>(result: unknown): T[] => Array.isArray(result) ? result : (result as { rows: T[] }).rows;

/** Old account name → new one, as the owner decided. */
const MOVES: Record<string, string> = {
  "Allowance": "Allowances",
  "Other: MOBILITY ALLOWANCE": "Allowances",
  "Cash Burial Assistance": "CBA (Cash Burial Assistance)",
  "Electric Bill": "Monthly Bills",
  "Water Bill": "Monthly Bills",
  "Internet/Load": "Monthly Bills",
  "Monthly Office Rent": "Office Rental",
  "Other: Coolant 1L": "Vehicle Maintenance",
  "Other: Monthly motorcycle payment": "Vehicle Maintenance",
  "Other: GASOLINE": "Gasoline",
  "Other: Travel expense for Ma'am Sheena": "Transportation",
  "Other: orc nagliba": "ORC",
  "Other: 10% Services Incentives": "Services MAS incentives",
  "Other: MAS 10 %": "Services MAS incentives",
  "Meals/Snacks": "Meals",
  "Other: 5KG STARTER UP": "Meals",
  "Other: 5kls Starter up/vitamen pro/bag": "Meals",
  "Other: 5KLS ULTRAPACK": "Meals",
  "Bank Fee/Charge": "Others: Bank Fee/Charge",
  "Other: GCASH REMIT": "Others: GCASH REMIT",
  "Miscellaneous": "Others: Miscellaneous",
};
const listed = new Set<string>(EXPENSE_ACCOUNTS);
const onList = (account: string) => listed.has(account) || account.startsWith("Others: ");
for (const [from, to] of Object.entries(MOVES)) if (!onList(to)) throw new Error(`${from} → ${to}: not an expense account.`);

class PreviewDone extends Error {}

async function main() {
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table expenses in share row exclusive mode`);
    const moved: Array<{ from: string; to: string; ids: string[] }> = [];
    for (const [from, to] of Object.entries(MOVES)) {
      const ids = rows<{ id: string }>(await tx.execute(sql`update expenses set category = ${to} where trim(category) = ${from} returning expense_id as id`)).map((row) => row.id);
      moved.push({ from, to, ids });
      console.log(`${from} → ${to}: ${ids.length} expense(s)`);
    }
    const missing = moved.filter((item) => !item.ids.length).map((item) => item.from);
    if (missing.length) console.log(`\nNo expenses found under: ${missing.join(", ")}`);
    const left = rows<{ account: string; count: number }>(await tx.execute(sql`select coalesce(nullif(trim(category), ''), '(blank)') as account, count(*)::int as count from expenses group by 1 order by 1`))
      .filter((row) => !onList(row.account));
    if (left.length) { console.table(left); throw new Error("Expenses remain on accounts not on the list; nothing was saved."); }
    const total = moved.reduce((sum, item) => sum + item.ids.length, 0);
    console.log(`\nEvery expense is now on the list. ${apply ? "Moved" : "Would move"} ${total} expense(s).`);
    if (!apply) throw new PreviewDone();
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Expense accounts", record_id: "expenses",
      reason: "Owner, October 22, 2026: expenses recorded under older account names moved to the company's expense accounts (posted and voided).",
      before_json: Object.fromEntries(moved.filter((item) => item.ids.length).map((item) => [item.from, item.ids])),
      after_json: Object.fromEntries(moved.filter((item) => item.ids.length).map((item) => [item.from, item.to])),
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
  }));
}
main().then(() => process.exit(0)).catch((error) => {
  if (error instanceof PreviewDone) { console.log("Preview only: rolled back. Add --apply to write."); process.exit(0); }
  console.error(error instanceof Error ? error.message : String(error)); process.exit(1);
});
