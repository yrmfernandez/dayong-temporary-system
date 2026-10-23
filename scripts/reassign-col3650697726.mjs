/** Owner-confirmed receipt ownership correction; rollback preview by default; --apply; --verify. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, forfeitMonthsFor } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const id = 'COL-LEG-3650697726', memberNumber = 'PH-29405174';
const tag = process.argv.includes('--staging') ? 'staging' : 'production';
const before = JSON.parse(fs.readFileSync(`legacy-data/reassign-3650697726-${tag}-private.json`, 'utf8'));
const target = before.members.find(m => m.member_number === memberNumber);
assert.ok(target);
const candidates = before.accounts.filter(a => a.member_id === target.member_id && a.program_id === before.receipt.program_id);
assert.equal(candidates.length, 1);
const targetAccount = candidates[0], sourceAccount = before.accounts.find(a => a.enrollment_id === before.receipt.enrollment_id);
assert.ok(sourceAccount && sourceAccount.enrollment_id !== targetAccount.enrollment_id);
const apply = process.argv.includes('--apply'), verifying = process.argv.includes('--verify');
const actor = 'Owner-confirmed collection ownership correction COL-LEG-3650697726';
const correctionId = 'COR-OWNER-COLLEG3650697726-20261023';
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const serial = value => JSON.parse(JSON.stringify(value));
const omit = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const derived = ['day', 'program_name', 'program_code', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id'];
const patched = { ...before.receipt, member_id: target.member_id, member_number: memberNumber, enrollment_id: targetAccount.enrollment_id };
const expectedHistory = before.histories.map(r => r.collection_id === id ? patched : r);
const statuses = new Map();
for (const a of [sourceAccount, targetAccount]) {
  const rows = expectedHistory.filter(r => r.enrollment_id === a.enrollment_id && r.status === 'Posted');
  const state = accountState({ id: a.enrollment_id, doi: a.day, basePay: a.rate, payBalanceTotal: a.total || 0, storedStatus: a.account_status, flexible: a.flexible, maxMonthlyPayment: a.maximum, registrationFee: a.registration_fee_required, forfeitMonths: forfeitMonthsFor(a.category_id) }, rows.map(r => ({ id: r.collection_id, enrollmentId: a.enrollment_id, orDate: r.day, orNumber: r.or_number, monthFrom: r.month_from, monthTo: r.month_to, nopFrom: r.nop_from, nopTo: r.nop_to, amount: Number(r.amount_collected) })), '2026-10-23');
  statuses.set(a.enrollment_id, state.status);
}
class Rollback extends Error {}
async function verify(tx) {
  const accounts = serial(await tx`select * from member_programs where enrollment_id in ${tx(before.accounts.map(a => a.enrollment_id))} order by enrollment_id`);
  assert.deepEqual(accounts, before.accounts.map(a => ({ ...omit(a, derived), account_status: statuses.get(a.enrollment_id) ?? a.account_status })));
  const history = serial(await tx`select *,or_date::text as day from collections where enrollment_id in ${tx(before.accounts.map(a => a.enrollment_id))} order by or_date,collection_id`);
  assert.deepEqual(history, expectedHistory);
  const members = serial(await tx`select * from members where member_id in ${tx(before.members.map(m => m.member_id))}`);
  for (const original of before.members) assert.deepEqual(members.find(m => m.member_id === original.member_id), original);
  const links = serial(await tx`select * from remittance_collections where collection_id=${id}`);
  assert.deepEqual(links, before.links);
  assert.equal((await tx`select 1 from record_corrections where correction_id=${correctionId}`).length, 1);
  assert.ok((await tx`select 1 from audit_log where table_name='collections' and record_id=${id} and user_name=${actor} and changes_json ? 'member_id'`).length > 0);
  return { correctedCollections: 1, targetMember: memberNumber, targetProgram: targetAccount.program_name, targetCollectionCount: history.filter(r => r.enrollment_id === targetAccount.enrollment_id).length, accountStatusesVerified: true, paymentAndCoverageFieldsPreserved: true, auditAndCorrectionVerified: true };
}
try {
  await db.begin(async tx => {
    if (verifying) { await tx`set transaction isolation level repeatable read read only`; console.log(JSON.stringify(await verify(tx))); return; }
    await tx`select enrollment_id from member_programs where enrollment_id in ${tx(before.accounts.map(a => a.enrollment_id))} for update`;
    const rows = serial(await tx`select *,or_date::text as day from collections where enrollment_id in ${tx(before.accounts.map(a => a.enrollment_id))} order by or_date,collection_id for update`);
    assert.deepEqual(rows, before.histories, 'History changed since preview snapshot');
    const accounts = serial(await tx`select * from member_programs where enrollment_id in ${tx(before.accounts.map(a => a.enrollment_id))} order by enrollment_id`);
    assert.deepEqual(accounts, before.accounts.map(a => omit(a, derived)), 'Accounts changed since preview snapshot');
    assert.equal((await tx`select 1 from remittance_collections where collection_id=${id}`).length, 0);
    assert.equal(before.receipt.linked_remittance_id, null);
    fs.mkdirSync('backups', { recursive: true });
    fs.writeFileSync(`backups/reassign-3650697726-${tag}-${apply ? 'apply' : 'preview'}-${Date.now()}.json`, JSON.stringify(before, null, 2));
    await tx`select set_config('app.user_name',${actor},true)`;
    await tx`update collections set member_id=${target.member_id},member_number=${memberNumber},enrollment_id=${targetAccount.enrollment_id} where collection_id=${id}`;
    for (const [accountId, status] of statuses) await tx`update member_programs set account_status=${status} where enrollment_id=${accountId} and account_status is distinct from ${status}`;
    const stamp = new Date().toISOString();
    await tx`insert into record_corrections ${tx({ correction_id: correctionId, module: 'Collection ownership correction', record_id: id, reason: 'Owner confirmed October 23, 2026: COL-LEG-3650697726 belongs to PH-29405174. Move receipt to the member\'s existing D-350 account; preserved NOP and covered months fit without overlaps. Preserve program, amount, dates, financial snapshots, remittance fields and all other receipts. Refresh source and target account statuses; retain both account records.', before_json: before, after_json: { receipt: patched, statuses: Object.fromEntries(statuses) }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
    console.log(JSON.stringify({ ...await verify(tx), apply }));
    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; rolled back.');
  else { fs.writeFileSync('legacy-data/reassign-3650697726-error-private.json', JSON.stringify({ message: error.message, stack: error.stack })); console.error('Correction stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await db.end(); }
