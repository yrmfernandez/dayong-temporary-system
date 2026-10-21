/** Read-only complete-history audit of Bracketing against original receipt and New Sale rows. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
import { accountState, monthIndex, monthName, todayInManila } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const receipt = (v) => norm(String(v ?? '').replace(/\s*\((duplicated|to be checked)\)\s*$/i, ''));
const day = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : /^\d{4}-\d\d-\d\d/.test(String(v)) ? String(v).slice(0, 10) : '';
const hash = (prefix, ref) => `${prefix}-LEG-${createHash('sha1').update(ref).digest('hex').slice(0, 10).toUpperCase()}`;
const cache = 'legacy-data/bracketing-source-index-20261021.json';
let index;
if (process.argv.includes('--cached')) index = JSON.parse(fs.readFileSync(cache, 'utf8'));
else {
  index = { collections: {}, sales: {} };
  for (const source of await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx'])) for (const tab of source.tabs) {
    const isSale = /NS$/i.test(tab.title), isCollection = /COLL$/i.test(tab.title);
    if (!isSale && !isCollection) continue;
    const [header, ...rows] = tab.rows;
    const col = (key) => header.findIndex((v) => norm(v) === key);
    rows.forEach((row, i) => {
      const ref = `Data-Base-Old|${tab.title}|${tab.firstRow + i + 1}`;
      const get = (key) => row[col(key)];
      const data = { ref, or: receipt(get('ORNUMBER')), date: day(get('ORDATE')), amount: Number(String(get('AMOUNTCOLLECTED') ?? '').replace(/[^0-9.-]/g, '')), program: String(get('DAYONGPROGRAM') ?? '') };
      if (isCollection) {
        const monthText = String(get('MONTHOF') ?? '').trim();
        const number = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'].findIndex((m) => m === monthText.toUpperCase()) + 1;
        const nop = String(get('NOP') ?? '').trim();
        index.collections[hash('COL', ref)] = { ...data, month: number && data.date.startsWith('2026-') ? `2026-${String(number).padStart(2, '0')}` : '', nop: /^\d+$/.test(nop) ? Number(nop) : 0 };
      } else index.sales[hash('SALE', ref)] = data;
    });
  }
  fs.writeFileSync(cache, JSON.stringify(index));
}
console.log(`Indexed ${Object.keys(index.collections).length} source receipts and ${Object.keys(index.sales).length} New Sales.`);
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try { await db.begin('isolation level repeatable read read only', async (tx) => {
  const accounts = await tx`select a.*, a.doi::text as day, p.program_name as program, p.base_pay::float8 as rate, p.pay_balance_total::float8 as total, p.flexible, p.max_monthly_payment::float8 as maximum, p.registration_fee_required from member_programs a join programs p using (program_id) where p.program_name ilike '%bracket%' order by a.enrollment_id`;
  const ids = accounts.map((a) => a.enrollment_id);
  if (!ids.length) throw new Error('No Bracketing accounts.');
  const payments = await tx`select *, or_date::text as day from collections where enrollment_id in ${tx(ids)} order by or_date, collection_id`;
  const sales = await tx`select *, doi::text as day, or_date::text as receipt_day from sales where program_id in ${tx([...new Set(accounts.map((a) => a.program_id))])}`;
  const corrections = new Set((await tx`select record_id from record_corrections`).map((r) => r.record_id));
  const cases = [], review = [], counts = {};
  const skip = (reason) => { counts[reason] = (counts[reason] ?? 0) + 1; };
  for (const a of accounts) {
    const history = payments.filter((p) => p.enrollment_id === a.enrollment_id);
    if (!history.length) { skip('noCollections'); continue; }
    if (a.registration_fee_required || a.flexible) { skip('registrationOrFlexible'); continue; }
    if (corrections.has(a.enrollment_id) || corrections.has(a.member_number) || history.some((p) => corrections.has(p.collection_id))) { skip('previouslyReviewed'); continue; }
    let reason = '';
    const proposed = history.map((p) => {
      const s = index.collections[p.collection_id];
      if (!s || s.or !== receipt(p.or_number) || s.date !== p.day || s.amount !== Number(p.amount_collected) || !s.month || s.nop < 2 || p.status !== 'Posted' || p.linked_remittance_id || p.program_id !== a.program_id || p.member_id !== a.member_id) reason ||= 'unconfirmedReceipt';
      return { id: p.collection_id, month: s?.month, nop: s?.nop, source: s?.ref };
    });
    const ownSales = sales.filter((s) => s.member_number === a.member_number && s.program_id === a.program_id);
    let doi = a.day;
    if (ownSales.length === 1) {
      const sale = ownSales[0], s = index.sales[sale.sale_id];
      if (!s || s.date !== sale.day || sale.day !== sale.receipt_day || s.amount !== Number(sale.amount_paid) || s.or !== receipt(sale.or_number) || !/BRACKET|D.?300.*NEW/i.test(s.program)) reason ||= 'unconfirmedNewSale';
      else if (a.day.slice(0, 7) === sale.day.slice(0, 7)) doi = sale.day;
      else reason ||= 'enrollmentMonthConflict';
    } else if (ownSales.length > 1) reason ||= 'multipleNewSales';
    if (!reason && proposed.some((p, i) => monthIndex(p.month) !== monthIndex(doi.slice(0, 7)) + p.nop - 1 || (i && (p.nop !== proposed[i - 1].nop + 1 || monthIndex(p.month) !== monthIndex(proposed[i - 1].month) + 1)))) reason = 'sourceSequenceConflict';
    const changed = proposed.filter((p, i) => p.month && (p.month !== history[i].month_from || p.month !== history[i].month_to || p.nop !== history[i].nop_from || p.nop !== history[i].nop_to));
    if (reason) {
      skip(reason);
      review.push({ member: a.member_number, account: a.enrollment_id, program: a.program, reason, receipts: history.length, sourceDifferences: changed.length });
      continue;
    }
    let state;
    try { state = accountState({ id: a.enrollment_id, doi, basePay: a.rate, payBalanceTotal: a.total || 0, storedStatus: a.account_status, branch: '', mas: '' }, history.map((p, i) => ({ id: p.collection_id, enrollmentId: a.enrollment_id, orDate: p.day, orNumber: p.or_number, monthFrom: proposed[i].month, monthTo: proposed[i].month, nopFrom: proposed[i].nop, nopTo: proposed[i].nop, amount: Number(p.amount_collected) })), todayInManila()); }
    catch { skip('invalidProposedHistory'); continue; }
    if (!changed.length && doi === a.day && state.status === a.account_status) { skip('alreadyCorrect'); continue; }
    cases.push({ account: a, history, sales: ownSales, proposed, doi, status: state.status, changed: changed.length, nextNop: state.nextNop, nextMonth: state.nextMonth });
  }
  const plan = { generatedAt: new Date().toISOString(), summary: { accounts: accounts.length, receipts: payments.length, candidates: cases.length, changedReceipts: cases.reduce((n, c) => n + c.changed, 0), skipped: counts }, cases, review };
  fs.writeFileSync('legacy-data/bracketing-repair-plan-20261021.json', JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ summary: plan.summary, historyCorrections: cases.filter((c) => c.changed).map((c) => ({ member: c.account.member_number, receipts: c.history.length, changed: c.changed, doi: [c.account.day, c.doi], status: [c.account.account_status, c.status] })), reviewWithSourceDifferences: review.filter((r) => r.sourceDifferences).length }, null, 2));
}); } finally { await db.end(); }
