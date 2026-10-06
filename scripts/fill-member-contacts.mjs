/**
 * Members without a contact number get their claimant's contact number (owner's decision 2026-10-06), in Members and
 * on their New Sale records. Only a claimant contact with at least 7 digits is used (not "N/A" or "0"). Safe to rerun:
 * only blank member contacts are filled. Prints counts only.
 *
 *   node scripts/fill-member-contacts.mjs          dry run
 *   node scripts/fill-member-contacts.mjs --apply  write (edits are recorded by the database audit log)
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? /db\.([a-z0-9]+)\.supabase/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const blank = (column) => sql`coalesce(trim(${sql(column)}), '') = ''`;
const usable = sql`length(regexp_replace(coalesce(claimant_contact, ''), '[^0-9]', '', 'g')) >= 7`;
try {
  const count = async (table) => (await sql`select count(*) filter (where ${usable})::int as fill, count(*) filter (where not ${usable})::int as none from ${sql(table)} where ${blank("member_contact")}`)[0];
  const members = await count("members"), sales = await count("sales");
  console.log(`Supabase project: ${project}`);
  console.log(`Members without a contact number: ${members.fill + members.none} (claimant contact usable: ${members.fill}, none on record: ${members.none})`);
  console.log(`New Sale records without a member contact: ${sales.fill + sales.none} (claimant contact usable: ${sales.fill}, none on record: ${sales.none})`);
  if (!apply) console.log("Dry run. Nothing was written. Add --apply to fill them.");
  else {
    const [m, s] = await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (member contact from claimant)"}, true)`;
      const m = await tx`update members set member_contact = trim(claimant_contact) where ${blank("member_contact")} and ${usable}`;
      const s = await tx`update sales set member_contact = trim(claimant_contact) where ${blank("member_contact")} and ${usable}`;
      return [m.count, s.count];
    });
    console.log(`Filled ${m} member(s) and ${s} New Sale record(s).`);
  }
} finally {
  await sql.end();
}
