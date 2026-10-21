// Exact owner-confirmed receipt comparison, including duplicate markers. Aggregate-only output.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey} from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member='PH-53228425';
const expected=[{key:'5364M',orDate:'2026-01-18',amount:350,monthFrom:'2026-01',monthTo:'2026-01',nopFrom:6,nopTo:6,dateRemitted:'2026-01-19'},
{key:'5367M',orDate:'2026-01-24',amount:1750,monthFrom:'2026-02',monthTo:'2026-06',nopFrom:7,nopTo:11,dateRemitted:'2026-01-24'}];
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
async function main(){
 const rows=await db`select *,or_date::text as day,date_remitted::text as remitted_day from collections where member_number=${member}`;
 const checks=expected.map(e=>{
  const matches=rows.filter(r=>receiptKey(r.or_number).replace(/^0+(?=\d)/,'')===e.key);
  return{expected:e,matches,checks:{matchesOnMember:matches.length,duplicateMarked:matches.filter(r=>r.legacy_duplicate||/duplicated/i.test(r.or_number)).length,
   exactDate:matches.some(r=>r.day===e.orDate),exactAmount:matches.some(r=>Number(r.amount_collected)===e.amount),exactCoverage:matches.some(r=>r.month_from===e.monthFrom&&r.month_to===e.monthTo),
   exactNops:matches.some(r=>r.nop_from===e.nopFrom&&r.nop_to===e.nopTo),exactRemittedDate:matches.some(r=>r.remitted_day===e.dateRemitted)}};
 });
 fs.writeFileSync(`legacy-data/owner-receipts-${member}-private.json`,JSON.stringify({member,expected,rows,checks}));
 console.log(JSON.stringify({receiptChecks:checks.map(r=>r.checks),privateComparisonsSaved:true}));
}
main().catch(e=>{fs.writeFileSync('backups/owner-receipt-check-error-private.json',JSON.stringify({code:e.code,message:e.message}));console.error('Owner receipt check stopped; diagnostic saved privately.');process.exitCode=1;}).finally(async()=>{await db.end();});
