/**
 * Merges employees recorded twice under different names (for example a temporary LEG-… MAS from the old workbook,
 * "Capacite, C.", and the real employee with a sign-in). The pairs come from config/employee-merges.json, confirmed by
 * the owner: { "merges": [ { "duplicate": "LEG-2026-0025", "keep": "MD-2026-0035" } ] }.
 *
 *   node scripts/merge-employees.mjs --suggest   list possible pairs (same surname, one letter apart, or same initial)
 *   node scripts/merge-employees.mjs             dry run: what each listed merge would change
 *   node scripts/merge-employees.mjs --apply     merge (one transaction; the database audit log records each edit)
 *   npm run prod -- node scripts/merge-employees.mjs [--apply]   production
 *
 * For each pair, in every table: each column ending in employee_id (MAS links, who encoded, accountable employee, …)
 * moves from the duplicate to the kept employee, and every MAS / employee name column written with the duplicate's
 * name gets the kept employee's name, so all their members, accounts, sales and collections show one employee. The
 * kept employee receives the duplicate's branches; then the duplicate is deleted. A duplicate with its own sign-in
 * (Users) or pay profile is refused while the kept employee also has one: remove one of them first.
 *
 * Records whose MAS name matches no employee (the employee was renamed or re-added before the name reached them) are
 * re-linked by the "relink" list in the same file, confirmed by the owner: { "relink": { "Amora, N.": "MD-2026-0040" } }
 * gives every unlinked record written "Amora, N." that employee's current name, and the database links it.
 *
 * Then, for everyone: a record linked to an employee but still showing an older name (renamed in Employees before
 * October 7, 2026; since migration 0012 a rename reaches every record) gets the employee's current name, and MAS names
 * that match no employee are listed. Prints employee names and counts only.
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply"), suggest = process.argv.includes("--suggest");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
/** Columns holding an employee's name as text (MAS, accountable, payroll and audit names). */
const LINKED_NAMES = [["member_programs", "mas", "mas_employee_id"], ["sales", "mas", "mas_employee_id"], ["collections", "mas", "mas_employee_id"],
  ["collections", "accountable_name", "accountable_employee_id"], ["remittances", "mas", "mas_employee_id"], ["bank_deposits", "mas", "mas_employee_id"], ["member_transfers", "from_mas", "from_employee_id"]];
const NAME_COLUMN = /^(mas|mas_name|from_mas|to_mas|original_mas|accountable_name|employee_name)$/;

