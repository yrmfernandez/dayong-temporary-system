// Register the owner-identified MAS and link her seven existing legacy accounts.
// Dry run by default; use scripts/prod.mjs to select production, then --apply.
import nextEnv from '@next/env';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const name = 'CINDE CALUMBAY', alias = 'Calumbay, C.';
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.begin(async tx => {
    const accounts = await tx`select enrollment_id, member_id, member_number, branch, mas, mas_employee_id from member_programs where lower(mas) in (lower(${name}), lower(${alias})) for update`;
    if (accounts.length !== 7 || new Set(accounts.map(a => a.member_id)).size !== 7) throw new Error('Expected exactly seven existing member accounts. Review before proceeding.');
    const members = await tx`select member_id from members where member_id in ${tx(accounts.map(a => a.member_id))}`;
    if (members.length !== 7) throw new Error('An account has a missing member.');
    const existing = await tx`select employee_id, full_name from employees where full_name ilike '%calumbay%'`;
    if (existing.length > 1 || (existing.length && existing[0].full_name.toUpperCase() !== name)) throw new Error('Conflicting employee record; review required.');
    const branches = await tx`select branch_id, branch_name_code from branches where upper(branch_name_code) in ${tx([...new Set(accounts.map(a => a.branch.toUpperCase()))])}`;
    if (branches.length !== new Set(accounts.map(a => a.branch.toUpperCase())).size) throw new Error('Unknown account branch.');
    const ids = new Set((await tx`select employee_id from employees union select employee_id from users`).map(r => r.employee_id));
    let n = 1;
    while (ids.has(`LEG-2026-${String(n).padStart(4, '0')}`)) n++;
    const employeeId = existing[0]?.employee_id || `LEG-2026-${String(n).padStart(4, '0')}`;
    if (accounts.some(a => a.mas_employee_id && a.mas_employee_id !== employeeId)) throw new Error('An account is already linked to another employee.');
    console.log(JSON.stringify({ apply, employeeId, registerEmployee: !existing.length, existingMembers: members.length, accounts: accounts.length, branches: branches.map(b => b.branch_name_code) }));
    if (!apply) return;
    mkdirSync('backups', { recursive: true });
    writeFileSync(`backups/cinde-calumbay-${Date.now()}.json`, JSON.stringify({ accounts, existing }, null, 2));
    await tx`select set_config('app.user_name', 'Owner-requested MAS correction', true)`;
    if (!existing.length) await tx`insert into employees ${tx({ employee_id: employeeId, full_name: name, primary_branch: 'BUTUAN', operational_roles: 'MAS', employment_status: 'active', created_at: new Date().toISOString(), encoded_by_name: 'Owner-requested MAS correction', encoded_at: new Date().toISOString() })}`;
    for (const b of branches) await tx`insert into employee_branches ${tx({ assignment_id: `EBA-${employeeId}-${b.branch_id}`, employee_id: employeeId, branch_id: b.branch_id, encoded_by_name: 'Owner-requested MAS correction', encoded_at: new Date().toISOString() })} on conflict (employee_id, branch_id) do nothing`;
    const changed = {};
    for (const table of ['member_programs', 'sales', 'collections', 'remittances', 'bank_deposits']) {
      const result = await tx`update ${tx(table)} set mas=${name}, mas_employee_id=${employeeId} where lower(mas)=lower(${alias})`;
      changed[table] = result.count;
    }
    await tx`insert into record_corrections ${tx({ correction_id: `COR-CINDE-CALUMBAY-${Date.now()}`, module: 'MAS assignment', record_id: employeeId, reason: 'Owner identified Calumbay, C. as CINDE CALUMBAY; link seven existing members without duplicates.', before_json: { alias, accounts }, after_json: { employeeId, name, changed }, corrected_at: new Date().toISOString(), encoded_by_name: 'Owner-requested MAS correction', encoded_at: new Date().toISOString() })}`;
    const [check] = await tx`select count(*)::int as count from member_programs where mas=${name} and mas_employee_id=${employeeId}`;
    if (check.count !== 7) throw new Error('Verification failed; transaction rolled back.');
    console.log(JSON.stringify({ linkedMembers: check.count, changed }));
  });
} finally { await sql.end({ timeout: 1 }); }
