/** Aggregate-only source repair. Private plan/backups; preview rolls back, --apply commits, --verify checks readback. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { repriceEntries } from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const serial = (v) => JSON.parse(JSON.stringify(v));
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const actor = 'Other program source history correction';
const prefix = 'other-program-source-applied-20261021-';
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
class Rollback extends Error {}
async function verify(tx, snapshot) {
  const { plan, accounts, collections, finance } = snapshot;
  const ids = accounts.map((a) => a.enrollment_id);
  const savedAccounts = serial(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id`);
  const savedCollections = serial(await tx`select * from collections where enrollment_id in ${tx(ids)} order by collection_id`);
  assert.equal(savedAccounts.length, accounts.length); assert.equal(savedCollections.length, collections.length);
  const accountMap = new Map(accounts.map((a) => [a.enrollment_id, a]));
  const collectionMap = new Map(collections.map((c) => [c.collection_id, c]));
  const proposed = new Map(plan.cases.flatMap((c) => c.proposed.map((p) => [p.id, p])));
  const cases = new Map(plan.cases.map((c) => [c.account.enrollment_id, c]));
  const nopIds = new Set(snapshot.nopIds), prices = new Map(finance.changes.map((p) => [p.id, p]));
  let changed = 0, monthCorrections = 0, nopCorrections = 0;
  for (const row of savedCollections) {
    const old = collectionMap.get(row.collection_id), p = proposed.get(row.collection_id);
    assert.ok(old && p);
    const fields = ['month_from','month_to','nop_from','nop_to', ...(nopIds.has(row.collection_id) ? ['remittance_amount','remittance_breakdown','forfeited_incentive'] : [])];
    assert.deepEqual(omit(row, fields), omit(old, fields));
    assert.equal(row.month_from, p.monthFrom); assert.equal(row.month_to, p.monthTo);
    assert.equal(row.nop_from, p.nopFrom); assert.equal(row.nop_to, p.nopTo);
    const monthChanged = row.month_from !== old.month_from || row.month_to !== old.month_to;
    const nopChanged = row.nop_from !== old.nop_from || row.nop_to !== old.nop_to;
    changed += monthChanged || nopChanged ? 1 : 0; monthCorrections += monthChanged ? 1 : 0; nopCorrections += nopChanged ? 1 : 0;
    const price = prices.get(row.collection_id);
    if (price) {
      assert.equal(Number(row.remittance_amount), price.after.remittance);
      assert.deepEqual(row.remittance_breakdown, price.after.breakdown);
      assert.equal(Number(row.forfeited_incentive), Number(price.after.forfeited));
    } else for (const key of ['remittance_amount','remittance_breakdown','forfeited_incentive']) assert.deepEqual(row[key], old[key]);
  }
  for (const row of savedAccounts) {
    const c = cases.get(row.enrollment_id);
    assert.deepEqual(omit(row, ['doi','account_status']), omit(accountMap.get(row.enrollment_id), ['doi','account_status']));
    assert.equal(row.doi.slice(0, 10), c.doi); assert.equal(row.account_status, c.status);
  }
  assert.equal(changed, plan.summary.changedReceipts);
  const records = await tx`select correction_id from record_corrections where correction_id in ${tx(snapshot.correctionIds)}`;
  assert.equal(records.length, plan.cases.length);
  const required = [...snapshot.accountChangedIds, ...snapshot.collectionChangedIds];
  const audits = required.length ? await tx`select distinct record_id from audit_log where record_id in ${tx(required)} and user_name = ${actor} and logged_at >= ${snapshot.startedAt}` : [];
  assert.equal(audits.length, new Set(required).size);
  return { accounts: savedAccounts.length, changedReceipts: changed, monthCorrections, nopCorrections, financialSnapshots: finance.changes.length,
    remittanceExpectations: finance.slips.length, verifiedCorrections: records.length, auditedRecords: audits.length, receiptAmountsAndIdentityPreserved: true };
}
async function main() {
  if (process.argv.includes('--verify')) {
    const file = fs.readdirSync('backups').filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().at(-1);
    assert.ok(file);
    const snapshot = JSON.parse(fs.readFileSync(`backups/${file}`, 'utf8'));
    console.log(JSON.stringify(await db.begin('isolation level repeatable read read only', (tx) => verify(tx,snapshot))));
    return;
  }
  const plan = JSON.parse(fs.readFileSync('legacy-data/other-program-repair-plan-20261021.json', 'utf8'));
  assert.ok(plan.cases.length);
  await db.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read`;
    if (apply) await tx`lock table member_programs, collections, sales in share row exclusive mode`;
    const [{ started }] = await tx`select transaction_timestamp()::text as started`;
    const ids = plan.cases.map((c) => c.account.enrollment_id);
    const accounts = serial(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id for update`);
    const collections = serial(await tx`select *, or_date::text as day from collections where enrollment_id in ${tx(ids)} order by collection_id for update`);
    const cases = new Map(plan.cases.map((c) => [c.account.enrollment_id, c]));
    const collectionMap = new Map(collections.map((p) => [p.collection_id, p]));
    const grouped = new Map();
    for (const p of collections) grouped.set(p.enrollment_id, (grouped.get(p.enrollment_id) ?? 0) + 1);
    assert.equal(accounts.length, ids.length);
    const patches = [], nopIds = [], accountChangedIds = [];
    for (const a of accounts) {
      const c = cases.get(a.enrollment_id);
      for (const key of Object.keys(a)) if (key !== 'doi') assert.deepEqual(a[key], c.account[key]);
      assert.equal(a.doi.slice(0,10), c.account.day);
      assert.equal(grouped.get(a.enrollment_id), c.history.length);
      const proposed = new Map(c.proposed.map((p) => [p.id, p]));
      for (const old of c.history) {
        const row = collectionMap.get(old.collection_id), p = proposed.get(old.collection_id);
        assert.deepEqual(row, old);
        if (row.month_from !== p.monthFrom || row.month_to !== p.monthTo || row.nop_from !== p.nopFrom || row.nop_to !== p.nopTo) patches.push(p);
        if (row.nop_from !== p.nopFrom || row.nop_to !== p.nopTo) nopIds.push(p.id);
      }
      if (a.doi.slice(0,10) !== c.doi || a.account_status !== c.status) accountChangedIds.push(a.enrollment_id);
    }
    assert.equal(patches.length, plan.summary.changedReceipts);
    const snapshot = { plan, accounts, collections: collections.map((p) => omit(p,['day'])), nopIds, startedAt: started, accountChangedIds, collectionChangedIds: patches.map((p) => p.id) };
    fs.mkdirSync('backups', { recursive: true });
    const stamp = Date.now(), file = `backups/${apply ? prefix : 'other-program-source-preview-20261021-'}${stamp}.json`;
    fs.writeFileSync(file, JSON.stringify(snapshot));
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', accounts: accounts.length, receiptCorrections: patches.length, financeChecks: nopIds.length, privateBackupSaved: true }));
    await tx`select set_config('app.user_name', ${actor}, true)`;
    if (patches.length) await tx`update collections c set month_from = p."monthFrom", month_to = p."monthTo", nop_from = p."nopFrom", nop_to = p."nopTo"
      from jsonb_to_recordset(${JSON.stringify(patches)}::text::jsonb) as p(id text, "monthFrom" text, "monthTo" text, "nopFrom" integer, "nopTo" integer) where c.collection_id = p.id`;
    const accountPatches = plan.cases.filter((c) => accountChangedIds.includes(c.account.enrollment_id)).map((c) => ({ id: c.account.enrollment_id, doi: c.doi, status: c.status }));
    if (accountPatches.length) await tx`update member_programs a set doi = p.doi::date, account_status = p.status from jsonb_to_recordset(${JSON.stringify(accountPatches)}::text::jsonb) as p(id text, doi text, status text) where a.enrollment_id = p.id`;
    const finance = await repriceEntries((query, params) => tx.unsafe(query,params), { collectionIds: nopIds });
    const corrections = plan.cases.map((c) => ({ correction_id: `COR-OTH-20261021-${stamp}-${c.account.enrollment_id}`, module: actor, record_id: c.account.enrollment_id,
      reason: 'Owner requested scanning other programs for source-backed coverage/NOP/DOI errors and stale account statuses. Complete original receipt identities, amounts, source program and month/NOP spans confirmed; program registration and forfeiture rules checked. Prior corrections and owner overrides protected. Script-only processing; aggregate output.',
      before_json: { doi: c.account.day, status: c.account.account_status, history: c.history },
      after_json: { doi: c.doi, status: c.status, proposed: c.proposed, nextNop: c.nextNop, nextMonth: c.nextMonth, finance: finance.changes.filter((p) => c.proposed.some((r) => r.id === p.id)) },
      corrected_at: new Date().toISOString(), encoded_by_name: actor, encoded_at: new Date().toISOString() }));
    for (let i = 0; i < corrections.length; i += 250) await tx`insert into record_corrections ${tx(corrections.slice(i, i + 250))}`;
    snapshot.finance = finance; snapshot.correctionIds = corrections.map((c) => c.correction_id);
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const result = await verify(tx,snapshot);
    fs.writeFileSync('legacy-data/other-program-repair-result-20261021.json', JSON.stringify({ ...result, applied: apply, backup: file, summary: plan.summary, programCounts: plan.programCounts }, null, 2));
    console.log(JSON.stringify(result));
    if (!apply) throw new Rollback();
  });
  console.log('Committed.');
}
main().catch((error) => {
  if (error instanceof Rollback) { console.log('Preview verified; all writes rolled back.'); return; }
  fs.mkdirSync('backups', { recursive: true });
  fs.writeFileSync('backups/other-program-repair-error-private.json', JSON.stringify({ code: error.code, message: error.message, stack: error.stack }));
  console.error('Repair stopped; private diagnostic saved. No source/member records printed.'); process.exitCode = 1;
}).finally(async () => { await db.end(); });