try {
  console.log(`Database: Supabase project ${project}`);
  const employees = await sql`select e.employee_id, e.full_name, exists (select 1 from users u where u.employee_id = e.employee_id) as login,
    (select count(*) from member_programs mp where mp.mas_employee_id = e.employee_id)::int as accounts from employees e order by e.employee_id`;
  const label = (e) => `${e.full_name} [${e.employee_id}${e.login ? ", sign-in" : ""}, ${e.accounts} accounts]`;

  if (suggest) {
    const parts = (name) => {
      const text = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ,]/g, " ");
      if (text.includes(",")) { const [surname, given] = text.split(","); return { surname: surname.trim().split(/\s+/).at(-1), given: given.trim().split(/\s+/)[0] ?? "" }; }
      const list = text.trim().split(/\s+/); return { surname: list.at(-1), given: list[0] };
    };
    const distance = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const people = employees.map((e) => ({ e, ...parts(e.full_name) }));
    let found = 0;
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      if (!a.surname || !b.surname) continue;
      const d = distance(a.surname, b.surname);
      if (d === 0 || (d === 1 && a.given[0] === b.given[0])) { found++; console.log(`  ${label(a.e)}  ~  ${label(b.e)}`); }
    }
    console.log(`${found} possible pair(s). Same surname is not proof: confirm each with the owner before adding it to config/employee-merges.json.`);
    // MAS names on accounts that match no employee, with the employees of the same surname.
    const orphans = await sql`select mas, count(*)::int as n from member_programs where mas_employee_id is null and coalesce(trim(mas), '') <> '' group by mas order by 2 desc`;
    console.log(`\nAccount MAS names that match no employee (${orphans.length}), with employees of the same surname:`);
    for (const o of orphans) {
      const name = parts(o.mas);
      const same = people.filter((p) => p.surname === name.surname || distance(p.surname ?? "", name.surname ?? "") === 1);
      console.log(`  ${o.mas} (${o.n} accounts) → ${same.map((p) => label(p.e)).join("  |  ") || "no employee with that surname"}`);
    }
    console.log(`Confirmed matches go under "relink" in config/employee-merges.json: { "<name on the accounts>": "<Employee ID>" }.`);
    process.exit(0);
  }

  const config = fs.existsSync("config/employee-merges.json") ? JSON.parse(fs.readFileSync("config/employee-merges.json", "utf8")) : {};
  const merges = config.merges ?? [], relinks = Object.entries(config.relink ?? {});
  const byId = new Map(employees.map((e) => [e.employee_id, e]));
  const columns = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name not in ('employees', 'audit_log')
    and (column_name like '%employee\\_id' or column_name ~ ${NAME_COLUMN.source}) order by table_name, column_name`;
  const idColumns = columns.filter((c) => c.column_name.endsWith("employee_id")), nameColumns = columns.filter((c) => NAME_COLUMN.test(c.column_name));
  const plan = [];
  for (const { duplicate, keep } of merges) {
    const dup = byId.get(duplicate), kept = byId.get(keep);
    if (!dup || !kept) { console.log(`  skipped ${duplicate} → ${keep}: ${!dup ? duplicate : keep} is not an employee (already merged?)`); continue; }
    const [{ logins, profiles }] = await sql`select (select count(*) from users where employee_id in (${duplicate}, ${keep}))::int as logins,
      (select count(*) from pay_profiles where employee_id in (${duplicate}, ${keep}))::int as profiles`;
    if (logins > 1 || profiles > 1) { console.log(`  refused ${label(dup)} → ${label(kept)}: both have a ${logins > 1 ? "sign-in" : "pay profile"}`); continue; }
    plan.push({ dup, kept });
  }

  const run = async (tx) => {
    for (const { dup, kept } of plan) {
      const changed = new Map();
      const note = (table, n) => { if (n) changed.set(table, (changed.get(table) ?? 0) + n); };
      // Branches: the duplicate's assignments move unless the kept employee already has that branch.
      await tx`delete from employee_branches d where d.employee_id = ${dup.employee_id} and exists (select 1 from employee_branches k where k.employee_id = ${kept.employee_id} and k.branch_id = d.branch_id)`;
      for (const { table_name: table, column_name: column } of idColumns) note(table, (await tx`update ${tx(table)} set ${tx(column)} = ${kept.employee_id} where ${tx(column)} = ${dup.employee_id} returning 1`).length);
      for (const { table_name: table, column_name: column } of nameColumns) note(table, (await tx`update ${tx(table)} set ${tx(column)} = ${kept.full_name} where lower(trim(${tx(column)})) = lower(trim(${dup.full_name})) returning 1`).length);
      await tx`delete from employees where employee_id = ${dup.employee_id}`;
      console.log(`  ${label(dup)} → ${label(kept)}: ${[...changed].map(([t, n]) => `${t} ${n}`).join(", ") || "no linked rows"}`);
    }
    // Unlinked records written with a name no employee has: the confirmed employee's current name (the database links it).
    for (const [written, employeeId] of relinks) {
      const [employee] = await tx`select employee_id, full_name from employees where employee_id = ${employeeId}`;
      if (!employee) { console.log(`  relink ${written} → ${employeeId}: no such employee, skipped`); continue; }
      const changed = [];
      for (const [table, name, link] of LINKED_NAMES) {
        const rows = await tx`update ${tx(table)} set ${tx(name)} = ${employee.full_name} where ${tx(link)} is null and lower(trim(${tx(name)})) = lower(trim(${written})) returning 1`;
        if (rows.length) changed.push(`${table}.${name} ${rows.length}`);
      }
      const extra = await tx`update collections set original_mas = ${employee.full_name} where lower(trim(original_mas)) = lower(trim(${written})) returning 1`;
      if (extra.length) changed.push(`collections.original_mas ${extra.length}`);
      console.log(`  relink ${written} → ${label({ ...employee, login: false, accounts: 0 }).replace(", 0 accounts", "")}: ${changed.join(", ") || "nothing to change"}`);
    }
    // Linked records showing an older name of their employee (the columns migration 0012's cascade_employee_rename keeps current).
    const synced = [];
    for (const [table, name, link] of LINKED_NAMES) {
      const rows = await tx`update ${tx(table)} t set ${tx(name)} = e.full_name from employees e where e.employee_id = t.${tx(link)}
        and t.${tx(name)} is distinct from e.full_name and coalesce(trim(t.${tx(name)}), '') <> '' returning 1`;
      if (rows.length) synced.push(`${table}.${name} ${rows.length}`);
    }
    console.log(`Records showing an older employee name, corrected: ${synced.join(", ") || "none"}`);
    const orphans = await tx`select mas, count(*)::int as n from member_programs where mas_employee_id is null and coalesce(trim(mas), '') <> '' group by mas order by 2 desc`;
    console.log(`Accounts whose MAS name matches no employee: ${orphans.map((o) => `${o.mas} (${o.n})`).join("; ") || "none"}`);
  };
  if (!apply) {
    // Dry run: the same statements in a transaction that is rolled back, so the counts are exact.
    await sql.begin(async (tx) => { await run(tx); throw new Error("dry run"); }).catch((error) => { if (error.message !== "dry run") throw error; });
    console.log(`\nDry run: ${plan.length} merge(s), ${relinks.length} relink(s) and the name corrections shown, nothing was written. Add --apply to merge.`);
  } else {
    await sql.begin(async (tx) => { await tx`select set_config('app.user_name', 'Employee merge', true)`; await run(tx); });
    console.log(`\nMerged ${plan.length} employee(s).`);
  }
} finally {
  await sql.end();
}
