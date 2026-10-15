// Owner-confirmed BUTUAN-NS rows 86 and 87 under CINDE CALUMBAY.
// Default row 86; use --source-row=87 for timestamp September 4, 2026 11:11:14.
// Dry run by default. Changes only the current enrollment MAS; historical financial entries retain their MAS.
import nextEnv from '@next/env';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const sourceRow = process.argv.find(arg => arg.startsWith('--source-row='))?.slice(13) || '86';
const cases = {
  '86': { enrollment: 'ENR-LEG-BE66BD801D', member: 'MEM-LEG-13CC32C9C9', number: 'PH-25732586', timestamp: 'September 4, 2026 11:08:57' },
  '87': { enrollment: 'ENR-LEG-121ECD2643', member: 'MEM-LEG-378041CD7A', number: 'PH-51014544', timestamp: 'September 4, 2026 11:11:14' },
};
if (!cases[sourceRow]) throw new Error('Only the owner-reviewed source rows 86 and 87 are supported.');
const { enrollment, member, number, timestamp } = cases[sourceRow];
const reason = `Owner requested the member from Data-Base-Old|BUTUAN-NS|${sourceRow}, timestamp ${timestamp}, under CINDE CALUMBAY.`;
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
class DryRun extends Error {}
try {
  await sql.begin(async tx => {
    await tx`select set_config('app.user_name', 'Owner-confirmed MAS assignment', true)`;
    const [account] = await tx`select * from member_programs where enrollment_id=${enrollment} for update`;
    if (!account || account.member_id !== member || account.member_number !== number || account.branch !== 'BUTUAN') throw new Error('Source account differs; review required.');
    const people = await tx`select employee_id, full_name, employment_status from employees where lower(trim(full_name))='cinde calumbay'`;
    if (people.length !== 1 || people[0].employment_status !== 'active') throw new Error('Expected one active CINDE CALUMBAY employee.');
    const target = people[0];
    if (account.mas_employee_id === target.employee_id && account.mas === target.full_name) { console.log(JSON.stringify({ alreadyAssigned: true, enrollment, memberNumber: account.member_number, mas: target.full_name })); return; }
    if (account.mas_employee_id !== 'LEG-2026-0022' || account.mas !== 'RACHO, KRISTINE') throw new Error('Current MAS changed since review; stop.');
    const branches = await tx`select b.branch_id from branches b join employee_branches eb on eb.branch_id=b.branch_id where eb.employee_id=${target.employee_id} and b.branch_name_code=${account.branch}`;
    if (branches.length !== 1) throw new Error('Target MAS must be assigned to the existing branch.');
    const [history] = await tx`select count(*)::int as collection_count, coalesce(sum(amount_collected),0)::float8 as collection_total from collections where enrollment_id=${enrollment}`;
    const sales = await tx`select sale_id, mas, mas_employee_id, amount_paid::float8 as amount from sales where member_number=${account.member_number} and program_id=${account.program_id} order by sale_id`;
    console.log(JSON.stringify({ apply, enrollment, memberNumber: account.member_number, branch: account.branch, from: account.mas, to: target.full_name, historicalCollections: history.collection_count, historicalSales: sales.length }));
    if (apply) {
      mkdirSync('backups', { recursive: true });
      writeFileSync(`backups/cinde-source${sourceRow}-${Date.now()}.json`, JSON.stringify({ account, history, sales }, null, 2));
    }
    const now = new Date().toISOString(), identity = { encoded_by_name: 'Owner-confirmed MAS assignment', encoded_at: now };
    await tx`update member_programs set mas=${target.full_name}, mas_employee_id=${target.employee_id} where enrollment_id=${enrollment}`;
    await tx`insert into member_transfers ${tx({ transfer_id: `MTR-CINDE-NS${sourceRow}-${Date.now()}`, enrollment_id: enrollment, member_id: member, member_number: account.member_number, program_id: account.program_id, branch: account.branch, from_mas: account.mas, from_employee_id: account.mas_employee_id, to_mas: target.full_name, to_employee_id: target.employee_id, reason, ...identity })}`;
    await tx`insert into record_corrections ${tx({ correction_id: `COR-CINDE-NS${sourceRow}-${Date.now()}`, module: 'Member MAS assignment', record_id: enrollment, reason, before_json: { mas: account.mas, employeeId: account.mas_employee_id }, after_json: { mas: target.full_name, employeeId: target.employee_id }, corrected_at: now, ...identity })}`;
    const [verified] = await tx`select mas, mas_employee_id from member_programs where enrollment_id=${enrollment}`;
    const [afterHistory] = await tx`select count(*)::int as collection_count, coalesce(sum(amount_collected),0)::float8 as collection_total from collections where enrollment_id=${enrollment}`;
    const afterSales = await tx`select sale_id, mas, mas_employee_id, amount_paid::float8 as amount from sales where member_number=${account.member_number} and program_id=${account.program_id} order by sale_id`;
    if (verified.mas !== target.full_name || verified.mas_employee_id !== target.employee_id || JSON.stringify(history) !== JSON.stringify(afterHistory) || JSON.stringify(sales) !== JSON.stringify(afterSales)) throw new Error('Verification failed; transaction rolled back.');
    if (!apply) throw new DryRun();
    console.log('Verified current MAS assignment and preserved historical entries.');
  });
} catch (error) { if (error instanceof DryRun) console.log('Dry run rolled back.'); else throw error; }
finally { await sql.end({ timeout: 1 }); }
