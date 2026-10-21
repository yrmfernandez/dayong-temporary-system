/** Apply reviewed source plan, preserving all other fields; preview rolls back. --verify reads latest applied backup. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { repriceEntries } from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const apply = process.argv.includes('--apply');
const serialize = (v) => JSON.parse(JSON.stringify(v));
const omit = (row, fields) => Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
const actor = 'Bracketing source history correction';
const prefix = 'bracketing-source-applied-20261021-';
class Rollback extends Error {}
async function verify(tx, snapshot) {
  const { plan, accounts, collections, finance } = snapshot;
  const ids = accounts.map((a) => a.enrollment_id);
  const savedAccounts = serialize(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id`);
  const savedCollections = serialize(await tx`select * from collections where enrollment_id in ${tx(ids)} order by collection_id`);
  assert.equal(savedAccounts.length, accounts.length);
  assert.equal(savedCollections.length, collections.length);
  const accountMap = new Map(accounts.map((a) => [a.enrollment_id, a]));
  const collectionMap = new Map(collections.map((c) => [c.collection_id, c]));
  const proposed = new Map(plan.cases.flatMap((c) => c.proposed.map((p) => [p.id, p])));
  const caseMap = new Map(plan.cases.map((c) => [c.account.enrollment_id, c]));
  let changed = 0;
  const nopIds = new Set(snapshot.nopIds);
  for (const row of savedCollections) {
    const original = collectionMap.get(row.collection_id), p = proposed.get(row.collection_id);
    assert.ok(original && p);
    const fields = ['month_from', 'month_to', 'nop_from', 'nop_to', ...(nopIds.has(row.collection_id) ? ['remittance_amount', 'remittance_breakdown', 'forfeited_incentive'] : [])];
    assert.deepEqual(omit(row, fields), omit(original, fields), `${row.collection_id}: unexpected receipt change`);
    assert.equal(row.month_from, p.month); assert.equal(row.month_to, p.month);
    assert.equal(row.nop_from, p.nop); assert.equal(row.nop_to, p.nop);
    if (['month_from','month_to','nop_from','nop_to'].some((key) => row[key] !== original[key])) changed++;
    const price = finance.changes.find((change) => change.id === row.collection_id);
    if (price) {
      assert.equal(Number(row.remittance_amount), price.after.remittance);
      assert.deepEqual(row.remittance_breakdown, price.after.breakdown);
      assert.equal(Number(row.forfeited_incentive), Number(price.after.forfeited));
    } else for (const key of ['remittance_amount','remittance_breakdown','forfeited_incentive']) assert.deepEqual(row[key], original[key]);
  }
  for (const row of savedAccounts) {
    const original = accountMap.get(row.enrollment_id), c = caseMap.get(row.enrollment_id);
    assert.deepEqual(omit(row, ['doi','account_status']), omit(original, ['doi','account_status']));
    assert.equal(row.doi.slice(0, 10), c.doi); assert.equal(row.account_status, c.status);
  }
  assert.equal(changed, plan.summary.changedReceipts);
  const records = await tx`select correction_id from record_corrections where correction_id in ${tx(snapshot.correctionIds)}`;
  assert.equal(records.length, plan.cases.length);
  const required = [...snapshot.accountChangedIds, ...snapshot.collectionChangedIds];
  const audits = await tx`select distinct record_id from audit_log where record_id in ${tx(required)} and user_name = ${actor} and logged_at >= ${snapshot.startedAt}`;
  assert.equal(audits.length, new Set(required).size, 'Audit coverage differs');
  return { accounts: savedAccounts.length, changedReceipts: changed, financialSnapshots: finance.changes.length, remittanceExpectations: finance.slips.length, verifiedCorrections: records.length, auditedRecords: audits.length };
}
try {
  if (process.argv.includes('--verify')) {
    const file = fs.readdirSync('backups').filter((f) => f.startsWith(prefix)).sort().at(-1);
    assert.ok(file, 'No applied snapshot.');
    const snapshot = JSON.parse(fs.readFileSync(`backups/${file}`, 'utf8'));
    console.log(JSON.stringify(await db.begin('isolation level repeatable read read only', (tx) => verify(tx, snapshot))));
  } else {
    const plan = JSON.parse(fs.readFileSync('legacy-data/bracketing-repair-plan-20261021.json', 'utf8'));
    assert.ok(plan.cases.length);
    await db.begin(async (tx) => {
      await tx`set transaction isolation level repeatable read`;
      if (apply) await tx`lock table member_programs, collections, sales in share row exclusive mode`;
      const [{ started }] = await tx`select transaction_timestamp()::text as started`;
      const ids = plan.cases.map((c) => c.account.enrollment_id);
      const accounts = serialize(await tx`select * from member_programs where enrollment_id in ${tx(ids)} order by enrollment_id for update`);
      const collections = serialize(await tx`select *, or_date::text as day from collections where enrollment_id in ${tx(ids)} order by collection_id for update`);
      assert.equal(accounts.length, ids.length);
      const collectionMap = new Map(collections.map((p) => [p.collection_id, p]));
      const patches = [], nopIds = [];
      for (const c of plan.cases) {
        const a = accounts.find((a) => a.enrollment_id === c.account.enrollment_id);
        for (const key of Object.keys(a)) if (key !== 'doi') assert.deepEqual(a[key], c.account[key], `${a.enrollment_id}: account changed since audit`);
        assert.equal(a.doi.slice(0,10), c.account.day);
        assert.equal(collections.filter((p) => p.enrollment_id === a.enrollment_id).length, c.history.length);
        for (const old of c.history) {
          const row = collectionMap.get(old.collection_id);
          assert.deepEqual(row, old, `${old.collection_id}: receipt changed since audit`);
          const p = c.proposed.find((p) => p.id === row.collection_id);
          if (row.month_from !== p.month || row.month_to !== p.month || row.nop_from !== p.nop || row.nop_to !== p.nop) patches.push(p);
          if (row.nop_from !== p.nop || row.nop_to !== p.nop) nopIds.push(p.id);
        }
      }
      assert.equal(patches.length, plan.summary.changedReceipts);
      const accountChangedIds = accounts.filter((a) => { const c = plan.cases.find((c) => c.account.enrollment_id === a.enrollment_id); return a.doi.slice(0,10) !== c.doi || a.account_status !== c.status; }).map((a) => a.enrollment_id);
      const rawCollections = collections.map((p) => omit(p, ['day']));
      const snapshot = { plan, accounts, collections: rawCollections, nopIds, startedAt: started, accountChangedIds, collectionChangedIds: patches.map((p) => p.id) };
      fs.mkdirSync('backups', { recursive: true });
      const stamp = Date.now();
      const file = `backups/${apply ? prefix : 'bracketing-source-preview-20261021-'}${stamp}.json`;
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
      console.log(`${apply ? 'APPLY' : 'PREVIEW'} ${plan.cases.length} accounts, ${patches.length} receipt corrections; backup ${file}`);
      await tx`select set_config('app.user_name', ${actor}, true)`;
      if (patches.length) await tx`update collections c set month_from = p.month, month_to = p.month, nop_from = p.nop, nop_to = p.nop
        from jsonb_to_recordset(${JSON.stringify(patches)}::text::jsonb) as p(id text, month text, nop integer) where c.collection_id = p.id`;
      const accountPatches = plan.cases.map((c) => ({ id: c.account.enrollment_id, doi: c.doi, status: c.status }));
      await tx`update member_programs a set doi = p.doi::date, account_status = p.status from jsonb_to_recordset(${JSON.stringify(accountPatches)}::text::jsonb) as p(id text, doi text, status text) where a.enrollment_id = p.id`;
      const finance = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: nopIds });
      const corrections = plan.cases.map((c) => ({ correction_id: `COR-BRK-20261021-${stamp}-${c.account.enrollment_id}`, module: actor, record_id: c.account.enrollment_id,
        reason: 'Owner requested finding and fixing cases like PH-02795415: complete original source receipts confirm the month/NOP history; New Sale date confirms DOI day where present. Preserve cash, receipt identity, member and program links; correct source-backed history and stale status.',
        before_json: { member: c.account.member_number, doi: c.account.day, status: c.account.account_status, history: c.history },
        after_json: { doi: c.doi, status: c.status, proposed: c.proposed, nextNop: c.nextNop, nextMonth: c.nextMonth, finance: finance.changes.filter((p) => c.proposed.some((r) => r.id === p.id)) },
        corrected_at: new Date().toISOString(), encoded_by_name: actor, encoded_at: new Date().toISOString() }));
      await tx`insert into record_corrections ${tx(corrections)}`;
      snapshot.finance = finance; snapshot.correctionIds = corrections.map((c) => c.correction_id);
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
      console.log(JSON.stringify(await verify(tx, snapshot)));
      if (!apply) throw new Rollback();
    });
    console.log('Committed.');
  }
} catch (error) { if (!(error instanceof Rollback)) throw error; console.log('Preview verified; all changes rolled back. Add --apply.'); }
finally { await db.end(); }
