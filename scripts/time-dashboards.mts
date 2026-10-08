/**
 * How long each dashboard's data takes, read-only: the same calls the home page makes, first (cold, like a fresh
 * Vercel instance) and again (warm), plus the size of the tables they read. Prints timings and counts only.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/time-dashboards.mts                     staging
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/time-dashboards.mts     production
 *
 * Timings from this PC include the trip to Singapore for every query; on Vercel (sin1) each query is faster, so
 * compare the parts with each other rather than the totals with the live site.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown";
const { sql } = await import("drizzle-orm");
const { getDb } = await import("../lib/db");
const { getExecutiveAnalytics } = await import("../lib/executive-analytics");
const { getRemittanceDashboard } = await import("../lib/remittance-workflow");
const { getCommissions, getVendorPayables } = await import("../lib/finance-operations");
const { getEmployees } = await import("../lib/employees");

const time = async (label: string, work: () => Promise<unknown>) => {
  const start = performance.now();
  await work();
  const ms = Math.round(performance.now() - start);
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)} ms`);
  return ms;
};

console.log(`Supabase project: ${project}\n`);
await time("first query (connection)", () => getDb().execute(sql`select 1`));
const parts: Array<[string, () => Promise<unknown>]> = [
  ["Finance: sales analytics (month)", () => getExecutiveAnalytics("mtd", { financeOnly: true })],
  ["Finance: remittance summary", () => getRemittanceDashboard()],
  ["Finance: vendor payables", () => getVendorPayables()],
  ["Finance: commissions", () => getCommissions()],
  ["employees (name on the page)", () => getEmployees()],
  ["Executive: month to date", () => getExecutiveAnalytics("mtd")],
];
for (const round of ["cold", "warm"]) {
  console.log(`\n${round}:`);
  for (const [label, work] of parts) await time(label, work);
}
console.log("\nFinance dashboard as the page loads it (all at once):");
await time("together", () => Promise.all(parts.slice(0, 5).map(([, work]) => work())));

const active = sql`(coalesce(remittance_status, '') <> 'Remitted' or coalesce(encoded_by_employee_id, '') <> '' or linked_remittance_id is not null)`;
const rows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<Record<string, number>>;
const [sizes] = rows(await getDb().execute(sql`select
  (select count(*)::int from collections) as collections, (select count(*)::int from collections where ${active}) as active_collections,
  (select count(*)::int from sales) as sales, (select count(*)::int from sales where ${active}) as active_sales,
  (select count(*)::int from remittances) as remittances, (select count(*)::int from remittance_collections) as remittance_links,
  (select count(*)::int from receipt_photos) as receipt_photos, (select count(*)::int from commissions) as commissions`));
console.log("\nTable sizes:", sizes);
process.exit(0);
