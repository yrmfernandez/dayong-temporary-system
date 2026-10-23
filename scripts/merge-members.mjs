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
 *   "useOtherName": "fuller" on a pair: the other's name only when its middle name is longer or it has the ñ (in capitals)
 *   --file=config/member-merges-20261023.json   another pair list (scripts/find-duplicate-members-20261023.mjs); a blank birthdate on one side is filled from the other
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
// --file=<json>: another pair list, e.g. config/member-merges-20261023.json (scripts/find-duplicate-members-20261023.mjs).
const file = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) || "config/member-merges.json";
const { merges = [] } = JSON.parse(fs.readFileSync(file, "utf8"));
const text = (value) => String(value ?? "").trim();
const name = (m) => [m.first_name, m.middle_name, m.surname, m.name_extension].map(text).filter(Boolean).join(" ");
// A blank birthdate is filled from the other member (October 23, 2026); two different birthdates are never merged.
const FILL = ["birthdate", "member_contact", "address", "birthplace", "gender", "civil_status", "claimant_name", "claimant_contact", "claimant_address"];
const fold = (value) => text(value).toLowerCase().replace(/ñ/g, "n").replace(/[.,]/g, " ").replace(/s+/g, " ").trim();
/**
 * useOtherName "fuller" (owner, October 23, 2026): take the other member's name when its middle name is longer (a full
 * middle name instead of an initial or blank), or when it is the same name written with ñ; names are put in capitals.
 */
const otherIsFuller = (keep, other) => fold(other.middle_name).length > fold(keep.middle_name).length
  || (fold(name(other)) === fold(name(keep)) && /ñ/i.test(name(other)) && !/ñ/i.test(name(keep)));
class Rollback extends Error {}

try {
  console.log(`Supabase project: ${project} · ${file} · ${merges.length} merge(s)${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Member merge', true)`;
    for (const merge of merges) {
      const find = async (key) => (await tx`select * from members where member_number = ${text(key)} or member_id = ${text(key)}`)[0];
      const [keep, other] = [await find(merge.keep), await find(merge.other)];
      if (!other) { console.log(`${merge.other} → ${merge.keep}: already done (${merge.other} is gone).\n`); continue; }
      if (!keep) { console.log(`${merge.other} → ${merge.keep}: kept member not found; skipped.\n`); continue; }
      if (text(keep.birthdate) && text(other.birthdate) && text(keep.birthdate) !== text(other.birthdate)) { console.log(`${other.member_number} → ${keep.member_number}: birthdates differ (${keep.birthdate} / ${other.birthdate}); skipped.\n`); continue; }
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
      const renamed = merge.useOtherName === "fuller" ? otherIsFuller(keep, other) : Boolean(merge.useOtherName);
      const upper = (value) => merge.useOtherName === "fuller" && value ? text(value).toUpperCase() : value;
      if (renamed) await tx`update members set first_name = ${upper(other.first_name)}, middle_name = ${upper(other.middle_name)}, surname = ${upper(other.surname)}, name_extension = ${upper(other.name_extension)} where member_id = ${keep.member_id}`;
      await tx`delete from members where member_id = ${other.member_id}`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-MMG-${other.member_id}-${Date.now().toString(36).toUpperCase()}`, module: "Member merge", record_id: other.member_id,
        reason: text(merge.note) || "Same person registered twice", before_json: { member: other.member_id, memberNumber: other.member_number, name: name(other), keptName: name(keep) },
        after_json: { member: keep.member_id, memberNumber: keep.member_number, name: renamed ? name(other) : name(keep), filled, ...moved }, corrected_at: new Date().toISOString(),
        encoded_by_name: "Member merge", encoded_at: new Date().toISOString() })}`;
      console.log(`${other.member_number} ${name(other)} → ${keep.member_number} ${name(keep)}${renamed ? ` (renamed ${name(other).toUpperCase()})` : ""}`);
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
