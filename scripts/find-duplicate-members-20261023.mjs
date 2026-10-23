/**
 * Members registered twice (owner, October 23, 2026: New Sales registered an existing person again because the clerk
 * did not pick the existing member; the New Sales pop-up now prevents new ones). Read-only.
 *
 * Two members are taken to be one person when, ignoring case, extra spaces and ñ/n:
 *   - the surname, first name and name extension are the same,
 *   - the middle names agree (same initial) or one is blank, and
 *   - the birthdates are the same, or one is blank ("likely": the blank is filled from the other when merged).
 * Different birthdates mean different people: not listed. A name with Jr., Sr., II, III or IV is never listed (father and son).
 *
 * In each group the member to keep is the one with more accounts and payments, then the older record (registered
 * first). A pair where both members have an account in the same program cannot merge yet (those accounts would have
 * to be merged first): listed as "account clash", not put in the merge list.
 *
 * Writes
 *   legacy-data/duplicate-members-review-20261023.csv   names, PH numbers, birthdates, programs, counts (git ignores legacy-data/)
 *   config/member-merges-20261023.json                   the pairs to merge, PH numbers only, for
 *                                                        scripts/merge-members.mjs --file=config/member-merges-20261023.json
 * Prints counts only.
 *
 *   node scripts/find-duplicate-members-20261023.mjs                staging
 *   node scripts/prod.mjs node scripts/find-duplicate-members-20261023.mjs   production
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const text = (value) => String(value ?? "").trim();
const fold = (value) => text(value).toLowerCase().replace(/ñ/g, "n").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const day = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : text(value).slice(0, 10);
const csv = (value) => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);

try {
  const members = await sql`select m.row_seq, m.member_id, m.member_number, m.surname, m.first_name, coalesce(m.middle_name, '') as middle_name, coalesce(m.name_extension, '') as name_extension, m.birthdate,
      coalesce((select array_agg(coalesce(p.program_code, p.program_name, mp.program_id) || ' ' || coalesce(mp.branch, '') order by mp.program_id) from member_programs mp left join programs p on p.program_id = mp.program_id where mp.member_id = m.member_id), '{}') as accounts,
      coalesce((select array_agg(mp.program_id) from member_programs mp where mp.member_id = m.member_id), '{}') as program_ids,
      (select count(*)::int from collections c where c.member_id = m.member_id) as payments,
      (select count(*)::int from sales s where s.member_number = m.member_number) as sales
    from members m`;
  const groups = new Map();
  // Jr., Sr., II, III, IV anywhere in the name: never paired (owner, October 23, 2026: father and son share a name).
  const SUFFIX = /(jr|sr|ii|iii|iv)/;
  for (const member of members) {
    if (SUFFIX.test(fold([member.surname, member.first_name, member.middle_name, member.name_extension].join(" ")))) continue;
    const key = [fold(member.surname), fold(member.first_name), fold(member.name_extension)].join("|");
    if (!fold(member.surname) || !fold(member.first_name)) continue;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const weight = (member) => member.program_ids.length * 1000 + member.payments + member.sales;
  const pairs = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => weight(b) - weight(a) || Number(a.row_seq) - Number(b.row_seq));
    const keep = ordered[0];
    for (const other of ordered.slice(1)) {
      const [a, b] = [fold(keep.middle_name), fold(other.middle_name)];
      if (a && b && a[0] !== b[0]) continue;
      const [x, y] = [day(keep.birthdate), day(other.birthdate)];
      if (x && y && x !== y) continue;
      const clash = keep.program_ids.filter((id) => other.program_ids.includes(id));
      pairs.push({ keep, other, kind: clash.length ? "account clash" : x && y ? "same birthdate" : "one birthdate blank", clash });
    }
  }
  const header = ["#", "KIND", "KEEP PH", "KEEP NAME", "KEEP BIRTHDATE", "KEEP ACCOUNTS", "KEEP PAYMENTS", "OTHER PH", "OTHER NAME", "OTHER BIRTHDATE", "OTHER ACCOUNTS", "OTHER PAYMENTS", "SAME PROGRAM"];
  const name = (m) => [m.surname, [m.first_name, m.middle_name, m.name_extension].map(text).filter(Boolean).join(" ")].join(", ");
  const lines = pairs.map((pair, index) => [index + 1, pair.kind, pair.keep.member_number, name(pair.keep), day(pair.keep.birthdate), pair.keep.accounts.join("; "), pair.keep.payments,
    pair.other.member_number, name(pair.other), day(pair.other.birthdate), pair.other.accounts.join("; "), pair.other.payments, pair.clash.join("; ")]);
  fs.mkdirSync("legacy-data", { recursive: true });
  fs.writeFileSync("legacy-data/duplicate-members-review-20261023.csv", [header, ...lines].map((row) => row.map(csv).join(",")).join("\n"));
  const mergeable = pairs.map((pair, index) => ({ ...pair, number: index + 1 })).filter((pair) => pair.kind !== "account clash");
  fs.writeFileSync("config/member-merges-20261023.json", `${JSON.stringify({
    note: "Members registered twice, found by scripts/find-duplicate-members-20261023.mjs (same surname, first name and extension; middle initial and birthdate agree or one is blank). keep / other: PH numbers; # matches legacy-data/duplicate-members-review-20261023.csv. Merged by scripts/merge-members.mjs --file=config/member-merges-20261023.json.",
    merges: mergeable.map((pair) => ({ keep: pair.keep.member_number, other: pair.other.member_number, note: `#${pair.number} ${pair.kind}` })),
  }, null, 2)}\n`);
  const count = (kind) => pairs.filter((pair) => pair.kind === kind).length;
  console.log(`Supabase project: ${project} · ${members.length} members · ${pairs.length} duplicate pair(s): ${count("same birthdate")} same birthdate, ${count("one birthdate blank")} one birthdate blank, ${count("account clash")} account clash (both have the same program; not in the merge list).`);
  console.log("Review: legacy-data/duplicate-members-review-20261023.csv · merge list: config/member-merges-20261023.json");
} finally {
  await sql.end();
}
