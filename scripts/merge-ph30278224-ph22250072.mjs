/** Owner-confirmed same person; distinct programs preserved. Preview rolls back; --apply; --verify. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const keepNumber = 'PH-30278224', otherNumber = 'PH-22250072';
const tag = process.argv.includes('--staging') ? 'staging' : 'production';
const before = JSON.parse(fs.readFileSync(`legacy-data/pair-30278224-22250072-${tag}-private.json`, 'utf8'));
const keep = before.members.find(m => m.member_number === keepNumber), other = before.members.find(m => m.member_number === otherNumber);
assert.ok(keep && other);
const apply = process.argv.includes('--apply'), verifying = process.argv.includes('--verify');
const actor = 'Owner-confirmed member merge PH-30278224 PH-22250072';
const correctionId = 'COR-MERGE-PH30278224-PH22250072-20261023';
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const serial = v => JSON.parse(JSON.stringify(v));
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const joinedAccountFields = ['day', 'program_name', 'program_code', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id'];
const filled = {};
for (const key of ['middle_name', 'name_extension', 'birthdate', 'birthplace', 'gender', 'member_contact', 'address', 'civil_status', 'claimant_name', 'claimant_contact', 'claimant_address']) {
  if (!String(keep[key] ?? '').trim() && String(other[key] ?? '').trim()) filled[key] = other[key];
}
class Rollback extends Error {}
async function read(tx) {
  const members = serial(await tx`select * from members where member_id in (${keep.member_id},${other.member_id}) order by member_number`);
  const accounts = serial(await tx`select * from member_programs where member_id in (${keep.member_id},${other.member_id}) order by enrollment_id`);
  const collections = serial(await tx`select * from collections where member_id in (${keep.member_id},${other.member_id}) order by collection_id`);
  const sales = serial(await tx`select * from sales where member_number in (${keepNumber},${otherNumber}) order by sale_id`);
  const transfers = serial(await tx`select * from member_transfers where member_id in (${keep.member_id},${other.member_id}) order by transfer_id`);
  const beneficiaries = serial(await tx`select * from beneficiaries where member_id in (${keep.member_id},${other.member_id}) order by beneficiary_id`);
  return { members, accounts, collections, sales, transfers, beneficiaries };
}
function verifyRecords(saved, merged) {
  const expected = {
    members: merged ? [{ ...keep, ...filled }] : before.members,
    accounts: before.accounts.map(a => ({ ...omit(a, joinedAccountFields), ...(merged && a.member_id === other.member_id ? { member_id: keep.member_id, member_number: keepNumber } : {}) })),
    collections: before.collections.map(c => ({ ...omit(c, ['day']), ...(merged && c.member_id === other.member_id ? { member_id: keep.member_id, member_number: keepNumber } : {}) })),
    sales: before.sales.map(s => ({ ...s, ...(merged && s.member_number === otherNumber ? { member_number: keepNumber } : {}) })),
    transfers: before.transfers.map(t => ({ ...t, ...(merged && t.member_id === other.member_id ? { member_id: keep.member_id, member_number: keepNumber } : {}) })),
    beneficiaries: before.beneficiaries.map(b => ({ ...b, ...(merged && b.member_id === other.member_id ? { member_id: keep.member_id } : {}) })),
  };
  for (const key of Object.keys(expected)) assert.deepEqual(saved[key], expected[key], `Unexpected ${key} changes`);
}
async function verify(tx) {
  verifyRecords(await read(tx), true);
  assert.equal((await tx`select 1 from record_corrections where correction_id=${correctionId}`).length, 1);
  const changed = [...before.accounts.filter(a => a.member_id === other.member_id).map(a => a.enrollment_id), ...before.collections.filter(c => c.member_id === other.member_id).map(c => c.collection_id), other.member_id];
  const audits = await tx`select distinct record_id from audit_log where record_id in ${tx(changed)} and user_name=${actor}`;
  assert.equal(audits.length, changed.length);
  return { retainedMember: keepNumber, mergedMember: otherNumber, accounts: before.accounts.length, collections: before.collections.length, newSales: before.sales.length, financialAndCoverageFieldsPreserved: true, auditAndCorrectionVerified: true };
}
try {
  await sql.begin(async tx => {
    if (verifying) { await tx`set transaction isolation level repeatable read read only`; console.log(JSON.stringify(await verify(tx))); return; }
    await tx`lock table members,member_programs,collections,sales,member_transfers,beneficiaries in share row exclusive mode`;
    verifyRecords(await read(tx), false);
    assert.equal(before.members.length, 2);
    assert.equal(before.accounts.length, 2);
    assert.equal(new Set(before.accounts.map(a => a.program_id)).size, 2);
    const references = await tx`select tc.table_name from information_schema.table_constraints tc join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema where tc.constraint_type='FOREIGN KEY' and ccu.table_name='members' and ccu.column_name='member_id'`;
    assert.deepEqual([...new Set(references.map(r => r.table_name))].sort(), ['beneficiaries', 'collections', 'member_programs', 'member_transfers']);
    fs.mkdirSync('backups', { recursive: true });
    fs.writeFileSync(`backups/member-merge-30278224-22250072-${tag}-${apply ? 'apply' : 'preview'}-${Date.now()}.json`, JSON.stringify(before, null, 2));
    await tx`select set_config('app.user_name',${actor},true)`;
    if (Object.keys(filled).length) await tx`update members set ${tx(filled)} where member_id=${keep.member_id}`;
    await tx`update member_programs set member_id=${keep.member_id},member_number=${keepNumber} where member_id=${other.member_id}`;
    await tx`update collections set member_id=${keep.member_id},member_number=${keepNumber} where member_id=${other.member_id}`;
    await tx`update sales set member_number=${keepNumber} where member_number=${otherNumber}`;
    await tx`update member_transfers set member_id=${keep.member_id},member_number=${keepNumber} where member_id=${other.member_id}`;
    await tx`update beneficiaries set member_id=${keep.member_id} where member_id=${other.member_id}`;
    await tx`delete from members where member_id=${other.member_id}`;
    const stamp = new Date().toISOString();
    await tx`insert into record_corrections ${tx({ correction_id: correctionId, module: 'Same-person member merge', record_id: keepNumber, reason: 'Owner confirmed October 23, 2026 that PH-30278224 and PH-22250072 are the same person. Retain PH-30278224 and its profile, fill blank profile fields only, and move the duplicate member links while keeping distinct DS-320 and D-210 HG accounts. Preserve all account, receipt, financial, NOP, coverage and remittance fields. Conflicting profile values retained privately in this correction and Audit Log.', before_json: before, after_json: { keep: keep.member_id, memberNumber: keepNumber, mergedMemberId: other.member_id, filledFields: Object.keys(filled), accountIds: before.accounts.map(a => a.enrollment_id), preservedCollections: before.collections.length }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
    console.log(JSON.stringify({ ...await verify(tx), apply }));
    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; rolled back.');
  else { fs.writeFileSync('legacy-data/pair-merge-error-private.json', JSON.stringify({ message: error.message, stack: error.stack })); console.error('Merge stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await sql.end(); }
