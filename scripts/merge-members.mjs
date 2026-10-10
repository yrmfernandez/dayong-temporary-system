/**
 * Merges one person registered as two members (Exceptions → "Same name and birthdate"; owner, October 10, 2026), from
 * config/member-merges.json: { "merges": [ { "keep": "PH-…", "other": "PH-…", "useOtherName": false, "note": "…" } ] }.
 * The other member's accounts, collections, transfer records, beneficiaries and New Sales move to the kept member (and
 * its PH number); the kept member's blank details (contact, address, birthplace, gender, civil status, claimant) are
 * filled from the other's; with useOtherName the kept member takes the other's name (e.g. the full middle name);
 * then the other member is deleted. Refused when both have an account in the same program (merge those accounts
 * first). Dry run: every change is made and rolled back. One transaction; the Audit Log keeps every change and Record
 * Corrections a summary. Prints member numbers and names (the owner chose the pairs).
 *
 *   node scripts/merge-members.mjs                       dry run on staging
 *   npm run prod -- node scripts/merge-members.mjs       dry run on production
 *   ... --apply
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { merges = [] } = JSON.parse(fs.readFileSync("config/member-merges.json", "utf8"));
const text = (value) => String(value ?? "").trim();
const name = (m) => [m.first_name, m.middle_name, m.surname, m.name_extension].map(text).filter(Boolean).join(" ");
const FILL = ["member_contact", "address", "birthplace", "gender", "civil_status", "claimant_name", "claimant_contact", "claimant_address"];
class Rollback extends Error {}

try {
  console.log(`Supabase project: ${project} · ${merges.length} merge(s)${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Member merge', true)`;
    for (const merge of merges) {
      const find = async (key) => (await tx`select * from members where member_number = ${text(key)} or member_id = ${text(key)}`)[0];
      const [keep, other] = [await find(merge.keep), await find(merge.other)];
      if (!other) { console.log(`${merge.other} → ${merge.keep}: already done (${merge.other} is gone).\n`); continue; }
      if (!keep) { console.log(`${merge.other} → ${merge.keep}: kept member not found; skipped.\n`); continue; }
      if (text(keep.birthdate) !== text(other.birthdate)) { console.log(`${other.member_number} → ${keep.member_number}: birthdates differ (${keep.birthdate} / ${other.birthdate}); skipped.\n`); continue; }
      const clash = await tx`select coalesce(p.program_code, p.program_name) as program from member_programs a join member_programs b on b.program_id = a.program_id join programs p on p.program_id = a.program_id
        where a.member_id = ${keep.member_id} and b.member_id = ${other.member_id}`;
      if (clash.length) { console.log(`${other.member_number} → ${keep.member_number}: both have ${clash.map((row) => row.program).join(", ")}; merge those accounts first. Skipped.\n`); continue; }
      const moved = {
        accounts: (await tx`update member_programs set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning enrollment_id`).map((row) => row.enrollment_id),
        collections: (await tx`update collections set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning collection_id`).length,
        transfers: (await tx`update member_transfers set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning transfer_id`).length,
        beneficiaries: (await tx`update beneficiaries set member_id = ${keep.member_id} where member_id = ${other.member_id} returning member_id`).length,
        sales: (await tx`update sales set member_number = ${keep.member_number} where member_number = ${other.member_number} returning sale_id`).length,
      };
      const filled = FILL.filter((column) => !text(keep[column]) && text(other[column]));
      for (const column of filled) await tx`update members set ${tx({ [column]: other[column] })} where member_id = ${keep.member_id}`;
      if (merge.useOtherName) await tx`update members set first_name = ${other.first_name}, middle_name = ${other.middle_name}, surname = ${other.surname}, name_extension = ${other.name_extension} where member_id = ${keep.member_id}`;
      await tx`delete from members where member_id = ${other.member_id}`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-MMG-${other.member_id}-${Date.now().toString(36).toUpperCase()}`, module: "Member merge", record_id: other.member_id,
        reason: text(merge.note) || "Same person registered twice", before_json: { member: other.member_id, memberNumber: other.member_number, name: name(other), keptName: name(keep) },
        after_json: { member: keep.member_id, memberNumber: keep.member_number, name: merge.useOtherName ? name(other) : name(keep), filled, ...moved }, corrected_at: new Date().toISOString(),
        encoded_by_name: "Member merge", encoded_at: new Date().toISOString() })}`;
      console.log(`${other.member_number} ${name(other)} → ${keep.member_number} ${name(keep)}${merge.useOtherName ? ` (renamed ${name(other)})` : ""}`);
      console.log(`   moved: ${moved.accounts.length} account(s), ${moved.collections} collection(s), ${moved.sales} New Sale(s), ${moved.transfers} transfer(s), ${moved.beneficiaries} beneficiar(ies)${filled.length ? ` · filled: ${filled.join(", ")}` : ""}; ${other.member_number} deleted.\n`);
    }
    if (!apply) throw new Rollback();
  });
  console.log("Applied.");
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log("Dry run: everything above was rolled back. Add --apply to merge.");
} finally {
  await sql.end();
}
