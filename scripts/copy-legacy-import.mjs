/**
 * Copies one legacy import (backups/legacy-migration-ids-*.json) from the staging database to production. Used once,
 * on 2026-10-05, when migrate-legacy-members.mjs --apply ran against staging: the rows were already deleted from the
 * Legacy Pending tabs, so staging holds the only copy. Prints counts only.
 *
 * Source: DIRECT_DATABASE_URL in .env.local (must be staging). Target: DIRECT_DATABASE_URL set in the shell (must be
 * production). Rows the target already has are skipped, so it is safe to rerun. A collection whose OR number the target
 * already has posted is written flagged legacy_duplicate. All or nothing: one transaction.
 *
 *   node scripts/copy-legacy-import.mjs backups/legacy-migration-ids-....json          dry run
 *   node scripts/copy-legacy-import.mjs backups/legacy-migration-ids-....json --apply  write
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PRODUCTION_REF = "qnugejonwpfvsenxvhxz";
const STAGING_REF = "nziflfmwqnaqcisssapy";
const file = process.argv.slice(2).find((arg) => arg.endsWith(".json"));
const apply = process.argv.includes("--apply");
if (!file) throw new Error("Give the legacy-migration-ids-*.json file.");
const ids = JSON.parse(readFileSync(file, "utf8"));

const local = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((line) => /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")]));
// Pooler URLs name the project in the user (postgres.REF), direct URLs in the host (db.REF.supabase.co).
const ref = (url) => /postgres\.([a-z0-9]+)[:@]/.exec(url ?? "")?.[1] ?? /db\.([a-z0-9]+)\.supabase/.exec(url ?? "")?.[1] ?? "unknown";
const sourceUrl = local.DIRECT_DATABASE_URL, targetUrl = process.env.DIRECT_DATABASE_URL;
if (!targetUrl) throw new Error("$env:DIRECT_DATABASE_URL is not set in this window. Set it to the production value first.");
if (ref(sourceUrl) !== STAGING_REF) throw new Error(`.env.local DIRECT_DATABASE_URL must be staging (${STAGING_REF}); it is ${ref(sourceUrl)}.`);
if (ref(targetUrl) !== PRODUCTION_REF) throw new Error(`Set $env:DIRECT_DATABASE_URL to production (${PRODUCTION_REF}); it is ${ref(targetUrl)}.`);

// Parents first, so foreign keys hold.
const tables = [
  { key: "Members", table: "members", id: "member_id" },
  { key: "Member programs", table: "member_programs", id: "enrollment_id" },
  { key: "Sales", table: "sales", id: "sale_id" },
  { key: "Beneficiaries", table: "beneficiaries", id: "beneficiary_id" },
  { key: "Collections", table: "collections", id: "collection_id" },
];
const source = postgres(sourceUrl, { max: 1, onnotice: () => {} });
const target = postgres(targetUrl, { max: 1, onnotice: () => {} });
try {
  const plan = [];
  for (const { key, table, id } of tables) {
    const wanted = ids[key] ?? [];
    if (!wanted.length) continue;
    // Writable columns only: no identity (row_seq) or generated (or_key) columns.
    const columns = (await source`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER' and is_identity = 'NO' order by ordinal_position`).map((row) => row.column_name);
    const rows = await source`select ${source(columns)} from ${source(table)} where ${source(id)} = any(${wanted}) order by row_seq`;
    const present = new Set((await target`select ${target(id)} as id from ${target(table)} where ${target(id)} = any(${wanted})`).map((row) => row.id));
    const missing = rows.filter((row) => !present.has(row[id]));
    if (table === "collections" && missing.length) {
      const keys = new Set((await target`select or_key from collections where or_key <> '' and status = 'Posted' and not legacy_duplicate`).map((row) => row.or_key));
      const orKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let flagged = 0;
      for (const row of missing) if (row.status === "Posted" && !row.legacy_duplicate && keys.has(orKey(row.or_number))) { row.legacy_duplicate = true; flagged++; }
      console.log(`  Collections already posted in production with the same OR number: ${flagged} (written flagged as duplicates)`);
    }
    console.log(`${key}: ${wanted.length} in the file, ${rows.length} found in staging, ${present.size} already in production, ${missing.length} to copy.`);
    plan.push({ table, columns, rows: missing });
  }
  if (!apply) console.log("Dry run. Nothing was written. Add --apply to copy.");
  else {
    await target.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (legacy import copied from staging)"}, true)`;
      for (const { table, columns, rows } of plan) if (rows.length) await tx`insert into ${tx(table)} ${tx(rows, columns)}`;
    });
    console.log(`Copied ${plan.reduce((sum, item) => sum + item.rows.length, 0)} row(s) to production.`);
  }
} finally {
  await source.end();
  await target.end();
}
