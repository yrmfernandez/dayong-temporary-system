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
  console.log(`Tables: ${tables.n} (expected 44)`);
  console.log(`Migrations applied: ${migrations.n} of ${expected}`);
  console.log(tables.n === 44 && migrations.n === expected ? "OK: the database is ready for the copy." : "NOT READY: run npm run db:migrate again, then this check.");
} catch (error) {
  console.log(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
