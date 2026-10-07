/**
 * Fixes duplicated receipt and form numbers (Exceptions → Possible duplicates), the owner's rule of October 7, 2026:
 *
 * - Collections sharing an OR number, New Sales sharing an application number.
 * - The same entry twice (same enrollment, amount, months and NOP; OR date equal or blank on one copy): keep the most
 *   complete copy, fill its blank fields from the others, and remove the others. A copy already on a remittance is
 *   never removed; it is marked instead.
 * - Different entries that share the number: the first one keeps it; every later copy gets " (duplicated)" after its
 *   number, so it shows as a warning wherever the number appears, and the first copy still blocks the number for new
 *   entries. New Sales are only ever marked, never removed (their member, enrollment and beneficiaries hang on them).
 *
 * Read-only unless --apply. Prints only counts. With --apply, every change is saved first to
 * backups/fix-duplicates-<time>.json (record IDs and old numbers, for undoing), and all changes run in one transaction.
 *
 *   node scripts/fix-duplicates.mjs                    # staging (.env.local), dry run
 *   node scripts/fix-duplicates.mjs --apply
 *   npm run prod -- node scripts/fix-duplicates.mjs    # production, dry run; add --apply after checking
 */
import nextEnv from "@next/env";
import fs from "node:fs";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const APPLY = process.argv.includes("--apply");
const MARK = " (duplicated)";
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

const text = (value) => (value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value).trim());
const same = (a, b, key) => text(a[key]) === text(b[key]);
/** " (duplicated)" on the second copy, " (duplicated 2)" on the third, … so the marked copies never match each other. */
const markFor = (index) => (index === 0 ? MARK : ` (duplicated ${index + 1})`);
/** Filled fields, so the most complete copy can be kept. */
const completeness = (row, skip) => Object.entries(row).filter(([key, value]) => !skip.has(key) && text(value) !== "").length;

/** Groups of rows sharing a key, earliest first. Rows already marked are left out: they were handled before. */
function groupsOf(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) { const key = keyOf(row); if (key) (groups.get(key) ?? groups.set(key, []).get(key)).push(row); }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** The same entry twice: equal core fields, and the date equal or blank on one side. */
const isSameEntry = (group, core, dateKey) => group.slice(1).every((row) => core.every((key) => same(group[0], row, key)) && (same(group[0], row, dateKey) || !text(group[0][dateKey]) || !text(row[dateKey])));

const plan = { project, collections: { groups: 0, sameEntry: 0, removed: 0, merged: 0, marked: 0, keptOnRemittance: 0 }, sales: { groups: 0, marked: 0 }, changes: [] };

// ---------------------------------------------------------------- collections
const collectionRows = await sql`
  select c.*, (select count(*)::int from remittance_collections rc where rc.collection_id = c.collection_id) as remittance_links
  from collections c where c.status = 'Posted' and c.or_key <> '' and c.or_number not ilike '%(duplicated)%'
    and c.or_key in (select or_key from collections where status = 'Posted' and or_key <> '' and or_number not ilike '%(duplicated)%' group by or_key having count(*) > 1)
  order by c.or_key, c.row_seq`;
const COLLECTION_CORE = ["enrollment_id", "amount_collected", "month_from", "month_to", "nop_from", "nop_to"];
const NOT_COMPARED = new Set(["row_seq", "collection_id", "collection_batch_id", "created_at", "encoded_at", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "or_key", "legacy_duplicate", "remittance_links", "branch_id", "mas_employee_id"]);
// Columns the merge may fill on the kept copy (never IDs, links or generated columns).
const FILLABLE = ["or_date", "member_number", "branch", "mas", "suspended", "original_mas", "remittance_breakdown", "remittance_amount", "accountable_employee_id", "accountable_name", "accountable_role", "remittance_method", "payment_reference", "backdate_reason", "date_remitted"];

for (const group of groupsOf(collectionRows, (row) => row.or_key)) {
  plan.collections.groups++;
  const onRemittance = (row) => Boolean(row.linked_remittance_id) || row.remittance_links > 0;
  if (isSameEntry(group, COLLECTION_CORE, "or_date")) {
    plan.collections.sameEntry++;
    // Keep a copy that is on a remittance if there is one, otherwise the most complete; ties go to the earliest.
    const keep = [...group].sort((a, b) => Number(onRemittance(b)) - Number(onRemittance(a)) || completeness(b, NOT_COMPARED) - completeness(a, NOT_COMPARED) || a.row_seq - b.row_seq)[0];
    const fill = {};
    for (const row of group) if (row !== keep) for (const key of FILLABLE) if (!text(keep[key]) && !(key in fill) && text(row[key])) fill[key] = row[key];
    if (Object.keys(fill).length) { plan.collections.merged++; plan.changes.push({ table: "collections", id: keep.collection_id, action: "fill", fields: Object.keys(fill), values: fill }); }
    for (const row of group) {
      if (row === keep) continue;
      if (onRemittance(row)) { plan.collections.keptOnRemittance++; plan.collections.marked++; plan.changes.push({ table: "collections", id: row.collection_id, action: "mark", oldNumber: row.or_number, mark: MARK }); }
      else { plan.collections.removed++; plan.changes.push({ table: "collections", id: row.collection_id, action: "remove", row }); }
    }
  } else {
    group.slice(1).forEach((row, index) => { plan.collections.marked++; plan.changes.push({ table: "collections", id: row.collection_id, action: "mark", oldNumber: row.or_number, mark: markFor(index) }); });
  }
}

