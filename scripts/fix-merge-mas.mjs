/**
 * Puts back the MAS of the merged-away account on same-person merges whose two accounts had different MAS (October 8,
 * 2026). merge-name-variants.mjs kept the kept account's MAS, but the owner says these members belong to the MAS of
 * their other account (Kisha Karen Potenciando belonged to Jo-Ann Bautista, not "Bautista, T."). The pairs are found
 * from Record Corrections ("Same-person merge") and the Audit Log row of the deleted account.
 *
 *   node scripts/fix-merge-mas.mjs                       dry run on staging
 *   node scripts/fix-merge-mas.mjs --apply               fix on staging
 *   npm run prod -- node scripts/fix-merge-mas.mjs [--apply]
 *
 * Skipped: accounts whose MAS was already changed after the merge (e.g. transferred in the app). Each fix writes a
 * Member Transfers row like Members → Transfer, and assigns the MAS to the account's branch when they are not yet, so
 * the member is listed in Collections. Prints member and employee names (the owner reviews them).
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const text = (value) => String(value ?? "").trim();
const rowOf = (changes) => changes?.old ?? changes?.before ?? changes ?? {};

try {
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run"}\n`);
  const merges = await sql`select record_id as keep, before_json->>'other' as other, corrected_at from record_corrections where module = 'Same-person merge' order by corrected_at`;
  let fixed = 0;
  for (const merge of merges) {
    const [account] = await sql`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, mp.branch, mp.mas,
        trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name
      from member_programs mp join members m on m.member_id = mp.member_id where mp.enrollment_id = ${merge.keep}`;
    const [deleted] = await sql`select changes_json from audit_log where record_id = ${merge.other} and action = 'delete' order by logged_at desc limit 1`;
    // The kept account's MAS at the time of the merge: the merge's own update of it (its "old" values), logged with the merge.
    const [before] = await sql`select changes_json from audit_log where record_id = ${merge.keep} and action = 'update'
      and logged_at <= ${merge.corrected_at}::timestamptz + interval '1 minute' order by logged_at desc limit 1`;
    if (!account || !deleted) continue;
    // Transferred in the app since the merge (e.g. Kisha to Jo-Ann Bautista): the owner already chose; leave it.
    const [moved] = await sql`select to_mas from member_transfers where enrollment_id = ${account.enrollment_id} and encoded_at > ${merge.corrected_at}::timestamptz order by encoded_at desc limit 1`;
    if (moved) { console.log(`  skipped ${account.name} (${account.branch}): transferred since the merge (now "${account.mas}")`); continue; }
    const otherMas = text(rowOf(deleted.changes_json).mas);
    const keptMasAtMerge = text(rowOf(before?.changes_json).mas) || text(account.mas);
    if (!otherMas || otherMas.toLowerCase() === keptMasAtMerge.toLowerCase()) continue;
    if (text(account.mas).toLowerCase() !== keptMasAtMerge.toLowerCase()) { console.log(`  skipped ${account.name} (${account.branch}): MAS already changed after the merge (now "${account.mas}")`); continue; }
    if (text(account.mas).toLowerCase() === otherMas.toLowerCase()) continue;
    const [employee] = await sql`select employee_id, full_name from employees where lower(trim(full_name)) = lower(${otherMas})`;
    if (!employee) { console.log(`  ${account.name}: "${otherMas}" is not an employee now; transfer in the app instead`); continue; }
    const [branch] = await sql`select branch_id from branches where lower(trim(branch_name_code)) = lower(trim(${account.branch}))`;
    const assigned = branch && (await sql`select 1 from employee_branches where employee_id = ${employee.employee_id} and branch_id = ${branch.branch_id}`).length > 0;
    console.log(`  ${account.name} (${account.branch}): "${account.mas}" → "${employee.full_name}"${assigned ? "" : ` (and assign ${employee.full_name} to ${account.branch})`}`);
    fixed++;
    if (!apply) continue;
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', 'Merge MAS fix', true)`;
      await tx`update member_programs set mas = ${employee.full_name} where enrollment_id = ${account.enrollment_id}`;
      await tx`insert into member_transfers ${tx({ transfer_id: `MTR-MRG-${account.enrollment_id.slice(-10)}`, enrollment_id: account.enrollment_id, member_id: account.member_id, member_number: account.member_number,
        program_id: account.program_id, branch: account.branch, from_mas: account.mas, to_mas: employee.full_name, to_employee_id: employee.employee_id,
        reason: "MAS put back after the same-person merge (owner, October 8, 2026)", encoded_by_name: "Merge MAS fix", encoded_at: new Date().toISOString() })}`;
      if (branch && !assigned) {
        const [{ count }] = await tx`select count(*)::int as count from employee_branches where employee_id = ${employee.employee_id}`;
        await tx`insert into employee_branches ${tx({ assignment_id: `EBA-${employee.employee_id}-M${String(count + 1).padStart(2, "0")}`, employee_id: employee.employee_id, branch_id: branch.branch_id, encoded_by_name: "Merge MAS fix", encoded_at: new Date().toISOString() })}`;
      }
    });
  }
  console.log(`\n${apply ? "Fixed" : "Would fix"} ${fixed} account(s).${apply ? "" : " Dry run: nothing was written. Add --apply to fix."}`);
} finally {
  await sql.end();
}
