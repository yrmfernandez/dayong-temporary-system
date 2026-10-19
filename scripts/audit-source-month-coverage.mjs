/** Read-only: find complete 2026 histories whose Month of differs from matching original source rows. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
import { accountState, todayInManila, monthIndex } from '../lib/account-rules.ts';
import { crossYearMonths } from './source-cross-year-months.mjs';
nextEnv.loadEnvConfig(process.cwd());
const priorYear = process.argv.includes('--prior-year');
const sourceSpans = process.argv.includes('--source-spans');
const aligned = priorYear || sourceSpans;
const sourceFile = 'legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx';
const sources = await loadLegacySources([sourceFile]);
const norm = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const receipt = v => norm(String(v ?? '').replace(/\s*\((duplicated|to be checked)\)\s*$/i, ''));
const monthWords = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function sourceMonths(value) {
  if (value instanceof Date) return value.getUTCFullYear() === 2026 ? [value.getUTCMonth()+1] : null;
  if (typeof value === 'number') {
    if (value < 10000) return null;
    return sourceMonths(new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)));
  }
  const text = String(value ?? '').toUpperCase();
  const years = text.match(/\b20\d{2}\b/g) ?? [];
  if (years.some(y => y !== '2026')) return null;
  const months = [...new Set((text.match(/[A-Z]+/g) ?? []).map(word => monthWords.indexOf(word.slice(0,3))+1).filter(n => n > 0))].sort((a,b) => a-b);
  return months.length && months.every((m,i) => !i || m === months[i-1]+1) ? months : null;
}
function date(value) {
  if (value instanceof Date) return value.toISOString().slice(0,10);
  if (typeof value === 'number') return new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)).toISOString().slice(0,10);
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0,10);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}` : '';
}
const sourceRows = new Map();
for (const source of sources) for (const tab of source.tabs.filter(t => /COLL$/i.test(t.title))) {
  const [header,...rows] = tab.rows;
  const col = key => header.findIndex(v => norm(v) === key);
  const fields = ['ORNUMBER','ORDATE','AMOUNTCOLLECTED','MONTHOF'];
  const columns = fields.map(col);
  if (columns.some(i => i < 0)) continue;
  rows.forEach((row,index) => {
    const ref = `Data-Base-Old|${tab.title}|${tab.firstRow+index+1}`;
    const id = `COL-LEG-${createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase()}`;
    const [or,orDate,amount,months] = columns.map(i => row[i]);
    sourceRows.set(id,{ ref, or:receipt(or), date:date(orDate), amount:Number(String(amount).replace(/[^0-9.-]/g,'')), months:sourceMonths(months), crossMonths:crossYearMonths(months), sourceNop:String(row[col('NOP')] ?? ''), sourceMonthText:String(months ?? '') });
  });
}
const db = postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
try { await db.begin('isolation level repeatable read read only', async tx => {
  const accounts = await tx`select a.enrollment_id as id,a.member_id as "memberId",m.member_number as "memberNumber",a.program_id as "programId",p.program_name as program,a.doi::text,a.account_status as "storedStatus",p.base_pay::float8 as "basePay",p.pay_balance_total::float8 as "payBalanceTotal",p.flexible,p.max_monthly_payment::float8 as "maxMonthlyPayment" from member_programs a join members m on m.member_id=a.member_id join programs p on p.program_id=a.program_id`;
  const payments = await tx`select collection_id as id,enrollment_id as "enrollmentId",or_number as "orNumber",or_date::text as "orDate",amount_collected::float8 as amount,month_from as "monthFrom",month_to as "monthTo",nop_from as "nopFrom",nop_to as "nopTo",date_remitted::text as "dateRemitted" from collections where status='Posted' order by or_date,collection_id`;
  const corrections = new Set((await tx`select distinct record_id from record_corrections`).map(r => r.record_id));
  const grouped = new Map();
  for (const p of payments) { const list = grouped.get(p.enrollmentId) ?? []; list.push(p); grouped.set(p.enrollmentId,list); }
  const candidates = [], skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0)+1; };
  for (const account of accounts) {
    const history = grouped.get(account.id) ?? [];
    if (history.length < 6) { skip('fewerThanSixReceipts'); continue; }
    if (aligned && accounts.filter(a => a.memberId === account.memberId).length !== 1) { skip('multipleAccounts'); continue; }
    if (corrections.has(account.id) || history.some(p => corrections.has(p.id))) { skip('previousCorrection'); continue; }
    const proposed = [];
    let failed = '';
    for (const p of history) {
      const s = sourceRows.get(p.id);
      if (!s || s.or !== receipt(p.orNumber) || s.date !== p.orDate || Math.round(s.amount*100) !== Math.round(p.amount*100)) { failed = 'sourceIdentityMismatch'; break; }
      const names = aligned ? s.crossMonths : s.months?.map(m => `2026-${String(m).padStart(2,'0')}`);
      if (!names || !p.orDate.startsWith('2026-') || (!aligned && names.length !== p.nopTo-p.nopFrom+1)) { failed = 'sourceSpanOrYearAmbiguous'; break; }
      const nopFrom = aligned ? monthIndex(names[0])-monthIndex(account.doi.slice(0,7))+1 : p.nopFrom;
      const nopTo = aligned ? nopFrom+names.length-1 : p.nopTo;
      proposed.push({...p,monthFrom:names[0],monthTo:names.at(-1),nopFrom,nopTo,sourceRef:s.ref,sourceMonthText:s.sourceMonthText,sourceNop:s.sourceNop});
    }
    if (failed) { skip(failed); continue; }
    if ((priorYear ? !proposed[0].monthFrom.startsWith('2025-') : proposed[0].monthFrom !== '2026-01') || proposed.some((p,i) => i && (monthIndex(p.monthFrom) !== monthIndex(proposed[i-1].monthTo)+1 || p.nopFrom !== proposed[i-1].nopTo+1))) { skip('notContinuousSourceHistory'); continue; }
    if (aligned) {
      const later = proposed.slice(1);
      const agrees = later.filter(p => {
        const nums = (p.sourceNop.match(/\d+/g) ?? []).map(Number);
        return nums.length && Math.min(...nums) === p.nopFrom && Math.max(...nums) === p.nopTo;
      });
      if (proposed[0].nopFrom < 2 || agrees.length < Math.ceil(later.length*0.8)) { skip('sourceNopDoesNotConfirmDoi'); continue; }
    }
    const changed = proposed.filter((p,i) => p.monthFrom !== history[i].monthFrom || p.monthTo !== history[i].monthTo || p.nopFrom !== history[i].nopFrom || p.nopTo !== history[i].nopTo);
    if (!changed.length) { skip('alreadyMatchesSource'); continue; }
    try {
      // Validate both histories independently. Only Month of/status is proposed; NOP/finance stays intact.
      accountState({...account,branch:'',mas:''},history,todayInManila());
      const state = accountState({...account,branch:'',mas:''},proposed,todayInManila());
      candidates.push({account,receipts:history,proposed,statusAfter:state.status,changedReceipts:changed.length,total:history.reduce((sum,p) => sum+p.amount,0)});
    } catch { skip('invalidHistory'); }
  }
  const report = {generatedAt:new Date().toISOString(),sourceFile,summary:{accounts:accounts.length,receipts:payments.length,indexedSourceRows:sourceRows.size,candidates:candidates.length,changedReceipts:candidates.reduce((sum,c) => sum+c.changedReceipts,0),skipped},cases:candidates};
  fs.writeFileSync(priorYear ? 'legacy-data/source-cross-year-review-20261019.json' : sourceSpans ? 'legacy-data/source-span-review-20261019.json' : 'legacy-data/source-month-review-20261019.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({summary:report.summary,first:candidates.slice(0,12).map(c => ({member:c.account.memberNumber,program:c.account.program,receipts:c.receipts.length,changed:c.changedReceipts,stored:[c.receipts[0].monthFrom,c.receipts.at(-1).monthTo],source:[c.proposed[0].monthFrom,c.proposed.at(-1).monthTo],status:[c.account.storedStatus,c.statusAfter]}))},null,2));
}); } finally { await db.end(); }
