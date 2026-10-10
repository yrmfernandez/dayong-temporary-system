/**
 * OR numbers without a branch letter (Exceptions → "OR numbers without a branch letter"; owner, October 10, 2026).
 * A receipt number carries its branch's letter ("17671 N", "13584 C"). For each posted collection whose OR number is
 * digits only, this adds the letter its branch's other receipts use:
 *   - the letter of the receipt's booklet: the same MAS/Collector's lettered receipts with nearby numbers (within 100),
 *     else the branch's, when they all carry one letter; with no nearby receipt, the branch's letter when at least 90%
 *     of its lettered receipts (10 or more) carry it; anything unclear is left for staff;
 *   - a bare receipt whose lettered number already exists for the same member, date and amount is listed as a likely
 *     duplicate (not changed);
 *   - written the way that branch mostly writes it ("12345 C" or "12345C");
 *   - skipped when the new number is already used by another posted receipt (it would be a duplicate).
 * Dry run by default: prints, per branch, the letter, how sure it is and how many receipts change, and writes every
 * change to legacy-data/or-letter-fixes.csv (collection, branch, OR date, old and new OR number). --apply makes the
 * changes in one transaction; the Audit Log keeps each old number and Record Corrections a summary. No member data.
 *
 *   node scripts/add-or-branch-letters.mjs                       dry run on staging
 *   npm run prod -- node scripts/add-or-branch-letters.mjs       dry run on production
 *   ... --apply
 *   ... --most-common                                            the rest get the letter mostly used there (owner, October 10)
 *   ... --min-share=0.8                                          accept a branch letter used by 80% (default 0.9)
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const mostCommon = process.argv.includes("--most-common");
const minShare = Number(process.argv.find((arg) => arg.startsWith("--min-share="))?.slice(12) ?? 0.9);
const MIN_LETTERED = 10;
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const text = (value) => String(value ?? "").trim();
const cell = (value) => { const v = String(value ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

try {
  const branchKey = (value) => text(value).toLowerCase();
  // Letters each branch's posted receipts carry, and whether written with a space.
  const lettered = await sql`select branch, upper(substring(trim(or_number) from '([A-Za-z])$')) as letter, (trim(or_number) ~ '\\s[A-Za-z]$') as spaced, count(*)::int as n
    from collections where lower(coalesce(status, '')) = 'posted' and trim(or_number) ~ '^[0-9]+\\s*[A-Za-z]$' group by 1, 2, 3`;
  const branches = new Map();
  for (const row of lettered) {
    const key = branchKey(row.branch);
    const entry = branches.get(key) ?? branches.set(key, { name: text(row.branch), letters: new Map(), spaced: 0, total: 0 }).get(key);
    entry.letters.set(row.letter, (entry.letters.get(row.letter) ?? 0) + row.n);
    if (row.spaced) entry.spaced += row.n;
    entry.total += row.n;
  }
  const person = sql`lower(trim(coalesce(nullif(trim(accountable_name), ''), mas, '')))`;
  const bare = await sql`select collection_id, branch, ${person} as person, or_number, or_date::text as or_date, member_id, amount_collected::float8 as amount from collections
    where lower(coalesce(status, '')) = 'posted' and trim(or_number) ~ '^[0-9]+$' order by branch, or_number`;
  // Lettered receipts by branch, number order: a booklet is a run of consecutive numbers with one letter.
  const near = await sql`select branch, ${person} as person, (substring(trim(or_number) from '^([0-9]+)'))::bigint as num, upper(substring(trim(or_number) from '([A-Za-z])$')) as letter
    from collections where lower(coalesce(status, '')) = 'posted' and trim(or_number) ~ '^[0-9]+\s*[A-Za-z]$' and length(substring(trim(or_number) from '^([0-9]+)')) < 15`;
  const byBranch = new Map();
  const byPerson = new Map();
  for (const row of near) {
    const key = branchKey(row.branch); (byBranch.get(key) ?? byBranch.set(key, []).get(key)).push({ num: Number(row.num), letter: row.letter });
    if (row.person) (byPerson.get(row.person) ?? byPerson.set(row.person, []).get(row.person)).push({ num: Number(row.num), letter: row.letter });
  }
  const existing = new Map((await sql`select or_key, member_id, or_date::text as or_date, amount_collected::float8 as amount, collection_id from collections where lower(coalesce(status, '')) = 'posted' and coalesce(or_key, '') <> ''`).map((row) => [row.or_key, row]));
  const taken = new Set(existing.keys());
  const changes = [], duplicates = [], skipped = new Map();
  const left = [];
  const skip = (row, why) => { const key = `${row.branch || "(no branch)"}: ${why}`; skipped.set(key, (skipped.get(key) ?? 0) + 1); left.push({ ...row, why }); };
  // Branches where the branch-letter guess clashed with an existing receipt: the guess is not trusted there.
  const clashes = new Set();
  const RANGE = 100;
  for (const row of bare) {
    const digits = text(row.or_number), num = Number(digits), info = branches.get(branchKey(row.branch));
    // 1. The booklet: booklets are issued to a MAS or Collector, so first that person's lettered receipts within RANGE
    //    numbers, all one letter; then the branch's.
    const mine = row.person ? (byPerson.get(row.person) ?? []).filter((item) => Math.abs(item.num - num) <= RANGE) : [];
    const mineLetters = new Set(mine.map((item) => item.letter));
    const neighbours = (byBranch.get(branchKey(row.branch)) ?? []).filter((item) => Math.abs(item.num - num) <= RANGE);
    const neighbourLetters = new Set(neighbours.map((item) => item.letter));
    let letter = "", how = "";
    if (mine.length >= 1 && mineLetters.size === 1) { letter = mine[0].letter; how = "person"; }
    else if (mine.length >= 2) { skip(row, `the MAS/Collector's nearby receipts carry different letters (${[...mineLetters].join("/")})`); continue; }
    else if (neighbours.length >= 2 && neighbourLetters.size === 1) { letter = neighbours[0].letter; how = "booklet"; }
    else if (neighbours.length >= 2) { skip(row, `nearby receipts carry different letters (${[...neighbourLetters].join("/")})`); continue; }
    else if (info && info.total >= MIN_LETTERED) {
      // 2. No nearby receipt: the branch's one clear letter.
      const [top, count] = [...info.letters].sort((a, b) => b[1] - a[1])[0];
      if (count / info.total >= minShare) { letter = top; how = "branch"; }
      else { skip(row, "no nearby receipts and the branch uses several letters"); continue; }
    } else { skip(row, "no nearby receipts and too few lettered receipts in the branch"); continue; }
    const spaced = info ? info.spaced * 2 >= info.total : true;
    const next = spaced ? `${digits} ${letter}` : `${digits}${letter}`;
    const key = `${digits}${letter}`;
    const other = existing.get(key);
    if (other) {
      // 3. The lettered number exists: the same payment recorded twice, or two different receipts.
      const same = other.member_id === row.member_id && other.or_date === row.or_date && Math.round(other.amount * 100) === Math.round(row.amount * 100);
      if (same) duplicates.push({ ...row, next, otherId: other.collection_id });
      else { if (how === "branch") clashes.add(branchKey(row.branch)); skip(row, "the lettered number is another member's or another payment's receipt"); }
      continue;
    }
    if (taken.has(key)) { skip(row, "two bare receipts would get the same lettered number"); continue; }
    taken.add(key);
    changes.push({ ...row, next, letter, how });
  }
  // A branch letter that clashed with existing receipts in that branch is not trusted for its other receipts either.
  for (const change of changes.filter((c) => c.how === "branch" && clashes.has(branchKey(c.branch)))) skip(change, "the branch's usual letter clashes with existing receipts in this branch: check the paper receipt");
  const kept = changes.filter((c) => !(c.how === "branch" && clashes.has(branchKey(c.branch))));
  changes.length = 0; changes.push(...kept);
  // --most-common (owner, October 10, 2026: "just use the letter mostly used"): every receipt still left gets the letter
  // most used by the same MAS/Collector's nearby receipts, else the branch's nearby receipts, else the branch overall,
  // passing over a letter whose number is already another receipt's. Likely duplicates are never changed.
  if (mostCommon) {
    const ranked = (items) => [...items.reduce((counts, item) => counts.set(item.letter, (counts.get(item.letter) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([letter]) => letter);
    const still = [];
    for (const row of left.splice(0)) {
      const digits = text(row.or_number), num = Number(digits), info = branches.get(branchKey(row.branch));
      const mine = row.person ? (byPerson.get(row.person) ?? []).filter((item) => Math.abs(item.num - num) <= RANGE) : [];
      const neighbours = (byBranch.get(branchKey(row.branch)) ?? []).filter((item) => Math.abs(item.num - num) <= RANGE);
      // Branch-wide, only letters the branch really uses (10% or more of its receipts): a letter it almost never uses
      // would be a guess (e.g. HINATUAN is 98% "S"; when the "S" number is taken, M or B would be wrong).
      const overall = info ? [...info.letters].filter(([, count]) => count / info.total >= 0.1).sort((a, b) => b[1] - a[1]).map(([letter]) => letter) : [];
      const order = [...new Set([...ranked(mine), ...ranked(neighbours), ...overall])];
      const letter = order.find((candidate) => !taken.has(`${digits}${candidate}`));
      if (!letter) { still.push({ ...row, why: order.length ? "every letter used here is already taken by another receipt with this number" : "no lettered receipt in this branch to go by" }); continue; }
      const spaced = info ? info.spaced * 2 >= info.total : true;
      taken.add(`${digits}${letter}`);
      changes.push({ ...row, next: spaced ? `${digits} ${letter}` : `${digits}${letter}`, letter, how: "common" });
    }
    left.push(...still);
    skipped.clear();
    for (const row of still) { const key = `${row.branch || "(no branch)"}: ${row.why}`; skipped.set(key, (skipped.get(key) ?? 0) + 1); }
  }
  const perBranch = new Map();
  for (const change of changes) {
    const stats = perBranch.get(change.branch || "(no branch)") ?? perBranch.set(change.branch || "(no branch)", { person: 0, booklet: 0, branch: 0, common: 0, letters: new Set() }).get(change.branch || "(no branch)");
    stats[change.how]++; stats.letters.add(change.letter);
  }

  console.log(`Supabase project: ${project} · ${bare.length} posted OR number(s) without a letter${apply ? "" : " · dry run"}\n`);
  console.log("Letters added, by branch:");
  for (const [name, s] of [...perBranch].sort((a, b) => (b[1].person + b[1].booklet + b[1].branch + b[1].common) - (a[1].person + a[1].booklet + a[1].branch + a[1].common))) console.log(`  ${name}: ${s.person + s.booklet + s.branch + s.common} receipt(s), letter ${[...s.letters].join("/")} (${s.person} from the same MAS/Collector's booklet, ${s.booklet} from the branch's nearby numbers, ${s.branch} by the branch's letter${mostCommon ? `, ${s.common} by the letter mostly used` : ""})`);
  if (duplicates.length) console.log(`\nLikely recorded twice (the lettered receipt already exists for the same member, date and amount): ${duplicates.length}. Not changed; listed in the file for staff to delete the copy.`);
  if (skipped.size) { console.log("\nLeft as they are:"); for (const [why, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${why}`); }
  fs.mkdirSync("legacy-data", { recursive: true });
  fs.writeFileSync("legacy-data/or-letter-fixes.csv", `﻿${[["collection", "branch", "OR date", "OR number", "becomes", "how", "note"],
    ...changes.map((c) => [c.collection_id, c.branch, c.or_date, c.or_number, c.next, c.how === "person" ? "the same MAS/Collector's nearby receipts" : c.how === "booklet" ? "nearby receipts of the branch" : c.how === "common" ? "the letter mostly used (owner's rule)" : "the branch's letter", ""]),
    ...duplicates.map((d) => [d.collection_id, d.branch, d.or_date, d.or_number, "", "", `likely the same payment as ${d.otherId} (${d.next})`]),
    ...left.map((l) => [l.collection_id, l.branch, l.or_date, l.or_number, "", "left for staff", l.why])].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`);
  console.log(`\n${changes.length} receipt(s) ${apply ? "changed" : "would change"}; every one, the likely duplicates and the ${left.length} left for staff (with the reason) are in legacy-data/or-letter-fixes.csv.`);

  if (apply && changes.length) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', 'OR branch letters', true)`;
      for (const change of changes) await tx`update collections set or_number = ${change.next} where collection_id = ${change.collection_id} and trim(or_number) = ${text(change.or_number)}`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-ORL-${Date.now().toString(36).toUpperCase()}`, module: "OR branch letters", record_id: "collections",
        reason: "OR numbers without a branch letter got their branch's letter (owner, October 10, 2026)", before_json: { count: changes.length },
        after_json: { byBranch: Object.fromEntries([...perBranch].map(([name, s]) => [name, { letters: [...s.letters], booklet: s.booklet, branch: s.branch }])), likelyDuplicates: duplicates.map((d) => d.collection_id) }, corrected_at: new Date().toISOString(),
        encoded_by_name: "OR branch letters", encoded_at: new Date().toISOString() })}`;
    });
    console.log("Applied.");
  } else if (!apply) console.log("Dry run: nothing was written. Add --apply to make the changes.");
} finally {
  await sql.end();
}
