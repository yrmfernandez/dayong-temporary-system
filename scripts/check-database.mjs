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
  const expectedTables = 49; // + turnover_variances (0032, October 29, 2026)
  // The latest additions, checked by name: Company Targets (0017), non-commissionable periods (0018) and the
  // employee's reply to a Notice to Explain (0019), what a clearing covers (0020), why a Date Remitted was changed (0022), the clerk's typed Cash Beg (0023), the DOI time (0024).
  const [{ targets }] = await sql`select to_regclass('public.company_targets') is not null as targets`;
  const [{ flag }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'program_incentives' and column_name = 'non_commissionable') as flag`;
  const [{ reply }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'notices_to_explain' and column_name = 'explanation') as reply`;
  const [{ covers }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'clearings' and column_name = 'covers') as covers`;
  const [{ reviewed }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'notices_to_explain' and column_name = 'reviewed_at') as reviewed`;
  const [{ cashBeg }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'report_notes' and column_name = 'cash_beg') as "cashBeg"`;
  const [{ doiTime }] = await sql`select count(*) = 2 as "doiTime" from information_schema.columns where table_name in ('sales', 'member_programs') and column_name = 'doi_time'`;
  const [{ moved }] = await sql`select count(*) = 2 as moved from information_schema.columns where table_name in ('sales', 'collections') and column_name = 'date_remitted_reason'`;
  const [{ noIncentive }] = await sql`select count(*) = 2 as "noIncentive" from information_schema.columns where table_name in ('sales', 'collections') and column_name = 'no_incentive_reason'`;
  const [{ decided }] = await sql`select count(*) = 2 as decided from information_schema.columns where table_name in ('sales', 'collections') and column_name = 'incentive_decision'`;
  const [{ deductions }] = await sql`select count(*) = 2 as deductions from information_schema.columns where table_name = 'payroll_adjustments' and column_name in ('program_id', 'collection_id')`;
  const [{ held }] = await sql`select count(*) = 1 as held from information_schema.columns where table_name = 'member_programs' and column_name = 'forfeit_held'`;
  const [{ fullyPaid }] = await sql`select count(*) = 2 as "fullyPaid" from information_schema.columns where (table_name = 'member_programs' and column_name = 'certificate_number') or (table_name = 'branches' and column_name = 'certificate_prefix')`;
  const [{ clerkEdit }] = await sql`select count(*) = 4 as "clerkEdit" from information_schema.columns where table_name in ('daily_audits', 'weekly_audits', 'monthly_audits', 'yearly_audits') and column_name = 'clerk_edit_allowed_at'`;
  const [{ located }] = await sql`select to_regclass('public.clock_in_checks') is not null and exists (select 1 from information_schema.columns where table_name = 'branches' and column_name = 'location_radius_m') as located`;
  const [{ variances }] = await sql`select to_regclass('public.turnover_variances') is not null as variances`;
  const [{ settled }] = await sql`select count(*) = 3 as settled from information_schema.columns where table_name = 'turnover_variances' and column_name in ('settlement', 'settled_cash', 'settled_on')`;
  const [{ handovers }] = await sql`select count(*) = 2 as handovers from information_schema.columns where table_name in ('sales', 'collections') and column_name = 'clearing_id'`;
  console.log(`Tables: ${tables.n} (expected ${expectedTables})`);
  console.log(`Migrations applied: ${migrations.n} of ${expected}`);
  console.log(`company_targets table (0017): ${targets ? "present" : "MISSING"} · program_incentives.non_commissionable (0018): ${flag ? "present" : "MISSING"} · notices_to_explain.explanation (0019): ${reply ? "present" : "MISSING"} · clearings.covers (0020): ${covers ? "present" : "MISSING"} · notices_to_explain.reviewed_at (0021): ${reviewed ? "present" : "MISSING"} · date_remitted_reason (0022): ${moved ? "present" : "MISSING"} · report_notes.cash_beg (0023): ${cashBeg ? "present" : "MISSING"} · doi_time (0024): ${doiTime ? "present" : "MISSING"} · no_incentive_reason (0025): ${noIncentive ? "present" : "MISSING"} · incentive_decision (0026): ${decided ? "present" : "MISSING"} · clock_in_checks and branch location (0027): ${located ? "present" : "MISSING"} · payroll program deductions (0028): ${deductions ? "present" : "MISSING"} · member_programs.forfeit_held (0029): ${held ? "present" : "MISSING"} · Fully Paid and certificates (0030): ${fullyPaid ? "present" : "MISSING"} · audit clerk edit allowance (0031): ${clerkEdit ? "present" : "MISSING"} · turnover_variances (0032): ${variances ? "present" : "MISSING"} · turnover settlement (0033): ${settled ? "present" : "MISSING"} · entry clearing_id (0034): ${handovers ? "present" : "MISSING"}`);
  console.log(tables.n === expectedTables && migrations.n === expected && targets && flag && reply && covers && reviewed && moved && cashBeg && doiTime && noIncentive && decided && located && deductions && held && fullyPaid && clerkEdit && variances && settled && handovers ? "OK: every migration is applied." : "NOT READY: run npm run db:migrate again, then this check.");
} catch (error) {
  console.log(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
