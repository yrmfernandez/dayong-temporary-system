/**
 * Assigns each MAS to the branches of their active accounts (October 8, 2026). The Collections page lists a member only
 * under the account's branch and MAS, and offers only the MAS assigned to that branch, so an account whose MAS is not
 * assigned to its branch cannot be found there (e.g. Kisha Karen Potenciado: BALIOK account, MAS assigned only to
 * NABUNTURAN). On staging 677 active accounts of 22 MAS were hidden this way, mostly from the imports.
 *
 *   node scripts/assign-mas-branches.mjs                       dry run on staging: lists the assignments to add
 *   node scripts/assign-mas-branches.mjs --apply               add them on staging
 *   npm run prod -- node scripts/assign-mas-branches.mjs [--apply]
 *
 * Only adds Employee Branches rows (the employee's primary branch and the accounts are not changed). One transaction;
 * every row is in the Audit Log. Prints employee and branch names and counts only.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const missing = await sql`select mp.mas_employee_id as employee_id, e.full_name, b.branch_id, b.branch_name_code as branch, count(*)::int as accounts
    from member_programs mp
    join employees e on e.employee_id = mp.mas_employee_id
    join branches b on lower(trim(b.branch_name_code)) = lower(trim(mp.branch))
    where coalesce(lower(trim(mp.status)), 'active') in ('', 'active')
      and not exists (select 1 from employee_branches eb where eb.employee_id = mp.mas_employee_id and eb.branch_id = b.branch_id)
    group by 1, 2, 3, 4 order by 5 desc`;
  console.log(`Supabase project: ${project}\n${missing.length} branch assignment(s) to add, covering ${missing.reduce((total, row) => total + row.accounts, 0)} active account(s):`);
  for (const row of missing) console.log(`  ${row.full_name} [${row.employee_id}] → ${row.branch} (${row.accounts} account(s))`);
  if (!apply) { console.log("\nDry run: nothing was written. Add --apply to add these assignments."); process.exit(0); }
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'MAS branch assignment', true)`;
    for (const row of missing) {
      // Assignment IDs follow the app's EBA-<employee>-NN pattern, numbered after the employee's existing ones.
      const [{ next }] = await tx`select count(*)::int + 1 as next from employee_branches where employee_id = ${row.employee_id}`;
      let number = next, id;
      do { id = `EBA-${row.employee_id}-${String(number++).padStart(2, "0")}`; } while ((await tx`select 1 from employee_branches where assignment_id = ${id}`).length);
      await tx`insert into employee_branches ${tx({ assignment_id: id, employee_id: row.employee_id, branch_id: row.branch_id, encoded_by_name: "MAS branch assignment", encoded_at: new Date().toISOString() })}`;
    }
  });
  console.log(`\nAdded ${missing.length} branch assignment(s).`);
} finally {
  await sql.end();
}
