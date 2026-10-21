/** Scoped, source-verified account correction. --config=<file>; preview rolls back; --apply writes. */
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState, monthIndex, monthName, todayInManila } from '../lib/account-rules.ts';
import { repriceEntries } from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const configFile = process.argv.find((arg) => arg.startsWith('--config='))?.slice(9);
if (!configFile) throw new Error('Pass --config=<file>.');
const item = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const sources = JSON.parse(fs.readFileSync(item.sourceFile, 'utf8'));
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
class Rollback extends Error {}
try {
  await sql.begin(async (tx) => {
    await tx`lock table member_programs, collections, sales in share row exclusive mode`;
    const [account] = await tx`select mp.*, mp.doi::text as day, p.base_pay::float8 as rate, p.pay_balance_total::float8 as total,
      p.flexible, p.max_monthly_payment::float8 as maximum, p.registration_fee_required
      from member_programs mp join programs p using (program_id) where enrollment_id = ${item.account} for update of mp`;
    const before = await tx`select *, or_date::text as day from collections where member_number = ${item.member} order by collection_id`;
    const allAccounts = await tx`select * from member_programs where member_number = ${item.member} order by enrollment_id`;
    const allSales = await tx`select * from sales where member_number = ${item.member} order by sale_id`;
    const sale = allSales.find((s) => s.sale_id === item.sale && s.program_id === item.program);
    const day = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
    if (!account || account.member_number !== item.member || account.program_id !== item.program || ![item.expectedDoi, item.doi].includes(account.day) || !sale || day(sale.doi) !== item.doi || day(sale.or_date) !== item.doi) throw new Error('Account/DOI/New Sale differs from reviewed config.');
    const payments = before.filter((p) => p.enrollment_id === item.account).sort((a, b) => a.day.localeCompare(b.day) || a.collection_id.localeCompare(b.collection_id));
    if (payments.length !== item.receiptCount) throw new Error('Receipt count differs.');
    fs.mkdirSync('backups', { recursive: true });
    const backup = `backups/account-source-${item.member}-${Date.now()}.json`;
    fs.writeFileSync(backup, JSON.stringify({ account, accounts: allAccounts, collections: before, sales: allSales }, null, 2));
    console.log(`Backup ${backup}`);
    await tx`select set_config('app.user_name', 'Source history correction', true)`;
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i], source = sources.find((r) => r.id === payment.collection_id);
      const nop = item.startNop + i, month = monthName(monthIndex(item.doi.slice(0, 7)) + nop - 1);
      const sourceMonth = new Date(`${month}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      if (!source || Number(source.source.NOP) !== nop || source.source['MONTH OF'].toLowerCase() !== sourceMonth.toLowerCase()
        || Number(source.source['AMOUNT COLLECTED']) !== item.amount || Number(payment.amount_collected) !== item.amount
        || day(source.source['OR DATE']) !== payment.day) throw new Error(`${payment.collection_id}: source differs.`);
      await tx`update collections set nop_from = ${nop}, nop_to = ${nop}, month_from = ${month}, month_to = ${month} where collection_id = ${payment.collection_id}`;
      console.log(`${payment.collection_id}: ${payment.month_from}/NOP${payment.nop_from} -> ${month}/NOP${nop}`);
    }
    const corrected = await tx`select *, or_date::text as day from collections where enrollment_id = ${item.account} order by collection_id`;
    const state = accountState({ id: item.account, memberId: account.member_id, memberNumber: item.member, programId: item.program, doi: item.doi,
      branch: account.branch, mas: account.mas, basePay: account.rate, payBalanceTotal: account.total || 0, storedStatus: account.account_status,
      flexible: account.flexible, maxMonthlyPayment: account.maximum, registrationFee: account.registration_fee_required },
      corrected.map((p) => ({ id: p.collection_id, enrollmentId: p.enrollment_id, orDate: p.day, orNumber: p.or_number, monthFrom: p.month_from, monthTo: p.month_to, nopFrom: p.nop_from, nopTo: p.nop_to, amount: Number(p.amount_collected), dateRemitted: '', mas: p.mas })), todayInManila());
    await tx`update member_programs set doi = ${item.doi}, account_status = ${state.status} where enrollment_id = ${item.account}`;
    const finance = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: payments.map((p) => p.collection_id), saleIds: [item.sale] });
    const saved = await tx`select *, or_date::text as day from collections where member_number = ${item.member} order by collection_id`;
    const savedAccounts = await tx`select * from member_programs where member_number = ${item.member} order by enrollment_id`;
    const savedSales = await tx`select * from sales where member_number = ${item.member} order by sale_id`;
    const verify = (oldRows, newRows, idKey, mutable) => {
      if (oldRows.length !== newRows.length) throw new Error('Record count changed.');
      for (const original of oldRows) {
        const current = newRows.find((r) => r[idKey] === original[idKey]);
        for (const field of Object.keys(original)) if (!mutable(original).includes(field) && !isDeepStrictEqual(original[field], current?.[field])) throw new Error(`${original[idKey]}: unexpected change to ${field}.`);
      }
    };
    verify(before, saved, 'collection_id', (r) => r.enrollment_id === item.account ? ['nop_from', 'nop_to', 'month_from', 'month_to', 'remittance_amount', 'remittance_breakdown', 'forfeited_incentive'] : []);
    verify(allAccounts, savedAccounts, 'enrollment_id', (r) => r.enrollment_id === item.account ? ['doi', 'account_status'] : []);
    verify(allSales, savedSales, 'sale_id', (r) => r.sale_id === item.sale ? ['remittance_amount', 'mas_incentive', 'forfeited_incentive'] : []);
    const correctionId = `COR-SRC-${item.member}-${Date.now().toString(36).toUpperCase()}`;
    await tx`insert into record_corrections ${tx({ correction_id: correctionId, module: 'Source history correction', record_id: item.member, reason: item.note,
      before_json: { doi: account.day, status: account.account_status, payments }, after_json: { doi: item.doi, status: state.status, nextNop: state.nextNop, nextMonth: state.nextMonth, finance },
      corrected_at: new Date().toISOString(), encoded_by_name: 'Source history correction', encoded_at: new Date().toISOString() })}`;
    console.log(`DOI ${account.day} -> ${item.doi}; ${account.account_status} -> ${state.status}; next ${state.nextMonth} NOP${state.nextNop}. ${finance.changes.length} financial snapshots recalculated, ${finance.slips.length} remittance expectations changed. ${correctionId}`);
    if (!apply) throw new Rollback();
  });
  console.log('Applied and verified.');
} catch (error) { if (!(error instanceof Rollback)) throw error; console.log('Preview verified; rolled back. Add --apply.'); }
finally { await sql.end(); }
