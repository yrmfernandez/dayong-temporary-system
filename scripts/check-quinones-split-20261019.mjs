// Read-only identity and payment checks for the source-confirmed SR/JR split.
import nextEnv from '@next/env';
import postgres from 'postgres';
import fs from 'node:fs';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const members = await sql`select member_id,member_number,first_name,surname,name_extension from members where upper(first_name) like 'DANILO%' and upper(surname) like 'QUI%'`;
  const accounts = await sql`select mp.enrollment_id,mp.member_number,mp.program_id,mp.doi::text,mp.account_status,count(c.collection_id)::int as receipts,sum(c.amount_collected)::float8 as total from member_programs mp left join collections c on c.enrollment_id=mp.enrollment_id where mp.member_id in (select member_id from members where upper(first_name) like 'DANILO%' and upper(surname) like 'QUI%') group by mp.enrollment_id order by mp.member_number`;
  const payments = await sql`select collection_id,member_number,or_number,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to from collections where member_id in (select member_id from members where upper(first_name) like 'DANILO%' and upper(surname) like 'QUI%') order by member_number,or_date,or_number`;
  console.log(JSON.stringify({members,accounts,payments}, null, 2));
  if (process.argv.includes('--verify')) {
    const { splits: [split] } = JSON.parse(fs.readFileSync('config/ph89863784-quinones-sr-split-20261019.json', 'utf8'));
    const sources = JSON.parse(fs.readFileSync('legacy-data/nine-receipt-source-review-20261019.json', 'utf8'));
    const backupFile = fs.readdirSync('backups').filter(name => name.startsWith('member-accounts-PH-89863784-')).sort().at(-1);
    const backup = JSON.parse(fs.readFileSync(`backups/${backupFile}`, 'utf8'));
    assert.equal(members.length, 2);
    assert.equal(accounts.length, 2);
    assert.equal(payments.length, 18);
    for (const [number, suffix, items] of [['PH-89863784', 'Jr.', split.keep], ['PH-26172119', 'Sr.', split.move]]) {
      assert.equal(members.find(m => m.member_number === number)?.name_extension, suffix);
      const account = accounts.find(a => a.member_number === number);
      assert.equal(account?.program_id, 'DP-0063');
      assert.equal(account.doi, '2021-10-01');
      assert.equal(account.account_status, 'U');
      assert.equal(account.receipts, 9);
      assert.equal(account.total, 2070);
      for (const [i, item] of items.entries()) {
        const p = payments.find(p => p.collection_id === item.collectionId);
        const source = sources.find(s => s.collectionId === item.collectionId);
        const before = backup.collections.find(c => c.collection_id === item.collectionId);
        assert.equal(p?.member_number, number);
        assert.equal(p.amount, 230);
        assert.equal(Number(before.amount_collected), p.amount);
        assert.equal(p.or_number, before.or_number);
        assert.equal(p.or_date, String(before.or_date).slice(0, 10));
        assert.equal(p.nop_from, source.nop);
        assert.equal(p.nop_to, source.nop);
        assert.equal(p.month_from, `2026-${String(i + 1).padStart(2, '0')}`);
        assert.equal(p.month_to, p.month_from);
        assert.ok(source.name.endsWith(suffix));
      }
    }
    console.log('Verified both identities, all 18 source receipts, unchanged IDs/dates/amounts/OR labels, January–September NOP52–60, and PHP4,140 total.');
  }
} finally { await sql.end(); }
