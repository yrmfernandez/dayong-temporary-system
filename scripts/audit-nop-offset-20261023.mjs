/** Read-only source audit for collection NOPs one below the source-confirmed sequence. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
import { sourceDay, receiptKey, programKey } from './source-history-rules.mjs';
import { monthIndex, accountState, forfeitMonthsFor } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const cacheFile = 'legacy-data/nop-offset-source-20261023-private.json';
const outputFile = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'legacy-data/nop-offset-plan-20261023-private.json';
const normalize = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let index;
if (process.argv.includes('--cached')) index = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
else {
  index = {};
  for (const workbook of await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx'])) for (const tab of workbook.tabs.filter(t => /COLL$/i.test(t.title))) {
    const [headers, ...rows] = tab.rows, positions = new Map(headers.map((h, i) => [normalize(h), i]));
    rows.forEach((row, i) => {
      const get = key => row[positions.get(key)];
      const ref = `Data-Base-Old|${tab.title}|${tab.firstRow + i + 1}`;
      const id = `COL-LEG-${createHash('sha1').update(ref).digest('hex').slice(0, 10).toUpperCase()}`;
      const text = String(get('NOP') ?? '').trim();
      const numbers = /^[\d\s,;&/-]+$/.test(text) ? text.match(/\d+/g)?.map(Number) ?? [] : [];
      const from = numbers[0], to = numbers.at(-1);
      const valid = numbers.length > 0 && from >= 1 && to >= from && (numbers.length <= 2 || numbers.every((n, j) => !j || n === numbers[j - 1] + 1));
      index[id] = { ref, or: receiptKey(get('ORNUMBER')), day: sourceDay(get('ORDATE')), amount: Number(String(get('AMOUNTCOLLECTED') ?? '').replace(/[^0-9.-]/g, '')), program: programKey(get('DAYONGPROGRAM')), from: valid ? from : null, to: valid ? to : null };
    });
  }
  fs.writeFileSync(cacheFile, JSON.stringify(index));
}
const aliases = new Map(Object.entries(JSON.parse(fs.readFileSync('config/legacy-programs.json', 'utf8')).aliases ?? {}).map(([k, v]) => [programKey(k), programKey(v)]));
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const serial = v => JSON.parse(JSON.stringify(v));
try {
  await db.begin('isolation level repeatable read read only', async tx => {
    const accounts = serial(await tx`select a.*,a.doi::text as day,p.program_name,p.program_code,p.base_pay::float8 as rate,p.pay_balance_total::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum,p.registration_fee_required,p.category_id from member_programs a join programs p using(program_id) order by enrollment_id`);
    const rows = serial(await tx`select *,or_date::text as day from collections order by enrollment_id,or_date,collection_id`);
    const correctionRows = await tx`select record_id from record_corrections`;
    const protectedIds = new Set(correctionRows.map(r => r.record_id));
    const protect = v => {
      if (!v || typeof v !== 'object') return;
      if (v.member && v.coverageStart) protectedIds.add(v.member);
      for (const child of Object.values(v)) if (child && typeof child === 'object') protect(child);
    };
    for (const name of fs.readdirSync('config').filter(f => f.endsWith('.json'))) protect(JSON.parse(fs.readFileSync(`config/${name}`, 'utf8').replace(/^\uFEFF/, '')));
    const mapped = new Set((await tx`select distinct collection_id from remittance_collections`).map(r => r.collection_id));
    const grouped = new Map();
    for (const row of rows) { const list = grouped.get(row.enrollment_id) ?? []; list.push(row); grouped.set(row.enrollment_id, list); }
    const skipped = {}, review = [], cases = [];
    let mismatchedAccounts = 0;
    for (const a of accounts) {
      const history = grouped.get(a.enrollment_id) ?? [];
      if (a.registration_fee_required || a.flexible || !history.length || !sourceDay(a.day)) continue;
      const proposed = history.map(p => {
        const validMonths = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month_from ?? '') && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month_to ?? '');
        const from = validMonths ? monthIndex(p.month_from) - monthIndex(a.day.slice(0, 7)) + 1 : NaN;
        return { id: p.collection_id, from, to: validMonths ? from + monthIndex(p.month_to) - monthIndex(p.month_from) : NaN };
      });
      const differences = proposed.map((p, i) => p.from - history[i].nop_from);
      if (!differences.some(n => n === 1) || differences.some(n => ![0, 1].includes(n)) || proposed.some((p, i) => p.to - history[i].nop_to !== differences[i])) continue;
      mismatchedAccounts++;
      const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; review.push({ account: a, reason, history, proposed }); };
      if (protectedIds.has(a.enrollment_id) || protectedIds.has(a.member_number) || history.some(p => protectedIds.has(p.collection_id))) { skip('priorCorrectionOrCoverageException'); continue; }
      if (history.length < 2) { skip('onlyOneReceipt'); continue; }
      const keys = new Set([programKey(a.program_name), programKey(a.program_code), programKey(a.program_id)]);
      let failure;
      for (let i = 0; i < history.length; i++) {
        const p = history[i], s = index[p.collection_id], patch = proposed[i];
        if (!s || s.or !== receiptKey(p.or_number) || s.day !== p.day || s.amount !== Number(p.amount_collected)) { failure = 'unconfirmedReceiptIdentity'; break; }
        if (!keys.has(aliases.get(s.program) ?? s.program)) { failure = 'sourceProgramDifference'; break; }
        if (s.from !== patch.from || s.to !== patch.to) { failure = 'sourceNopNotConfirmed'; break; }
        if (p.status !== 'Posted' || p.program_id !== a.program_id || p.member_id !== a.member_id) { failure = 'entryStatusOrOwnership'; break; }
        if (p.linked_remittance_id || mapped.has(p.collection_id)) { failure = 'remittanceLinked'; break; }
      }
      if (failure) { skip(failure); continue; }
      try {
        const state = accountState({ id: a.enrollment_id, doi: a.day, basePay: a.rate, payBalanceTotal: a.total || 0, storedStatus: a.account_status, flexible: a.flexible, maxMonthlyPayment: a.maximum, registrationFee: false, forfeitMonths: forfeitMonthsFor(a.category_id) }, history.map((p, i) => ({ id: p.collection_id, enrollmentId: a.enrollment_id, orDate: p.day, orNumber: p.or_number, amount: Number(p.amount_collected), monthFrom: p.month_from, monthTo: p.month_to, nopFrom: proposed[i].from, nopTo: proposed[i].to })), '2026-10-23');
        cases.push({ account: a, history, proposed, status: state.status, nextNop: state.nextNop, changed: differences.filter(n => n === 1).length, priced: history.filter(p => p.remittance_amount !== null || p.remittance_breakdown !== null || p.forfeited_incentive !== null).length });
      } catch { skip('invalidProposedHistory'); }
    }
    const summary = { scannedAccounts: accounts.length, scannedReceipts: rows.length, accountsWithOneLowNops: mismatchedAccounts, confirmedAccounts: cases.length, changedReceipts: cases.reduce((n, c) => n + c.changed, 0), pricedAccounts: cases.filter(c => c.priced).length, skipped };
    fs.writeFileSync(outputFile, JSON.stringify({ summary, cases, review }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  });
} finally { await db.end(); }
