/** Guarded source NOP sweep; --plan=file; preview by default; --apply; --verify=file. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, forfeitMonthsFor } from '../lib/account-rules.ts';
import { repriceEntries } from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const verifyFile = process.argv.find(arg => arg.startsWith('--verify='))?.slice(9);
const planFile = process.argv.find(arg => arg.startsWith('--plan='))?.slice(7) ?? 'legacy-data/nop-offset-plan-20261023-private.json';
const actor = 'Source-confirmed NOP offset sweep October 23 2026';
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const serial = value => JSON.parse(JSON.stringify(value));
const omit = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const derived = ['day', 'program_name', 'program_code', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id'];
class Rollback extends Error {}
async function verify(tx, snapshot) {
  let receipts = 0, financialSnapshots = 0;
  for (const c of snapshot.applied) {
    const current = serial(await tx`select * from collections where enrollment_id=${c.account.enrollment_id} order by or_date,collection_id`);
    assert.equal(current.length, c.history.length);
    for (const old of c.history) {
      const saved = current.find(row => row.collection_id === old.collection_id);
      const price = c.finance.changes.find(p => p.id === old.collection_id);
      const allowed = ['nop_from', 'nop_to', ...(price ? ['remittance_amount', 'remittance_breakdown', 'forfeited_incentive'] : [])];
      assert.deepEqual(omit(saved, allowed), omit(omit(old, ['day']), allowed));
      const p = c.proposed.find(p => p.id === old.collection_id);
      assert.equal(saved.nop_from, p.from); assert.equal(saved.nop_to, p.to);
      if (price) {
        assert.equal(Number(saved.remittance_amount), price.after.remittance);
        assert.deepEqual(saved.remittance_breakdown, price.after.breakdown);
        assert.equal(Number(saved.forfeited_incentive), Number(price.after.forfeited));
        financialSnapshots++;
      }
    }
    const [account] = serial(await tx`select * from member_programs where enrollment_id=${c.account.enrollment_id}`);
    assert.deepEqual(omit(account, ['account_status']), omit(c.account, [...derived, 'account_status']));
    assert.equal(account.account_status, c.status);
    assert.equal((await tx`select 1 from record_corrections where correction_id=${c.correctionId}`).length, 1);
    const changedIds = c.proposed.filter((p, i) => p.from !== c.history[i].nop_from || p.to !== c.history[i].nop_to).map(p => p.id);
    const audits = await tx`select distinct record_id from audit_log where table_name='collections' and record_id in ${tx(changedIds)} and user_name=${actor} and logged_at>=${snapshot.startedAt}::timestamptz`;
    assert.equal(audits.length, changedIds.length);
    receipts += changedIds.length;
  }
  return { accounts: snapshot.applied.length, correctedCollections: receipts, financialSnapshots, cashAmountsAndCoveredMonthsPreserved: true, auditAndCorrectionsVerified: true };
}
try {
  if (verifyFile) {
    const snapshot = JSON.parse(fs.readFileSync(verifyFile, 'utf8'));
    console.log(JSON.stringify(await db.begin('isolation level repeatable read read only', tx => verify(tx, snapshot))));
  } else {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const snapshot = { planFile, applied: [], skipped: [] };
    const backup = `backups/nop-offset-sweep-20261023-${apply ? 'apply' : 'preview'}-${Date.now()}.json`;
    fs.mkdirSync('backups', { recursive: true });
    await db.begin(async tx => {
      await tx`set transaction isolation level repeatable read`;
      const [{ stamp }] = await tx`select transaction_timestamp()::text as stamp`;
      snapshot.startedAt = stamp;
      await tx`select set_config('app.user_name', ${actor}, true)`;
      for (const c of plan.cases) {
        try {
          const result = await tx.savepoint(async sp => {
            const [currentAccount] = serial(await sp`select * from member_programs where enrollment_id=${c.account.enrollment_id} for update`);
            assert.deepEqual(currentAccount, omit(c.account, derived), 'Account changed since review');
            const currentRows = serial(await sp`select *,or_date::text as day from collections where enrollment_id=${c.account.enrollment_id} order by or_date,collection_id for update`);
            assert.deepEqual(currentRows, c.history, 'History changed since review');
            const ids = c.history.map(p => p.collection_id);
            assert.equal((await sp`select 1 from remittance_collections where collection_id in ${sp(ids)} limit 1`).length, 0);
            assert.equal((await sp`select 1 from record_corrections where record_id in ${sp([c.account.enrollment_id, c.account.member_number, ...ids])} limit 1`).length, 0);
            const state = accountState({ id: c.account.enrollment_id, doi: c.account.day, basePay: c.account.rate, payBalanceTotal: c.account.total || 0, storedStatus: c.account.account_status, flexible: c.account.flexible, maxMonthlyPayment: c.account.maximum, registrationFee: false, forfeitMonths: forfeitMonthsFor(c.account.category_id) }, c.history.map((p, i) => ({ id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.day, orNumber: p.or_number, amount: Number(p.amount_collected), monthFrom: p.month_from, monthTo: p.month_to, nopFrom: c.proposed[i].from, nopTo: c.proposed[i].to })), '2026-10-23');
            assert.equal(state.status, c.status);
            const changes = c.proposed.filter((p, i) => p.from !== c.history[i].nop_from || p.to !== c.history[i].nop_to);
            for (const p of changes) await sp`update collections set nop_from=${p.from},nop_to=${p.to} where collection_id=${p.id}`;
            const pricedIds = changes.filter(p => {
              const original = c.history.find(r => r.collection_id === p.id);
              return original.remittance_amount !== null || original.remittance_breakdown !== null || original.forfeited_incentive !== null;
            }).map(p => p.id);
            const finance = pricedIds.length ? await repriceEntries((q, params) => sp.unsafe(q, params), { collectionIds: pricedIds }) : { changes: [], slips: [], companyShareChange: 0 };
            assert.equal(finance.slips.length, 0);
            await sp`update member_programs set account_status=${state.status} where enrollment_id=${c.account.enrollment_id} and account_status is distinct from ${state.status}`;
            const correctionId = `COR-NOP-SWEEP-20261023-${Date.now()}-${c.account.enrollment_id}`;
            const stamp = new Date().toISOString();
            await sp`insert into record_corrections ${sp({ correction_id: correctionId, module: 'Source NOP offset correction', record_id: c.account.enrollment_id, reason: 'Owner requested fixes similar to PH-13437031. Complete original source receipts independently confirm collection NOPs one higher than saved; New Sale already counts as NOP 1. Preserve covered months, DOI, gross payments, receipt identities and actual cash; refresh account status and existing unlinked financial snapshots only. Do not invent financial figures for unpriced imports.', before_json: { account: c.account, history: c.history }, after_json: { proposed: c.proposed, status: c.status, finance }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
            return { ...c, finance, correctionId };
          });
          snapshot.applied.push(result);
        } catch (error) {
          snapshot.skipped.push({ account: c.account.enrollment_id, reason: error.message, code: error.code, stack: error.stack });
        }
      }
      fs.writeFileSync(backup, JSON.stringify(snapshot, null, 2));
      const summary = await verify(tx, snapshot);
      const financialDelta = Math.round(snapshot.applied.reduce((n, c) => n + Number(c.finance.companyShareChange || 0), 0) * 100) / 100;
      console.log(JSON.stringify({ ...summary, companyShareChange: financialDelta, skippedAccounts: snapshot.skipped.length, apply, backup }));
      if (!apply) throw new Rollback();
    });
  }
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; all changes rolled back.');
  else { fs.writeFileSync('backups/nop-offset-sweep-error-private.json', JSON.stringify({ message: error.message, stack: error.stack })); console.error('Sweep stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await db.end(); }
