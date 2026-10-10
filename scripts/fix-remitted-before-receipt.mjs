/**
 * Exceptions → "Dates out of order": a Date Remitted before the receipt or application date is impossible (cash cannot be
 * turned over before the receipt is issued). Owner, October 10, 2026: use the application date. For every New Sale whose
 * Date Remitted is before its OR (application) date, and every posted collection whose Date Remitted is before its OR
 * date, the Date Remitted becomes that date. Entries already on a remittance slip are left (the slip has its own date).
 * A receipt or application date after today is itself the typo: listed, not changed. Dry run by default; --apply writes, in one transaction (Audit Log keeps the old dates; Record Corrections a summary).
 * Prints record IDs and dates only.
 *
 *   node scripts/fix-remitted-before-receipt.mjs                     dry run on staging
 *   npm run prod -- node scripts/fix-remitted-before-receipt.mjs     dry run on production
 *   ... --apply
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const salesAll = await sql`select sale_id as id, or_date::text as receipt, date_remitted::text as remitted from sales
    where or_date is not null and date_remitted is not null and date_remitted < or_date and linked_remittance_id is null order by or_date`;
  const collectionsAll = await sql`select collection_id as id, or_date::text as receipt, date_remitted::text as remitted from collections
    where lower(coalesce(status, '')) = 'posted' and or_date is not null and date_remitted is not null and date_remitted < or_date and linked_remittance_id is null order by or_date`;
  // A receipt or application date in the future is itself the typo: those are listed, not changed.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const future = [...salesAll, ...collectionsAll].filter((row) => row.receipt > today);
  const sales = salesAll.filter((row) => row.receipt <= today), collections = collectionsAll.filter((row) => row.receipt <= today);
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run"}\n`);
  for (const [label, rows] of [["New Sales", sales], ["Collections", collections]]) {
    console.log(`${label}: ${rows.length}`);
    for (const row of rows) console.log(`   ${row.id} · remitted ${row.remitted} → ${row.receipt} (the ${label === "New Sales" ? "application" : "OR"} date)`);
  }
  if (future.length) console.log(`\nLeft (the receipt or application date is in the future, so it is the date that is wrong; correct it in the record): ${future.map((row) => `${row.id} (${row.receipt})`).join(", ")}`);
  if (apply && (sales.length || collections.length)) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', 'Date Remitted fix', true)`;
      if (sales.length) await tx`update sales set date_remitted = or_date where sale_id in ${tx(sales.map((row) => row.id))}`;
      if (collections.length) await tx`update collections set date_remitted = or_date where collection_id in ${tx(collections.map((row) => row.id))}`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-DRF-${Date.now().toString(36).toUpperCase()}`, module: "Date Remitted fix", record_id: "sales/collections",
        reason: "Date Remitted before the receipt or application date: set to that date (owner, October 10, 2026)",
        before_json: { sales: sales.map((row) => [row.id, row.remitted]), collections: collections.map((row) => [row.id, row.remitted]) },
        after_json: { sales: sales.length, collections: collections.length }, corrected_at: new Date().toISOString(), encoded_by_name: "Date Remitted fix", encoded_at: new Date().toISOString() })}`;
    });
    console.log("\nApplied.");
  } else if (!apply) console.log("\nDry run: nothing was written. Add --apply to make the changes.");
} finally {
  await sql.end();
}
