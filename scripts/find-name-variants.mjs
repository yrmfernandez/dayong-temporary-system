/**
 * Members who may be one person split by a spelling difference (October 8, 2026: "Potenciando" / "Potenciado"): two
 * members with an account in the same program and branch whose first names and surnames differ by at most 2 letters
 * in all (and whose middle initials agree when both are written). Read-only.
 *
 *   node scripts/find-name-variants.mjs                       staging
 *   npm run prod -- node scripts/find-name-variants.mjs       production
 *
 * Writes legacy-data/name-variants-review.csv (git ignores legacy-data/: it holds names) with both members' names,
 * PH numbers, program, branch, whether each has a New Sale, and their collection counts, plus an empty MERGE column:
 * put YES on the pairs that are the same person. Prints counts only.
 * Pairs already decided in config/name-merges.json (merges and notSamePerson) are left out.
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const distance = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const cell = (value) => { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

try {
  const rows = await sql`select m.member_id, m.member_number, upper(trim(coalesce(m.first_name, ''))) as first, upper(trim(coalesce(m.middle_name, ''))) as middle,
      upper(trim(coalesce(m.surname, ''))) as surname, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname, m.name_extension)) as full_name, m.birthdate::text as birthdate,
      mp.enrollment_id, mp.program_id, coalesce(p.program_name, mp.program_id) as program, upper(trim(coalesce(mp.branch, ''))) as branch,
      (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id) as collections,
      exists (select 1 from sales s where s.member_number = m.member_number and s.program_id = mp.program_id) as has_sale
    from members m join member_programs mp on mp.member_id = m.member_id left join programs p on p.program_id = mp.program_id`;
  const groups = new Map();
  for (const row of rows) { const key = `${row.program_id}|${row.branch}`; (groups.get(key) ?? groups.set(key, []).get(key)).push(row); }
  // Pairs the owner already decided (config/name-merges.json: merges, and notSamePerson since October 9, 2026) are skipped.
  const decided = fs.existsSync("config/name-merges.json") ? JSON.parse(fs.readFileSync("config/name-merges.json", "utf8")) : {};
  const known = new Set([...(decided.merges ?? []), ...(decided.notSamePerson ?? [])].flatMap((pair) => [`${pair.keep}|${pair.other}`, `${pair.other}|${pair.keep}`]));
  let skipped = 0;
  const pairs = [];
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.member_id === b.member_id) continue;
    if (known.has(`${a.enrollment_id}|${b.enrollment_id}`)) { skipped++; continue; }
    const total = distance(a.surname, b.surname) + distance(a.first, b.first);
    if (total === 0 || total > 2) continue;
    if (a.middle && b.middle && a.middle[0] !== b.middle[0]) continue;
    // The account with the New Sale (else more collections) is listed first: it is the one kept when merged.
    const [keep, other] = (a.has_sale !== b.has_sale ? a.has_sale : a.collections >= b.collections) ? [a, b] : [b, a];
    pairs.push({ keep, other, kind: keep.has_sale && other.has_sale ? "both have a New Sale" : keep.has_sale ? "one New Sale" : "no New Sale" });
  }
  const header = ["MERGE (YES = same person)", "kind", "program", "branch", "keep: name", "keep: PH number", "keep: birthdate", "keep: New Sale", "keep: collections", "keep: enrollment",
    "other: name", "other: PH number", "other: birthdate", "other: New Sale", "other: collections", "other: enrollment"];
  const lines = pairs.map(({ keep, other, kind }) => ["", kind, keep.program, keep.branch, keep.full_name, keep.member_number, keep.birthdate ?? "", keep.has_sale ? "yes" : "no", keep.collections, keep.enrollment_id,
    other.full_name, other.member_number, other.birthdate ?? "", other.has_sale ? "yes" : "no", other.collections, other.enrollment_id]);
  fs.mkdirSync("legacy-data", { recursive: true });
  fs.writeFileSync("legacy-data/name-variants-review.csv", `﻿${[header, ...lines].map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`);
  const count = (kind) => pairs.filter((pair) => pair.kind === kind).length;
  console.log(`Supabase project: ${project}\n${rows.length} accounts checked; ${pairs.length} pairs that may be one person: ${count("no New Sale")} with no New Sale, ${count("one New Sale")} with one, ${count("both have a New Sale")} with both; ${skipped} already decided (config/name-merges.json) left out.`);
  console.log("Review file: legacy-data/name-variants-review.csv (put YES in the MERGE column for the same person).");
} finally {
  await sql.end();
}
