// Read-only investigation of the owner's five receipts; print record metadata only.
import nextEnv from '@next/env';
import postgres from 'postgres';
import {loadLegacySources} from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL, {max:1, connect_timeout:15, onnotice:()=>{}});
const receiptArg=process.argv.find(arg=>arg.startsWith('--receipts='))?.slice(11);
const keys=receiptArg ? receiptArg.split(',').map(v=>v.toUpperCase().replace(/[^A-Z0-9]/g,'')) : ['9918M','16667C','18751C','19293C','22770C'];
if(process.argv.includes('--legacy')) {
 const sources=await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
 for(const source of sources) for(const tab of source.tabs) {
  const [headers,...rows]=tab.rows;
  const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const orCol=headers.findIndex(v=>norm(v)==='ORNUMBER');
  if(orCol<0)continue;
  for(const [i,row] of rows.entries()) if([...keys,'24379C'].includes(norm(row[orCol]))) {
   const metadata=Object.fromEntries(headers.map((h,j)=>[String(h),row[j]]).filter(([h])=>/OR|NOP|MONTH|PROGRAM|AMOUNT|DOI|REMITTED|TIMESTAMP/i.test(h) && !/MARKETING|COLLECTOR/i.test(h)));
   console.log(JSON.stringify({source:tab.title,row:tab.firstRow+i+1,metadata}));
  }
 }
}
try { await db.begin('isolation level repeatable read read only', async tx => {
 const hits=await tx`select collection_id, member_id, member_number, enrollment_id, program_id, or_number, or_date::text, amount_collected::float8, nop_from,nop_to,month_from,month_to,status from collections where or_key in ${tx(keys)}`;
 console.log(JSON.stringify({hits},null,2));
 const ids=[...new Set(hits.map(r=>r.member_id))];
 if(!ids.length)return;
 console.log(JSON.stringify({finance:await tx`select collection_id,or_number,remittance_amount::float8,remittance_breakdown,forfeited_incentive::float8,linked_remittance_id from collections where member_id in ${tx(ids)}`,tiers:await tx`select incentive_id,role,from_month,to_month,branch_id,incentive_type,incentive_amount,mark_up from program_incentives where program_id='DP-0009'`},null,2));
 console.log(JSON.stringify({accounts:await tx`select mp.enrollment_id,mp.member_id,mp.member_number,mp.program_id,p.program_name,p.base_pay::float8,mp.doi::text,mp.status,mp.account_status,mp.branch,mp.mas_employee_id from member_programs mp left join programs p on p.program_id=mp.program_id where mp.member_id in ${tx(ids)}`,
 receipts:await tx`select collection_id,member_id,enrollment_id,program_id,or_number,or_date::text,amount_collected::float8,nop_from,nop_to,month_from,month_to,status from collections where member_id in ${tx(ids)} order by or_date,collection_id`,
 sales:await tx`select sale_id,member_number,program_id,application_no,or_number,or_date::text from sales where member_number in ${tx([...new Set(hits.map(r=>r.member_number))])}`},null,2));
 }); } finally {await db.end();}
