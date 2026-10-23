/** Restore missing, source-verified remittance dates; preview by default; --apply; --verify. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { receiptKey, sourceDay } from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member = 'PH-21342295', tag = process.argv.includes('--staging') ? 'staging' : 'production';
const before = JSON.parse(fs.readFileSync(`legacy-data/ph21342295-${tag}-before-private.json`, 'utf8'));
const sources = JSON.parse(fs.readFileSync(`legacy-data/member-source-${member}-private.json`, 'utf8'));
const apply = process.argv.includes('--apply'), verifying = process.argv.includes('--verify');
const actor = 'Source-confirmed missing remittance dates PH-21342295';
const correctionId = 'COR-DATE-PH21342295-20261023';
const serial = v => JSON.parse(JSON.stringify(v));
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
assert.ok(before.accounts.length >= 1); assert.equal(before.history.length, 3);
const normalized = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const patches = before.history.map(row => {
  const raw = sources.find(s => s.id === row.collection_id);
  assert.ok(raw);
  const positions = new Map(raw.headers.map((h, i) => [normalized(h), i]));
  const get = key => raw.row[positions.get(key)];
  assert.equal(receiptKey(get('ORNUMBER')), receiptKey(row.or_number));
  assert.equal(sourceDay(get('ORDATE')), row.day);
  assert.equal(Number(get('AMOUNTCOLLECTED')), Number(row.amount_collected));
  assert.ok(!row.date_remitted, 'Only missing dates may be restored');
  assert.equal(row.linked_remittance_id, null);
  const date = sourceDay(get('DATEREMITTED'));
  assert.ok(date && date >= row.day && date <= '2026-10-23');
  return { id: row.collection_id, date };
});
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const accountIds = before.accounts.map(a => a.enrollment_id);
async function verify(tx) {
  const history = serial(await tx`select *,or_date::text as day from collections where member_number=${member} order by or_date,collection_id`);
  assert.deepEqual(history, before.history.map(row => ({ ...row, date_remitted: `${patches.find(p => p.id === row.collection_id).date}T00:00:00.000Z` })));
  const accounts = serial(await tx`select * from member_programs where member_number=${member} order by enrollment_id`);
  const derived = ['day', 'program_name', 'program_code', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id'];
  assert.deepEqual(accounts, before.accounts.map(a => omit(a, derived)));
  const sales = serial(await tx`select *,or_date::text as receipt_day,doi::text as day from sales where member_number=${member}`);
  assert.deepEqual(sales, before.sales);
  const members = serial(await tx`select * from members where member_number=${member}`);
  assert.deepEqual(members, before.members);
  assert.equal((await tx`select 1 from record_corrections where correction_id=${correctionId}`).length, 1);
  const audits = await tx`select distinct record_id from audit_log where table_name='collections' and record_id in ${tx(patches.map(p => p.id))} and user_name=${actor} and changes_json ? 'date_remitted'`;
  assert.equal(audits.length, patches.length);
  return { restoredRemittanceDates: patches.length, nopCoverageAndFinancePreserved: true, accountSaleAndProfilePreserved: true, auditAndCorrectionVerified: true };
}
class Rollback extends Error {}
try {
  await db.begin(async tx => {
    if (verifying) { await tx`set transaction isolation level repeatable read read only`; console.log(JSON.stringify(await verify(tx))); return; }
    await tx`select enrollment_id from member_programs where enrollment_id in ${tx(accountIds)} for update`;
    const current = serial(await tx`select *,or_date::text as day from collections where member_number=${member} order by or_date,collection_id for update`);
    assert.deepEqual(current, before.history, 'History changed since review');
    assert.equal((await tx`select 1 from remittance_collections where collection_id in ${tx(patches.map(p => p.id))}`).length, 0);
    fs.mkdirSync('backups', { recursive: true });
    fs.writeFileSync(`backups/ph21342295-dates-${tag}-${apply ? 'apply' : 'preview'}-${Date.now()}.json`, JSON.stringify({ before, patches }));
    await tx`select set_config('app.user_name',${actor},true)`;
    for (const p of patches) await tx`update collections set date_remitted=${p.date} where collection_id=${p.id}`;
    const stamp = new Date().toISOString();
    await tx`insert into record_corrections ${tx({ correction_id: correctionId, module: 'Missing remittance date correction', record_id: member, reason: 'Owner requested fixing PH-21342295 on October 23, 2026. Earlier source-confirmed NOP sweep already corrected the collection sequence to NOP 2–8. Original workbook independently confirms all three receipt identities, amounts and missing remittance dates. Restore only those missing dates; preserve existing DOI, program, NOPs, coverage, status, amounts, financial snapshots and New Sale.', before_json: before, after_json: { remittanceDates: patches }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
    console.log(JSON.stringify({ ...await verify(tx), apply }));
    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; rolled back.');
  else { fs.writeFileSync('backups/ph21342295-dates-error-private.json', JSON.stringify({ message: error.message, stack: error.stack })); console.error('Correction stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await db.end(); }
