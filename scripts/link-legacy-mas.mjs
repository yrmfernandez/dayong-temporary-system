// Owner-confirmed legacy MAS correction. Dry run by default; prints counts and staff details only.
// node scripts/prod.mjs node scripts/link-legacy-mas.mjs --alias="Condes, M." --name="CONDES, MILDRED"
// After reviewing counts, add --apply --expected-members=N --expected-accounts=N.
import nextEnv from '@next/env';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLegacySources } from './legacy-sources.mjs';
import { createHash } from 'node:crypto';

nextEnv.loadEnvConfig(process.cwd());
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const alias = arg('alias'), name = arg('name'), apply = process.argv.includes('--apply');
if (!alias || !name) throw new Error('--alias and --name are required.');
const norm = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  if (process.argv.includes('--inspect-source')) {
    const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
    for (const source of sources) for (const tab of source.tabs) {
      const [header, ...rows] = tab.rows;
      const column = header.findIndex(value => norm(value) === 'MARKETING AGENT');
      if (column < 0) continue;
      const refs = rows.flatMap((row, index) => norm(row[column]) === norm(alias) ? [tab.firstRow + index + 1] : []);
      if (refs.length) {
        const sales = tab.title.endsWith('-NS');
        const prefix = sales ? 'SALE' : 'COL', table = sales ? 'sales' : 'collections', idColumn = sales ? 'sale_id' : 'collection_id';
        const ids = refs.map(row => `${prefix}-LEG-${createHash('sha1').update(`Data-Base-Old|${tab.title}|${row}`).digest('hex').slice(0, 10).toUpperCase()}`);
        const present = await sql`select ${sql(idColumn)} as id from ${sql(table)} where ${sql(idColumn)} in ${sql(ids)}`;
        const known = new Set(present.map(row => row.id));
        console.log(JSON.stringify({ sourceTab: tab.title, count: refs.length, importedRecords: present.length, rowsWithoutSourceId: refs.filter((_, index) => !known.has(ids[index])) }));
      }
    }
  }
  await sql.begin(async tx => {
    const accounts = await tx`select enrollment_id, member_id, member_number, branch, mas, mas_employee_id from member_programs where lower(trim(mas)) in (lower(${name}), lower(${alias})) for update`;
    if (!accounts.length) throw new Error('No existing accounts match; use the legacy importer to review missing members.');
    const memberIds = [...new Set(accounts.map(a => a.member_id))];
    const members = await tx`select member_id from members where member_id in ${tx(memberIds)}`;
    if (members.length !== memberIds.length) throw new Error('An account has a missing member.');
    const candidates = await tx`select employee_id, full_name from employees where full_name ilike ${'%' + alias.split(',')[0].trim() + '%'}`;
    const existing = candidates.filter(e => [norm(alias), norm(name)].includes(norm(e.full_name)));
    console.log(JSON.stringify({ employeeCandidates: candidates, existingMembers: members.length, accounts: accounts.length }));
    if (candidates.length !== existing.length || existing.length > 1) throw new Error('Conflicting employee names; review required.');
    const branchCounts = new Map();
    for (const a of accounts) branchCounts.set(norm(a.branch), (branchCounts.get(norm(a.branch)) || 0) + 1);
    const branches = await tx`select branch_id, branch_name_code from branches where upper(branch_name_code) in ${tx([...branchCounts.keys()])}`;
    if (branches.length !== branchCounts.size) throw new Error('Unknown account branch.');
    branches.sort((a, b) => branchCounts.get(norm(b.branch_name_code)) - branchCounts.get(norm(a.branch_name_code)) || a.branch_name_code.localeCompare(b.branch_name_code));
    const ids = new Set((await tx`select employee_id from employees union select employee_id from users`).map(r => r.employee_id));
    let n = 1;
    while (ids.has(`LEG-2026-${String(n).padStart(4, '0')}`)) n++;
    const employeeId = existing[0]?.employee_id || `LEG-2026-${String(n).padStart(4, '0')}`;
    if (accounts.some(a => a.mas_employee_id && a.mas_employee_id !== employeeId)) throw new Error('An account is linked to another employee.');
    const before = {};
    for (const table of ['member_programs', 'sales', 'collections', 'remittances', 'bank_deposits']) {
      before[table] = await tx`select * from ${tx(table)} where lower(trim(mas)) in (lower(${alias}), lower(${name}))`;
      if (before[table].some(row => row.mas_employee_id && row.mas_employee_id !== employeeId)) throw new Error(`Conflicting employee link in ${table}.`);
    }
    console.log(JSON.stringify({ apply, employeeId, registerEmployee: !existing.length, primaryBranch: branches[0].branch_name_code, branches: branches.map(b => b.branch_name_code), records: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, { total: rows.length, needingCorrection: rows.filter(row => row.mas !== name || row.mas_employee_id !== employeeId).length }])) }));
    if (!apply) return;
    if (Number(arg('expected-members')) !== members.length || Number(arg('expected-accounts')) !== accounts.length) throw new Error('Explicit expected member/account counts must match the reviewed dry run.');
    mkdirSync('backups', { recursive: true });
    const stamp = Date.now(), identity = { encoded_by_name: 'Owner-requested MAS correction', encoded_at: new Date().toISOString() };
    writeFileSync(`backups/legacy-mas-link-${employeeId}-${stamp}.json`, JSON.stringify({ alias, name, employeeId, existing, before }, null, 2));
    await tx`select set_config('app.user_name', 'Owner-requested MAS correction', true)`;
    if (!existing.length) await tx`insert into employees ${tx({ employee_id: employeeId, full_name: name, primary_branch: branches[0].branch_name_code, operational_roles: 'MAS', employment_status: 'active', created_at: new Date().toISOString(), ...identity })}`;
    else if (existing[0].full_name !== name) await tx`update employees set full_name=${name} where employee_id=${employeeId}`;
    for (const b of branches) await tx`insert into employee_branches ${tx({ assignment_id: `EBA-${employeeId}-${b.branch_id}`, employee_id: employeeId, branch_id: b.branch_id, ...identity })} on conflict (employee_id, branch_id) do nothing`;
    const changed = {};
    for (const table of Object.keys(before)) {
      const result = await tx`update ${tx(table)} set mas=${name}, mas_employee_id=${employeeId} where lower(trim(mas)) in (lower(${alias}), lower(${name})) and (mas is distinct from ${name} or mas_employee_id is distinct from ${employeeId})`;
      changed[table] = result.count;
    }
    await tx`insert into record_corrections ${tx({ correction_id: `COR-MAS-LINK-${employeeId}-${stamp}`, module: 'MAS assignment', record_id: employeeId, reason: `Owner identified ${alias} as ${name}; link existing members without duplicates.`, before_json: { alias, enrollmentIds: accounts.map(a => a.enrollment_id) }, after_json: { employeeId, name, changed }, corrected_at: new Date().toISOString(), ...identity })}`;
    const [check] = await tx`select count(*)::int as count from member_programs where mas=${name} and mas_employee_id=${employeeId}`;
    if (check.count !== accounts.length) throw new Error('Verification failed; transaction rolled back.');
    console.log(JSON.stringify({ verifiedAccounts: check.count, linkedMembers: members.length, changed }));
  });
} finally { await sql.end({ timeout: 1 }); }
