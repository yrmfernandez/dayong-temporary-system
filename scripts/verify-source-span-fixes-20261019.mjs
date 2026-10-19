// Read-only exact source-plan and backup comparison for the October 19 follow-up sweep.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const plans = ['legacy-data/source-cross-year-review-20261019.json','legacy-data/source-span-review-20261019.json'];
const cases = plans.flatMap(file => JSON.parse(fs.readFileSync(file,'utf8')).cases);
const db = postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const serialized = value => JSON.parse(JSON.stringify(value));
try { await db.begin('isolation level repeatable read read only',async tx => {
  for (const c of cases) {
    const filename = fs.readdirSync('backups').filter(f => f.startsWith(`member-accounts-${c.account.memberNumber}-`)).sort().at(-1);
    assert.ok(filename);
    const before = JSON.parse(fs.readFileSync(`backups/${filename}`,'utf8'));
    const accounts = serialized(await tx`select * from member_programs where member_id=${c.account.memberId}`);
    assert.equal(accounts.length,1);
    const [a] = accounts, original = before.accounts.find(p => p.enrollment_id === a.enrollment_id);
    for (const field of ['enrollment_id','member_id','program_id','doi','branch','mas','mas_employee_id']) assert.deepEqual(a[field],original[field]);
    assert.equal(a.account_status,c.statusAfter);
    const rows = serialized(await tx`select * from collections where member_id=${c.account.memberId} order by or_date,collection_id`);
    assert.equal(rows.length,before.collections.length);
    for (const p of rows) {
      const old = before.collections.find(r => r.collection_id === p.collection_id);
      assert.ok(old);
      for (const field of ['collection_id','member_id','enrollment_id','program_id','or_number','or_date','amount_collected','status','branch','mas','linked_remittance_id','remittance_status']) assert.deepEqual(p[field],old[field],`${c.account.memberNumber} ${field}`);
      const expected = c.proposed.find(r => r.id === p.collection_id);
      assert.ok(expected);
      for (const [field,key] of [['month_from','monthFrom'],['month_to','monthTo'],['nop_from','nopFrom'],['nop_to','nopTo']]) assert.equal(p[field],expected[key]);
    }
    assert.equal(rows.reduce((sum,r) => sum+Number(r.amount_collected),0),c.total);
    const records = await tx`select correction_id from record_corrections where record_id=${a.enrollment_id} and module='Receipt consolidation'`;
    assert.ok(records.length);
    console.log(JSON.stringify({member:c.account.memberNumber,receipts:rows.length,total:c.total,coverage:[rows[0].month_from,rows.at(-1).month_to],status:a.account_status,verified:true}));
  }
}); } finally { await db.end(); }
