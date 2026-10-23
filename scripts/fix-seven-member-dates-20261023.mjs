/** Owner-requested batch: source-verified missing remittance dates only. Preview rolls back; --apply; --verify. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { sourceDay, receiptKey } from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const memberNumbers = ['PH-67351553', 'PH-46825655', 'PH-02029542', 'PH-91569049', 'PH-47993881', 'PH-06901860', 'PH-68238498'];
const tag = process.argv.includes('--staging') ? 'staging' : 'production';
const apply = process.argv.includes('--apply'), verifying = process.argv.includes('--verify');
const actor = 'Owner-requested seven-member date correction October 23 2026';
const serial = v => JSON.parse(JSON.stringify(v));
const omit = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const derived = ['day', 'program_name', 'program_code', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id'];
const staged = tag === 'staging' ? JSON.parse(fs.readFileSync('legacy-data/batch-seven-staging-before-private.json', 'utf8')).cases : null;
const cases = memberNumbers.map(member => {
  const original = staged?.find(c => c.member === member) ?? JSON.parse(fs.readFileSync(`legacy-data/batch-seven-${member}-production-before-private.json`, 'utf8'));
  const checks = JSON.parse(fs.readFileSync(`legacy-data/batch-seven-${member}-checks-private.json`, 'utf8'));
  const before = { member, members: original.members, accounts: staged ? original.accounts : original.accounts.map(a => omit(a, derived)), history: original.history, sales: staged ? original.sales : original.sales.map(s => omit(s, ['day', 'receipt_day'])) };
  const norm = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const patches = [];
  for (const row of before.history) {
    if (row.date_remitted) continue;
    const raw = checks.sources.find(s => s.id === row.collection_id);
    assert.ok(raw, 'Missing source for an undated receipt');
    const columns = new Map(raw.headers.map((h, i) => [norm(h), i]));
    const get = key => raw.row[columns.get(key)];
    assert.equal(receiptKey(get('ORNUMBER')), receiptKey(row.or_number));
    assert.equal(sourceDay(get('ORDATE')), row.day);
    assert.equal(Number(get('AMOUNTCOLLECTED')), Number(row.amount_collected));
    assert.equal(row.member_number, member);
    assert.equal(row.linked_remittance_id, null);
    const date = sourceDay(get('DATEREMITTED'));
    assert.ok(date && date >= row.day && date <= '2026-10-23');
    patches.push({ id: row.collection_id, date });
  }
  return { ...before, patches, correctionId: `COR-MISSING-DATES-20261023-${member}` };
});
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
async function verify(tx) {
  for (const c of cases) {
    const saved = serial(await tx`select *,or_date::text as day from collections where member_number=${c.member} order by or_date,collection_id`);
    const patches = new Map(c.patches.map(p => [p.id, p.date]));
    assert.deepEqual(saved, c.history.map(row => ({ ...row, ...(patches.has(row.collection_id) ? { date_remitted: `${patches.get(row.collection_id)}T00:00:00.000Z` } : {}) })));
    const accounts = serial(await tx`select * from member_programs where member_number=${c.member} order by enrollment_id`);
    assert.deepEqual(accounts, c.accounts);
    const sales = serial(await tx`select * from sales where member_number=${c.member} order by sale_id`);
    assert.deepEqual(sales, [...c.sales].sort((a, b) => a.sale_id.localeCompare(b.sale_id)));
    const profiles = serial(await tx`select * from members where member_number=${c.member}`);
    assert.deepEqual(profiles, c.members);
    assert.equal((await tx`select 1 from record_corrections where correction_id=${c.correctionId}`).length, 1);
    const audited = await tx`select distinct record_id from audit_log where table_name='collections' and record_id in ${tx(c.patches.map(p => p.id))} and user_name=${actor} and changes_json ? 'date_remitted'`;
    assert.equal(audited.length, c.patches.length);
  }
  return { members: cases.length, restoredRemittanceDates: cases.reduce((n, c) => n + c.patches.length, 0), amountsNopsCoverageFinanceAndProfilesPreserved: true, auditsAndCorrectionsVerified: true };
}
class Rollback extends Error {}
try {
  await db.begin(async tx => {
    if (verifying) { await tx`set transaction isolation level repeatable read read only`; console.log(JSON.stringify(await verify(tx))); return; }
    await tx`set transaction isolation level serializable`;
    const accountIds = cases.flatMap(c => c.accounts.map(a => a.enrollment_id));
    await tx`select enrollment_id from member_programs where enrollment_id in ${tx(accountIds)} for update`;
    for (const c of cases) {
      const history = serial(await tx`select *,or_date::text as day from collections where member_number=${c.member} order by or_date,collection_id for update`);
      assert.deepEqual(history, c.history, 'Receipt history changed since review');
      const accounts = serial(await tx`select * from member_programs where member_number=${c.member} order by enrollment_id`);
      assert.deepEqual(accounts, c.accounts, 'Account changed since review');
    }
    const ids = cases.flatMap(c => c.patches.map(p => p.id));
    assert.equal((await tx`select 1 from remittance_collections where collection_id in ${tx(ids)}`).length, 0);
    fs.mkdirSync('backups', { recursive: true });
    fs.writeFileSync(`backups/seven-member-dates-${tag}-${apply ? 'apply' : 'preview'}-${Date.now()}.json`, JSON.stringify({ cases }, null, 2));
    await tx`select set_config('app.user_name',${actor},true)`;
    const allPatches = cases.flatMap(c => c.patches);
    await tx`update collections c set date_remitted=p.date::date from jsonb_to_recordset(${JSON.stringify(allPatches)}::text::jsonb) as p(id text,date text) where c.collection_id=p.id`;
    const stamp = new Date().toISOString();
    for (const c of cases) await tx`insert into record_corrections ${tx({ correction_id: c.correctionId, module: 'Missing remittance date correction', record_id: c.member, reason: 'Owner requested fixing this member October 23, 2026. Matching original workbook receipt identity, OR date and amount confirm missing Date Remitted values on or after OR dates. Restore only missing source-confirmed dates. Preserve prior program moves, merges, DOI, status, NOPs, covered months, payment and financial fields, New Sales and profile. Current payment histories checked independently.', before_json: c, after_json: { remittanceDates: c.patches }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
    console.log(JSON.stringify({ ...await verify(tx), apply }));
    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; rolled back.');
  else { fs.writeFileSync('backups/seven-member-dates-error-private.json', JSON.stringify({ message: error.message, stack: error.stack })); console.error('Batch stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await db.end(); }
