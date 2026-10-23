/** Source-confirmed NOP repair. Preview rolls back; --apply commits; --verify reads back. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, forfeitMonthsFor, monthIndex, saleNops } from '../lib/account-rules.ts';
import { receiptKey } from './source-history-rules.mjs';

nextEnv.loadEnvConfig(process.cwd());
const member = 'PH-13437031', enrollment = 'ENR-LEG-73BD9C2D74';
const actor = 'Source-confirmed NOP correction PH-13437031';
const apply = process.argv.includes('--apply'), verifyOnly = process.argv.includes('--verify');
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const sources = JSON.parse(fs.readFileSync(`legacy-data/member-source-${member}-private.json`, 'utf8'));
const norm = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const serial = value => JSON.parse(JSON.stringify(value));
const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
class Rollback extends Error {}
try {
  await db.begin(async tx => {
    if (verifyOnly) await tx`set transaction read only`;
    const accounts = await tx`select a.*,a.doi::text as day,p.base_pay::float8 as rate,p.pay_balance_total::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum,p.registration_fee_required,p.category_id from member_programs a join programs p using(program_id) where a.member_number=${member} order by enrollment_id`;
    const account = accounts.find(a => a.enrollment_id === enrollment);
    assert.ok(account && !account.registration_fee_required && !account.flexible, 'Account rules differ.');
    if (!verifyOnly) await tx`select enrollment_id from member_programs where enrollment_id=${enrollment} for update`;
    const rows = verifyOnly
      ? await tx`select *,or_date::text as day from collections where enrollment_id=${enrollment} order by collection_id`
      : await tx`select *,or_date::text as day from collections where enrollment_id=${enrollment} order by collection_id for update`;
    assert.equal(rows.length, 6);
    const patches = rows.map(row => {
      const source = sources.find(s => s.id === row.collection_id);
      assert.ok(source, 'Source missing.');
      const positions = new Map(source.headers.map((h, i) => [norm(h), i]));
      const get = key => source.row[positions.get(key)];
      assert.equal(receiptKey(get('ORNUMBER')), receiptKey(row.or_number));
      assert.equal(Number(get('AMOUNTCOLLECTED')), Number(row.amount_collected));
      assert.equal(String(get('ORDATE')).slice(0, 10), row.day);
      assert.equal(row.member_number, member);
      assert.equal(row.member_id, account.member_id);
      assert.equal(row.program_id, account.program_id);
      assert.equal(row.status, 'Posted');
      // These imported receipts have no financial snapshots or remittance links.
      // NOP-only correction must not create financial history for them.
      for (const key of ['remittance_amount', 'remittance_breakdown', 'forfeited_incentive', 'linked_remittance_id']) assert.equal(row[key], null);
      const from = monthIndex(row.month_from) - monthIndex(account.day.slice(0, 7)) + saleNops({ registrationFee: account.registration_fee_required });
      const to = from + monthIndex(row.month_to) - monthIndex(row.month_from);
      assert.equal(source.nopNumbers[0], from);
      assert.equal(source.nopNumbers.at(-1), to);
      return { id: row.collection_id, from, to };
    });
    assert.equal((await tx`select 1 from remittance_collections where collection_id in ${tx(rows.map(r => r.collection_id))}`).length, 0);
    const state = accountState({ id: enrollment, doi: account.day, basePay: account.rate, payBalanceTotal: account.total || 0, storedStatus: account.account_status, flexible: account.flexible, maxMonthlyPayment: account.maximum, registrationFee: account.registration_fee_required, forfeitMonths: forfeitMonthsFor(account.category_id) }, rows.map((row, i) => ({ id: row.collection_id, enrollmentId: enrollment, orDate: row.day, orNumber: row.or_number, amount: Number(row.amount_collected), monthFrom: row.month_from, monthTo: row.month_to, nopFrom: patches[i].from, nopTo: patches[i].to })), '2026-10-23');
    const changed = patches.filter((p, i) => p.from !== rows[i].nop_from || p.to !== rows[i].nop_to);
    if (verifyOnly) {
      assert.equal(changed.length, 0);
      assert.equal(account.account_status, state.status);
      assert.equal((await tx`select 1 from record_corrections where record_id=${enrollment} and encoded_by_name=${actor}`).length, 1);
      console.log(JSON.stringify({ verified: true, receipts: rows.length, nopRange: [2, 8], statusVerified: true }));
      return;
    }
    const snapshot = { accounts, rows, patches, state };
    fs.mkdirSync('backups', { recursive: true });
    fs.writeFileSync(`backups/nop-${member}-${apply ? 'apply' : 'preview'}-${Date.now()}.json`, JSON.stringify(snapshot));
    if (!changed.length && account.account_status === state.status) { console.log('Already correct.'); return; }
    await tx`select set_config('app.user_name',${actor},true)`;
    for (const patch of changed) await tx`update collections set nop_from=${patch.from},nop_to=${patch.to} where collection_id=${patch.id}`;
    await tx`update member_programs set account_status=${state.status} where enrollment_id=${enrollment}`;
    const saved = await tx`select *,or_date::text as day from collections where enrollment_id=${enrollment} order by collection_id`;
    assert.equal(saved.length, rows.length);
    for (let i = 0; i < rows.length; i++) {
      assert.ok(isDeepStrictEqual(omit(saved[i], ['nop_from', 'nop_to']), omit(rows[i], ['nop_from', 'nop_to'])));
      assert.equal(saved[i].nop_from, patches[i].from); assert.equal(saved[i].nop_to, patches[i].to);
    }
    const savedAccounts = await tx`select * from member_programs where member_number=${member} order by enrollment_id`;
    for (const original of accounts) {
      const current = savedAccounts.find(a => a.enrollment_id === original.enrollment_id);
      const before = omit(original, ['day', 'rate', 'total', 'flexible', 'maximum', 'registration_fee_required', 'category_id']);
      assert.deepEqual(serial(omit(current, ['account_status'])), serial(omit(before, ['account_status'])));
    }
    const stamp = new Date().toISOString();
    await tx`insert into record_corrections ${tx({ correction_id: `COR-NOP-${member}-${Date.now()}`, module: 'Source NOP correction', record_id: enrollment, reason: 'Owner requested NOP repair October 23, 2026. All six original source receipts confirm NOP 2–8: the New Sale counts as NOP 1. Preserve covered months, DOI, receipt dates, amounts, ownership and unpriced/unlinked imported financial fields. Refresh account status.', before_json: { account, rows }, after_json: { patches, status: state.status, nextNop: state.nextNop }, corrected_at: stamp, encoded_at: stamp, encoded_by_name: actor })}`;
    const audits = await tx`select distinct record_id from audit_log where table_name='collections' and record_id in ${tx(changed.map(p => p.id))} and user_name=${actor}`;
    assert.equal(audits.length, changed.length);
    console.log(JSON.stringify({ changedReceipts: changed.length, nopRange: [2, 8], statusRefreshed: true, otherReceiptFieldsPreserved: true, auditVerified: true, apply }));
    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (error instanceof Rollback) console.log('Preview verified; rolled back.');
  else { fs.writeFileSync(`backups/nop-${member}-error-private.json`, JSON.stringify({ message: error.message, stack: error.stack })); console.error('Repair stopped; private diagnostic saved.'); process.exitCode = 1; }
} finally { await db.end(); }
