// Read-only verification against each member's latest pre-correction backup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const { cases } = JSON.parse(fs.readFileSync('config/four-d210-split-fixes-20261019.json', 'utf8'));
// Backups serialize PostgreSQL Date objects as ISO strings; compare the same representation.
const serialized = rows => JSON.parse(JSON.stringify(rows));
try {
  await db.begin('isolation level repeatable read read only', async tx => {
    for (const item of cases) {
      const filename = fs.readdirSync('backups').filter(f => f.startsWith(`member-accounts-${item.member}-`) && f.endsWith('.json')).sort().at(-1);
      assert.ok(filename, `Missing backup for ${item.member}`);
      const before = JSON.parse(fs.readFileSync(`backups/${filename}`, 'utf8'));
      assert.equal(before.accounts.length, 2, 'Expected pre-correction split backup');
      const memberId = before.accounts[0].member_id;
      const accounts = serialized(await tx`select * from member_programs where member_id=${memberId}`);
      assert.equal(accounts.length, 1);
      const [account] = accounts;
      assert.equal(account.program_id, 'DP-0005');
      assert.equal(account.account_status, 'U');
      const original = before.accounts.find(a => a.program_id === 'DP-0005');
      for (const field of ['enrollment_id', 'doi', 'branch', 'mas', 'mas_employee_id']) assert.deepEqual(account[field], original[field], field);
      const after = serialized(await tx`select * from collections where member_id=${memberId} order by or_date,collection_id`);
      assert.equal(after.length, before.collections.length);
      for (const row of after) {
        const old = before.collections.find(r => r.collection_id === row.collection_id);
        assert.ok(old);
        assert.equal(row.program_id, 'DP-0005');
        assert.equal(row.enrollment_id, account.enrollment_id);
        for (const field of ['or_number','or_date','amount_collected','status','nop_from','nop_to','month_from','month_to','branch','mas','accountable_employee_id','linked_remittance_id','remittance_status']) assert.deepEqual(row[field], old[field], `${item.member} ${row.collection_id} ${field}`);
      }
      const corrections = await tx`select count(*)::int as count from record_corrections where record_id=${account.enrollment_id} and module='Receipt consolidation'`;
      assert.ok(corrections[0].count > 0);
      console.log(JSON.stringify({ member: item.member, receipts: after.length, total: after.reduce((sum,r) => sum + Number(r.amount_collected),0), coverage: [after[0].month_from,after.at(-1).month_to], status: account.account_status, verifiedAgainstBackup: true }));
    }
  });
} finally { await db.end(); }
