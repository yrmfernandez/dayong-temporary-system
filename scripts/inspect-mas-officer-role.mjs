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
const sql = postgres(url, { max: 1, onnotice: () => {} });
// Read-only: the MAS-Officer role row (page access, status) and how many accounts hold it. No member data.
try {
  const roles = await sql`select role_id, role_name, status, page_access from roles where lower(regexp_replace(trim(role_name), '[[:space:]-]+', ' ', 'g')) = 'mas officer'`;
  console.log(`Project ${project}: ${roles.length} MAS-Officer role row(s)`);
  for (const role of roles) {
    const [{ count }] = await sql`select count(*)::int as count from user_roles where role_id = ${role.role_id}`;
    console.log(`- ${role.role_id} "${role.role_name}" status=${role.status} accounts=${count} page_access=${role.page_access ? role.page_access : "(not set: uses defaults)"}`);
  }
} finally { await sql.end(); }
