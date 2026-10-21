// Pure rules: the audit keeps source/member records in private files, not console output.
import { monthIndex, firstCollectionNop, saleNops } from '../lib/account-rules.ts';
import { crossYearMonths } from './source-cross-year-months.mjs';
export const programKey = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^D(?=\d)/, '');
export const receiptKey = (v) => String(v ?? '').replace(/\s*\((duplicated|to be checked)\)\s*$/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function sourceDay(v) {
  if (typeof v === 'number' && v > 10000) v = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  const value = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : '';
}
export function sourceMonths(monthText) {
  const known=crossYearMonths(monthText);
  if(known)return known;
  const match=/^\s*([A-Za-z]+)(?:\s+(20\d{2}))?\s*(?:-|–|to)\s*([A-Za-z]+)(?:\s+(20\d{2}))?\s*$/i.exec(String(monthText??''));
  if(!match)return null;
  const names=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const start=names.indexOf(match[1].slice(0,3).toUpperCase()),end=names.indexOf(match[3].slice(0,3).toUpperCase());
  const firstYear=Number(match[2]??match[4]??2026),lastYear=Number(match[4]??match[2]??2026);
  if(start<0||end<0||![2025,2026].includes(firstYear)||![2025,2026].includes(lastYear))return null;
  const from=firstYear*12+start,to=lastYear*12+end;
  if(to<from||to-from>23)return null;
  return Array.from({length:to-from+1},(_,i)=>{const value=from+i;return `${Math.floor(value/12)}-${String(value%12+1).padStart(2,'0')}`;});
}
export function sourceCoverage(monthText, nopText) {
  const months = sourceMonths(monthText);
  const match = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(String(nopText ?? ''));
  if (!months || !match) return null;
  const from = Number(match[1]), to = Number(match[2] ?? match[1]);
  return from >= 1 && to >= from && to - from + 1 === months.length ? { monthFrom: months[0], monthTo: months.at(-1), nopFrom: from, nopTo: to } : null;
}
export function confirmedSequence(account, proposed) {
  const doiMonth = String(account.doi ?? '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(doiMonth)) return false;
  const sorted = [...proposed].sort((a, b) => a.monthFrom.localeCompare(b.monthFrom) || a.nopFrom - b.nopFrom);
  return sorted.every((p, i) => p.nopFrom >= firstCollectionNop(account)
    && monthIndex(p.monthFrom) === monthIndex(doiMonth) + p.nopFrom - saleNops(account)
    && monthIndex(p.monthTo) - monthIndex(p.monthFrom) === p.nopTo - p.nopFrom
    && (!i || (p.nopFrom === sorted[i - 1].nopTo + 1 && monthIndex(p.monthFrom) === monthIndex(sorted[i - 1].monthTo) + 1)));
}
