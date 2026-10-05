/**
 * Adds the missing branch letter to Collections OR numbers written as digits only (owner's decision 2026-10-05:
 * certain cases only, written "12345 S"). A letter is certain when
 *   1. every lettered OR within 50 numbers of it, in the same branch, has the same letter (same receipt booklet), or
 *   2. the branch uses one letter for at least 95% of its lettered ORs (e.g. HINATUAN and TAGBINA: S).
 * An OR that would then equal another posted receipt is left as it is. Everything not fixed shows on the Exceptions
 * page ("OR number has no branch letter") for staff to correct one by one. Prints counts only.
 *
 *   node scripts/fix-or-letters.mjs          dry run
 *   node scripts/fix-or-letters.mjs --apply  write (edits are recorded by the database audit log)
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const key = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

try {
  const rows = await sql`select collection_id, branch, trim(or_number) as or_number, status, legacy_duplicate from collections where coalesce(trim(or_number), '') <> ''`;
  const lettered = new Map(), bare = [];
  for (const row of rows) {
    const match = /^(\d+)\s*([A-Za-z]+)?$/.exec(row.or_number);
    if (!match) continue;
    if (match[2]) { const list = lettered.get(row.branch) ?? []; list.push([Number(match[1]), match[2].toUpperCase()]); lettered.set(row.branch, list); }
    else bare.push({ ...row, digits: match[1], number: Number(match[1]) });
  }
  const dominant = new Map();
  for (const [branch, list] of lettered) {
    const counts = new Map();
    for (const [, letter] of list) counts.set(letter, (counts.get(letter) ?? 0) + 1);
    const [letter, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (count / list.length >= 0.95) dominant.set(branch, letter);
  }
  // Receipts already used by posted collections (each OR is used once).
  const used = new Set(rows.filter((row) => row.status === "Posted" && !row.legacy_duplicate).map((row) => key(row.or_number)));
  const plan = [], skipped = { uncertain: 0, wouldDuplicate: 0 };
  for (const row of bare) {
    const near = new Set((lettered.get(row.branch) ?? []).filter(([n]) => Math.abs(n - row.number) <= 50).map(([, letter]) => letter));
    const letter = near.size === 1 ? [...near][0] : near.size === 0 ? dominant.get(row.branch) : undefined;
    if (!letter) { skipped.uncertain++; continue; }
    const value = `${row.digits} ${letter}`;
    const newKey = key(value);
    if (row.status === "Posted" && !row.legacy_duplicate) {
      if (used.has(newKey)) { skipped.wouldDuplicate++; continue; }
      used.delete(key(row.or_number)); used.add(newKey);
    }
    plan.push({ id: row.collection_id, value, rule: near.size === 1 ? "booklet" : "branch" });
  }
  console.log(`Supabase project: ${project}`);
  console.log(`OR numbers without a letter: ${bare.length}`);
  console.log(`  letter is certain: ${plan.length} (same booklet ${plan.filter((item) => item.rule === "booklet").length}, single-letter branch ${plan.filter((item) => item.rule === "branch").length})`);
  console.log(`  left for review: ${skipped.uncertain} uncertain, ${skipped.wouldDuplicate} would equal another receipt`);
  if (!apply) console.log("Dry run. Nothing was written. Add --apply to add the letters.");
  else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${"Data fix (OR branch letters)"}, true)`;
      for (const item of plan) await tx`update collections set or_number = ${item.value} where collection_id = ${item.id}`;
    });
    console.log(`Added the letter to ${plan.length} OR number(s).`);
  }
} finally {
  await sql.end();
}
