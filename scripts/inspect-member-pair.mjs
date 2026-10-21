// Back up two owner-requested member records; print account IDs and receipt counts only.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const numbers = process.argv.slice(2);
if (![1, 2].includes(numbers.length) || numbers.some((id) => !/^PH-\d{8}$/.test(id))) throw new Error('Pass one or two PH member numbers.');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const members = await tx`select * from members where member_number in ${tx(numbers)} order by member_number`;
    const accounts = await tx`select * from member_programs where member_number in ${tx(numbers)} order by member_number, program_id`;
    const collections = await tx`select * from collections where member_number in ${tx(numbers)} order by member_number, or_date, collection_id`;
    const sales = await tx`select * from sales where member_number in ${tx(numbers)}`;
    const transfers = await tx`select * from member_transfers where member_number in ${tx(numbers)}`;
    const beneficiaries = members.length ? await tx`select * from beneficiaries where member_id in ${tx(members.map((m) => m.member_id))}` : [];
    const programs = accounts.length ? await tx`select program_id, program_name, program_code, base_pay from programs where program_id in ${tx(accounts.map((a) => a.program_id))}` : [];
    fs.mkdirSync('backups', { recursive: true });
    const file = `backups/member-pair-${numbers.join('-')}-${Date.now()}.json`;
    fs.writeFileSync(file, JSON.stringify({ members, accounts, collections, sales, transfers, beneficiaries }, null, 2));
    const corrections = await tx`select correction_id, module from record_corrections where record_id in ${tx(numbers)} order by corrected_at desc limit 5`;
    console.log(JSON.stringify({ backup: file, corrections, members: members.map((m) => ({ id: m.member_id, number: m.member_number, age: m.age, name: [m.first_name, m.middle_name, m.surname].filter(Boolean).join(' ') })),
      sameBirthdate: members.length === 2 && String(members[0].birthdate) === String(members[1].birthdate),
      accounts: accounts.map((a) => ({ id: a.enrollment_id, member: a.member_number, program: programs.find((p) => p.program_id === a.program_id), doi: a.doi, status: a.status, accountStatus: a.account_status,
        nops: collections.filter((c) => c.enrollment_id === a.enrollment_id).map((c) => [c.month_from, c.nop_from]).sort(),
        collections: collections.filter((c) => c.enrollment_id === a.enrollment_id).length,
        total: collections.filter((c) => c.enrollment_id === a.enrollment_id).reduce((s, c) => s + Number(c.amount_collected), 0) })), sales: sales.length, transfers: transfers.length, beneficiaries: beneficiaries.length }, null, 2));
  });
} finally { await sql.end(); }