// ---------------------------------------------------------------- New Sales (marked only)
const saleRows = await sql`
  select sale_id, application_no, application_key, row_seq from sales
  where application_key <> '' and application_no not ilike '%(duplicated)%'
    and application_key in (select application_key from sales where application_key <> '' and application_no not ilike '%(duplicated)%' group by application_key having count(*) > 1)
  order by application_key, row_seq`;
for (const group of groupsOf(saleRows, (row) => row.application_key)) {
  plan.sales.groups++;
  group.slice(1).forEach((row, index) => { plan.sales.marked++; plan.changes.push({ table: "sales", id: row.sale_id, action: "mark", oldNumber: row.application_no, mark: markFor(index) }); });
}

// Copies marked by an earlier run that still match each other (three or more copies all marked " (duplicated)").
plan.renumbered = 0;
for (const [table, idColumn, numberColumn, keyColumn] of [["collections", "collection_id", "or_number", "or_key"], ["sales", "sale_id", "application_no", "application_key"]]) {
  const rows = await sql`select ${sql(idColumn)} as id, ${sql(numberColumn)} as number, ${sql(keyColumn)} as key from ${sql(table)}
    where ${sql(numberColumn)} ilike '%(duplicated%' and ${sql(keyColumn)} in (select ${sql(keyColumn)} from ${sql(table)} where ${sql(numberColumn)} ilike '%(duplicated%' group by 1 having count(*) > 1) order by ${sql(keyColumn)}, row_seq`;
  for (const group of groupsOf(rows, (row) => row.key)) group.slice(1).forEach((row, index) => {
    plan.renumbered++;
    plan.changes.push({ table, id: row.id, action: "renumber", oldNumber: row.number, newNumber: text(row.number).replace(/\s*\(duplicated[^)]*\)\s*$/i, "") + markFor(index + 1) });
  });
}

// Rows marked by earlier runs, so a run that finds nothing new still shows what was done before.
const [already] = await sql`select (select count(*)::int from collections where or_number ilike '%(duplicated%') as collections, (select count(*)::int from sales where application_no ilike '%(duplicated%') as sales,
  (select count(*)::int from (select or_key from collections where status = 'Posted' and or_key <> '' group by or_key having count(*) > 1) x) as or_groups,
  (select count(*)::int from collections where legacy_duplicate) as flagged_collections`;
const [members] = await sql`select count(*)::int as groups from (select 1 from members where trim(coalesce(surname, '')) <> '' and birthdate is not null group by lower(trim(surname)), lower(trim(first_name)), birthdate having count(*) > 1) x`;

console.log(`Database: ${project}${APPLY ? "" : " (dry run: nothing is changed)"}`);
console.log(`Collections sharing an OR number: ${plan.collections.groups} groups`);
console.log(`  same entry twice: ${plan.collections.sameEntry} groups → ${plan.collections.removed} copies removed, ${plan.collections.merged} kept copies completed from them${plan.collections.keptOnRemittance ? `, ${plan.collections.keptOnRemittance} on a remittance marked instead` : ""}`);
console.log(`  different entries: later copies marked "${MARK.trim()}": ${plan.collections.marked - plan.collections.keptOnRemittance}`);
console.log(`New Sales sharing an application number: ${plan.sales.groups} groups → ${plan.sales.marked} later copies marked "${MARK.trim()}"`);
if (plan.renumbered) console.log(`Marked copies that still matched each other, numbered "(duplicated 2)", "(duplicated 3)": ${plan.renumbered}`);
console.log(`Already marked by earlier runs: ${already.collections} collections, ${already.sales} New Sales. OR numbers still shared by posted collections: ${already.or_groups}. Rows flagged as old-data duplicates at the move: ${already.flagged_collections}.`);
console.log(`Members with the same name and birthdate: ${members.groups} (not changed; review them in Exceptions → Possible duplicates)`);
if (!plan.changes.length) { console.log("Nothing to fix."); await sql.end(); process.exit(0); }
if (!APPLY) { console.log("\nRun again with --apply to make these changes."); await sql.end(); process.exit(0); }

// ---------------------------------------------------------------- apply
fs.mkdirSync("backups", { recursive: true });
const backup = `backups/fix-duplicates-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(backup, JSON.stringify({ project, at: new Date().toISOString(), changes: plan.changes }, null, 2));
await sql.begin(async (tx) => {
  // Named in the Audit Log as the script.
  await tx`select set_config('app.user_name', 'fix-duplicates script', true)`;
  for (const change of plan.changes) {
    if (change.action === "mark" && change.table === "collections") await tx`update collections set or_number = ${text(change.oldNumber) + change.mark} where collection_id = ${change.id}`;
    else if (change.action === "mark") await tx`update sales set application_no = ${text(change.oldNumber) + change.mark} where sale_id = ${change.id}`;
    else if (change.action === "renumber" && change.table === "collections") await tx`update collections set or_number = ${change.newNumber} where collection_id = ${change.id}`;
    else if (change.action === "renumber") await tx`update sales set application_no = ${change.newNumber} where sale_id = ${change.id}`;
    else if (change.action === "fill") await tx`update collections set ${tx(change.values, ...change.fields)} where collection_id = ${change.id}`;
    else if (change.action === "remove") await tx`delete from collections where collection_id = ${change.id}`;
  }
});
console.log(`\nApplied ${plan.changes.length} changes. Backup for undoing: ${backup}`);
await sql.end();
