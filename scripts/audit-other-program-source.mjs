/** Other-program source audit. Outputs aggregate counts only; records stay in ignored private files. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
import { accountState, forfeitMonthsFor, todayInManila } from '../lib/account-rules.ts';
import { sourceDay, sourceCoverage, confirmedSequence, receiptKey, programKey } from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const file = 'legacy-data/other-program-source-index-20261021.json';
const serial = (v) => JSON.parse(JSON.stringify(v));
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (prefix, ref) => `${prefix}-LEG-${createHash('sha1').update(ref).digest('hex').slice(0, 10).toUpperCase()}`;
let db;
async function main() {
  let index;
  if (process.argv.includes('--cached')) index = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    index = { collections: {}, sales: {} };
    for (const source of await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx'])) for (const tab of source.tabs) {
      const isSale = /NS$/i.test(tab.title), isCollection = /COLL$/i.test(tab.title);
      if (!isSale && !isCollection) continue;
      const [headers, ...rows] = tab.rows, positions = new Map(headers.map((h, i) => [norm(h), i]));
      rows.forEach((row, i) => {
        const get = (key) => row[positions.get(key)], ref = `Data-Base-Old|${tab.title}|${tab.firstRow + i + 1}`;
        const data = { ref, or: receiptKey(get('ORNUMBER')), date: sourceDay(get('ORDATE')), amount: Number(String(get('AMOUNTCOLLECTED') ?? '').replace(/[^0-9.-]/g, '')), program: programKey(get('DAYONGPROGRAM')) };
        if (isCollection) index.collections[hash('COL', ref)] = { ...data, coverage: sourceCoverage(get('MONTHOF'), get('NOP')) };
        else index.sales[hash('SALE', ref)] = data;
      });
    }
    fs.writeFileSync(file, JSON.stringify(index));
  }
  console.log(JSON.stringify({ indexedReceipts: Object.keys(index.collections).length, indexedNewSales: Object.keys(index.sales).length }));
  db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
  await db.begin('isolation level repeatable read read only', async (tx) => {
    const accounts = serial(await tx`select a.*, a.doi::text as day, p.program_name as program, p.program_code, p.base_pay::float8 as rate,
      p.pay_balance_total::float8 as total, p.flexible, p.max_monthly_payment::float8 as maximum, p.registration_fee_required, p.category_id
      from member_programs a join programs p using (program_id) where p.program_name not ilike '%bracket%' order by a.enrollment_id`);
    const ids = accounts.map((a) => a.enrollment_id);
    if (!ids.length) throw new Error('NO_ACCOUNTS');
    const payments = serial(await tx`select *, or_date::text as day from collections where enrollment_id in ${tx(ids)} order by or_date, collection_id`);
    const sales = serial(await tx`select *, doi::text as day, or_date::text as receipt_day from sales where program_id in ${tx([...new Set(accounts.map((a) => a.program_id))])}`);
    const protectedIds = new Set();
    const protect = (v) => {
      if (typeof v === 'string' && /^(?:PH-\d{8}|ENR-[\w-]+|COL-[\w-]+)$/.test(v)) protectedIds.add(v);
      else if (v && typeof v === 'object') for (const child of Object.values(v)) protect(child);
    };
    for (const record of await tx`select record_id, before_json, after_json from record_corrections`) protect(record);
    for (const name of fs.readdirSync('config').filter((f) => f.endsWith('.json'))) protect(JSON.parse(fs.readFileSync(`config/${name}`, 'utf8').replace(/^\uFEFF/, '')));
    const mapped = new Set((await tx`select distinct collection_id from remittance_collections`).map((r) => r.collection_id));
    const grouped = new Map(), saleGroups = new Map();
    for (const p of payments) { const list = grouped.get(p.enrollment_id) ?? []; list.push(p); grouped.set(p.enrollment_id, list); }
    for (const s of sales) { const key = `${s.member_number}|${s.program_id}`, list = saleGroups.get(key) ?? []; list.push(s); saleGroups.set(key,list); }
    const cases = [], review = [], skipped = {}, programCounts = new Map();
    for (const a of accounts) {
      const history = grouped.get(a.enrollment_id) ?? [], ownSales = saleGroups.get(`${a.member_number}|${a.program_id}`) ?? [];
      const skip = (reason, details = {}) => { skipped[reason] = (skipped[reason] ?? 0) + 1; review.push({ account: a.enrollment_id, member: a.member_number, program: a.program_id, reason, ...details }); };
      if (!history.length) { skip('noCollections'); continue; }
      if (protectedIds.has(a.enrollment_id) || protectedIds.has(a.member_number) || history.some((p) => protectedIds.has(p.collection_id))) { skip('priorCorrectionOrOwnerOverride'); continue; }
      if (!sourceDay(a.day)) { skip('invalidEnrollmentDate'); continue; }
      const programKeys = new Set([programKey(a.program), programKey(a.program_code)]);
      let reason = '';
      const proposed = history.map((p) => {
        const s = index.collections[p.collection_id];
        if (!s || s.or !== receiptKey(p.or_number) || s.date !== p.day || s.amount !== Number(p.amount_collected) || !s.coverage || !programKeys.has(s.program)) reason ||= 'unconfirmedSourceReceipt';
        if (p.status !== 'Posted' || p.linked_remittance_id || mapped.has(p.collection_id) || p.program_id !== a.program_id || p.member_id !== a.member_id) reason ||= 'nonPostedLinkedOrMismatchedEntry';
        return { id: p.collection_id, ...s?.coverage, source: s?.ref };
      });
      let doi = a.day;
      if (ownSales.length === 1) {
        const sale = ownSales[0], s = index.sales[sale.sale_id];
        if (!s || s.date !== sale.day || sale.day !== sale.receipt_day || s.amount !== Number(sale.amount_paid) || s.or !== receiptKey(sale.or_number) || !programKeys.has(s.program)) reason ||= 'unconfirmedSourceNewSale';
        else if (a.day.slice(0, 7) === sale.day.slice(0, 7)) doi = sale.day;
        else reason ||= 'enrollmentMonthConflict';
      } else if (ownSales.length > 1) reason ||= 'multipleNewSales';
      if (!reason && !confirmedSequence({ doi, registrationFee: a.registration_fee_required }, proposed)) reason = 'sourceSequenceConflict';
      if (reason) { skip(reason); continue; }
      let state;
      try { state = accountState({ id: a.enrollment_id, doi, basePay: a.rate, payBalanceTotal: a.total || 0, storedStatus: a.account_status,
        flexible: a.flexible, maxMonthlyPayment: a.maximum, registrationFee: a.registration_fee_required, forfeitMonths: forfeitMonthsFor(a.category_id) },
        history.map((p, i) => ({ id: p.collection_id, enrollmentId: a.enrollment_id, orDate: p.day, orNumber: p.or_number,
          ...proposed[i], amount: Number(p.amount_collected) })), todayInManila()); }
      catch { skip('invalidProposedHistory'); continue; }
      const changed = proposed.filter((p, i) => p.monthFrom !== history[i].month_from || p.monthTo !== history[i].month_to || p.nopFrom !== history[i].nop_from || p.nopTo !== history[i].nop_to).length;
      if (!changed && doi === a.day && state.status === a.account_status) { skipped.alreadyCorrect = (skipped.alreadyCorrect ?? 0) + 1; continue; }
      const c = { account: a, history, sales: ownSales, proposed, doi, status: state.status, changed, nextNop: state.nextNop, nextMonth: state.nextMonth };
      cases.push(c);
      const stats = programCounts.get(a.program_id) ?? { program: a.program_id, accounts: 0, historyAccounts: 0, changedReceipts: 0, doiChanges: 0, statusOnlyAccounts: 0 };
      stats.accounts++; stats.historyAccounts += changed ? 1 : 0; stats.changedReceipts += changed; stats.doiChanges += doi !== a.day ? 1 : 0; stats.statusOnlyAccounts += !changed && doi === a.day ? 1 : 0;
      programCounts.set(a.program_id, stats);
    }
    const summary = { accounts: accounts.length, programs: new Set(accounts.map((a) => a.program_id)).size, receipts: payments.length, candidates: cases.length,
      historyAccounts: cases.filter((c) => c.changed).length, changedReceipts: cases.reduce((n, c) => n + c.changed, 0), doiChanges: cases.filter((c) => c.doi !== c.account.day).length,
      statusOnlyAccounts: cases.filter((c) => !c.changed && c.doi === c.account.day).length, skipped };
    fs.writeFileSync('legacy-data/other-program-repair-plan-20261021.json', JSON.stringify({ generatedAt: new Date().toISOString(), summary, programCounts: [...programCounts.values()], cases, review }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  });
}
main().catch((error) => {
  fs.mkdirSync('backups', { recursive: true });
  fs.writeFileSync('backups/other-program-audit-error-private.json', JSON.stringify({ code: error.code, message: error.message, stack: error.stack }));
  console.error('Audit failed; private diagnostic saved. No source/member records printed.'); process.exitCode = 1;
}).finally(async () => { if (db) await db.end(); });
