/**
 * Read-only check of a database after `npm run db:migrate`: which Supabase project it is, how many tables exist, and
 * how many migrations are applied. Uses DIRECT_DATABASE_URL from the shell (cutover) or from .env.local (staging).
 *
 *   node scripts/check-database.mjs
 */
import nextEnv from "@next/env";
import fs from "node:fs";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const expected = fs.readdirSync(new URL("../db/migrations", import.meta.url)).filter((file) => file.endsWith(".sql")).length;
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [tables] = await sql`select count(*)::int as n from pg_tables where schemaname = 'public'`;
  const [migrations] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
  console.log(`Supabase project: ${project}`);
  // Tables in the public schema: 45, clearings (0016, October 8, 2026) and company_targets (0017, October 10, 2026).
  const expectedTables = 47;
  // The latest additions, checked by name: Company Targets (0017), non-commissionable periods (0018) and the
  // employee's reply to a Notice to Explain (0019).
  const [{ targets }] = await sql`select to_regclass('public.company_targets') is not null as targets`;
  const [{ flag }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'program_incentives' and column_name = 'non_commissionable') as flag`;
  const [{ reply }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'notices_to_explain' and column_name = 'explanation') as reply`;
  console.log(`Tables: ${tables.n} (expected ${expectedTables})`);
  console.log(`Migrations applied: ${migrations.n} of ${expected}`);
  console.log(`company_targets table (0017): ${targets ? "present" : "MISSING"} · program_incentives.non_commissionable (0018): ${flag ? "present" : "MISSING"} · notices_to_explain.explanation (0019): ${reply ? "present" : "MISSING"}`);
  console.log(tables.n === expectedTables && migrations.n === expected && targets && flag && reply ? "OK: every migration is applied." : "NOT READY: run npm run db:migrate again, then this check.");
} catch (error) {
  console.log(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
