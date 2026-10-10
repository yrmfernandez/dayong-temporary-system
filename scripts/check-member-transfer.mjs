/**
 * Read-only (October 10, 2026). After moving one employee's members to another (Employees → Transfer members), checks
 * that every account really went: what is still under the old employee (by the employee link or by name), what is now
 * under the new one, the transfers recorded between them, and accounts left behind because the new employee is not
 * assigned to that branch (lib/member-transfer.ts skips those). Prints counts by branch and account status; enrollment
 * IDs of anything left go to legacy-data/transfer-left.txt (no member names).
 *
 *   node scripts/check-member-transfer.mjs --from="RACHO K" --to="RACHO KRISTINE"
 *   npm run prod -- node scripts/check-member-transfer.mjs --from="RACHO K" --to="RACHO KRISTINE"
 *
 * --from / --to take an Employee ID or the exact name (case and outer spaces ignored).
 */
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? "";
const fromKey = arg("from"), toKey = arg("to");
if (!fromKey || !toKey) throw new Error('Give both: --from="OLD NAME or ID" --to="NEW NAME or ID".');
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const find = async (key) => sql`select e.employee_id, e.full_name, coalesce(e.employment_status, '?') as status,
      (select string_agg(b.branch_name_code, ', ' order by b.branch_name_code) from employee_branches eb join branches b on b.branch_id = eb.branch_id where eb.employee_id = e.employee_id) as branches
    from employees e where e.employee_id = ${key} or lower(trim(e.full_name)) = lower(trim(${key}))`;
  const [fromList, toList] = await Promise.all([find(fromKey), find(toKey)]);
  // Everyone with a similar name, so a near-duplicate employee record is noticed.
  const word = fromKey.split(/\s+/)[0];
  const similar = await sql`select employee_id, full_name, coalesce(employment_status, '?') as status from employees where full_name ilike ${`%${word}%`} order by full_name`;
  console.log(`Supabase project: ${project}\n`);
  console.log(`Employees with "${word}" in the name:`);
  for (const e of similar) console.log(`  ${e.employee_id} · ${e.full_name} · ${e.status}`);
  if (fromList.length !== 1 || toList.length !== 1) {
    console.log(`\n${fromList.length !== 1 ? `"${fromKey}" matches ${fromList.length} employees. ` : ""}${toList.length !== 1 ? `"${toKey}" matches ${toList.length} employees. ` : ""}Use the Employee ID from the list above.`);
    process.exitCode = 1;
  } else {
    const [from] = fromList, [to] = toList;
    console.log(`\nFrom: ${from.employee_id} ${from.full_name} (${from.status}) · branches: ${from.branches || "none"}`);
    console.log(`To:   ${to.employee_id} ${to.full_name} (${to.status}) · branches: ${to.branches || "none"}`);

    // Still the old employee's: linked to them, or (link empty) carrying their name. Also a name that no longer matches
    // its link, which would mean the link was not refreshed.
    const left = await sql`select enrollment_id, coalesce(nullif(trim(branch), ''), '(no branch)') as branch, coalesce(nullif(account_status, ''), status, '(none)') as state,
        mas_employee_id = ${from.employee_id} as by_link, lower(trim(mas)) = lower(trim(${from.full_name})) as by_name
      from member_programs where mas_employee_id = ${from.employee_id} or lower(trim(mas)) = lower(trim(${from.full_name}))`;
    const moved = await sql`select coalesce(nullif(trim(branch), ''), '(no branch)') as branch, count(*)::int as n,
        count(*) filter (where mas_employee_id is distinct from ${to.employee_id})::int as unlinked
      from member_programs where mas_employee_id = ${to.employee_id} or lower(trim(mas)) = lower(trim(${to.full_name})) group by 1 order by 1`;
    const transfers = await sql`select count(*)::int as n, min(encoded_at)::text as first, max(encoded_at)::text as last, count(distinct enrollment_id)::int as accounts
      from member_transfers where lower(trim(from_mas)) = lower(trim(${from.full_name})) and (to_employee_id = ${to.employee_id} or lower(trim(to_mas)) = lower(trim(${to.full_name})))`;
    // Transferred accounts no longer under the new employee (moved again or changed since).
    const movedAway = await sql`select count(distinct t.enrollment_id)::int as n from member_transfers t join member_programs mp on mp.enrollment_id = t.enrollment_id
      where lower(trim(t.from_mas)) = lower(trim(${from.full_name})) and (t.to_employee_id = ${to.employee_id} or lower(trim(t.to_mas)) = lower(trim(${to.full_name})))
        and mp.mas_employee_id is distinct from ${to.employee_id} and lower(trim(mp.mas)) <> lower(trim(${to.full_name}))`;
    const toBranches = new Set(String(to.branches ?? "").split(", ").map((b) => b.toLowerCase()).filter(Boolean));

    const t = transfers[0];
    console.log(`\nTransfers recorded ${from.full_name} → ${to.full_name}: ${t.n} (${t.accounts} accounts)${t.n ? ` · ${t.first?.slice(0, 16)} to ${t.last?.slice(0, 16)}` : ""}`);
    if (movedAway[0].n) console.log(`  ${movedAway[0].n} of them are no longer under ${to.full_name} (moved again or changed since).`);
    console.log(`\nNow under ${to.full_name}: ${moved.reduce((sum, row) => sum + row.n, 0)} account(s)`);
    for (const row of moved) console.log(`  ${row.branch}: ${row.n}${row.unlinked ? ` (${row.unlinked} with the name but not the employee link)` : ""}`);

    console.log(`\nStill under ${from.full_name}: ${left.length} account(s)`);
    if (left.length) {
      const byBranch = new Map();
      for (const row of left) {
        const key = row.branch;
        const entry = byBranch.get(key) ?? { n: 0, states: new Map(), mismatch: 0 };
        entry.n++; entry.states.set(row.state, (entry.states.get(row.state) ?? 0) + 1);
        if (row.by_link !== row.by_name) entry.mismatch++;
        byBranch.set(key, entry);
      }
      for (const [branch, entry] of byBranch) {
        const why = toBranches.has(branch.toLowerCase()) ? "" : ` · ${to.full_name} is NOT assigned to this branch, so the transfer skips these: add the branch in Employees, then transfer again`;
        console.log(`  ${branch}: ${entry.n} (${[...entry.states].map(([s, n]) => `${s} ${n}`).join(", ")})${entry.mismatch ? ` · ${entry.mismatch} where the name and the employee link disagree` : ""}${why}`);
      }
      fs.mkdirSync("legacy-data", { recursive: true });
      fs.writeFileSync("legacy-data/transfer-left.txt", `${left.map((row) => `${row.enrollment_id}\t${row.branch}\t${row.state}`).join("\n")}\n`);
      console.log(`  Enrollment IDs: legacy-data/transfer-left.txt`);
    }
    console.log(left.length ? `\nNOT COMPLETE: ${left.length} account(s) are still ${from.full_name}'s.` : `\nCOMPLETE: no account is left under ${from.full_name}.`);
  }
} finally {
  await sql.end();
}
