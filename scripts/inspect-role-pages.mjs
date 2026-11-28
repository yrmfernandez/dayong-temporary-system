/**
 * Read-only: each role's saved page access (Roles → Page access) and whether My Notices is ticked. No member data.
 *
 *   npm run prod -- node scripts/inspect-role-pages.mjs
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const roles = await sql`select role_name, status, page_access from roles order by role_name`;
  for (const role of roles) {
    const pages = role.page_access ? String(role.page_access) : "";
    console.log(`- ${role.role_name} (${role.status}): ${pages ? `configured, My Notices ${pages.includes("/my-notices") ? "ticked" : "NOT ticked"}` : "not configured (defaults)"}`);
  }
} finally { await sql.end(); }
