/** Scoped read-only diagnostics: private member fields are neither selected nor printed. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {repriceEntries} from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
class Rollback extends Error{}
try{await db.begin(async tx=>{
  const staff=await tx`select employee_id,full_name from employees where full_name ilike '%PACIOS%' and full_name ilike '%CIARA%'`;
  if(staff.length!==1)throw new Error(`Expected one staff record; found ${staff.length}`);
  const id=staff[0].employee_id;
  const collections=await tx`select c.collection_id as id,c.or_number,c.program_id,p.program_name,c.amount_collected::float8 as amount,c.remittance_amount::float8 as share,c.forfeited_incentive::float8 as forfeited,c.nop_from,c.nop_to,c.collected_by_role,c.remittance_status,c.linked_remittance_id,c.remittance_breakdown,c.encoded_at,c.or_date::text,c.date_remitted::text,c.branch from collections c left join programs p on p.program_id=c.program_id where c.encoded_by_employee_id=${id} and (coalesce(c.encoded_at,c.created_at)::timestamptz at time zone 'Asia/Manila')::date='2026-10-16' and c.status='Posted' order by c.encoded_at,c.collection_id`;
  const sales=await tx`select s.sale_id as id,s.or_number,s.program_id,p.program_name,s.amount_paid::float8 as amount,s.remittance_amount::float8 as share,s.mas_incentive::float8 as mas_incentive,s.forfeited_incentive::float8 as forfeited,s.remittance_status,s.linked_remittance_id,s.encoded_at,s.or_date::text,s.date_remitted::text,s.branch from sales s left join programs p on p.program_id=s.program_id where s.encoded_by_employee_id=${id} and (coalesce(s.encoded_at,s.date_created)::timestamptz at time zone 'Asia/Manila')::date='2026-10-16' order by s.encoded_at,s.sale_id`;
  const total=rows=>({entries:rows.length,gross:rows.reduce((n,r)=>n+r.amount,0),incentives:rows.reduce((n,r)=>n+Math.max(0,r.amount-(r.share??r.amount)),0),net:rows.reduce((n,r)=>n+(r.share??r.amount),0),forfeited:rows.reduce((n,r)=>n+(r.forfeited??0),0)});
  const figures={staff:staff[0],date:'2026-10-16',collections:total(collections),sales:total(sales)};
  fs.writeFileSync('legacy-data/pacios-report-20261016.json',JSON.stringify({figures,collections,sales},null,2));
  console.log(JSON.stringify(figures,null,2));
  const quote=await repriceEntries((q,p)=>tx.unsafe(q,p),{collectionIds:collections.map(r=>r.id),saleIds:sales.map(r=>r.id)});
  const changes=quote.changes.map(r=>({id:r.id,kind:r.kind,program:r.programId,amount:r.amount,beforeShare:r.before.remittance,correctShare:r.after.remittance,beforeForfeited:r.before.forfeited,correctForfeited:r.after.forfeited}));
  console.log(JSON.stringify({changes,slips:quote.slips},null,2));
  fs.writeFileSync('legacy-data/pacios-report-reprice-preview-20261016.json',JSON.stringify(quote,null,2));
  throw new Rollback();
});}catch(error){if(!(error instanceof Rollback))throw error;console.log('Diagnostic transaction rolled back.');}finally{await db.end();}

