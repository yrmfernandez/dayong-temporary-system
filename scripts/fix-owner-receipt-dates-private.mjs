// Owner-confirmed historical remittance dates only; preserves complete receipt fields and duplicate markers.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey} from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member='PH-53228425',apply=process.argv.includes('--apply'),actor='Owner-confirmed historical receipt dates';
const serial=v=>JSON.parse(JSON.stringify(v));
const omit=(r,fields)=>Object.fromEntries(Object.entries(r).filter(([key])=>!fields.includes(key)));
const file=`backups/owner-receipt-dates-${member}-applied-private.json`;
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
class Rollback extends Error{}
async function verify(tx,snapshot){
 const rows=serial(await tx`select * from collections where member_number=${member} order by collection_id`);
 assert.equal(rows.length,snapshot.before.length);
 for(const row of rows){
  const old=snapshot.before.find(r=>r.collection_id===row.collection_id),p=snapshot.patches.find(p=>p.id===row.collection_id);
  assert.deepEqual(omit(row,p?['date_remitted']:[]),omit(old,p?['date_remitted']:[]));
  if(p)assert.equal(row.date_remitted.slice(0,10),p.date);
 }
 const audits=await tx`select distinct record_id from audit_log where record_id in ${tx(snapshot.patches.map(p=>p.id))} and user_name=${actor} and logged_at>=${snapshot.started}`;
 const corrections=await tx`select correction_id from record_corrections where correction_id=${snapshot.correctionId}`;
 assert.equal(audits.length,snapshot.patches.length);assert.equal(corrections.length,1);
 return{receiptsVerified:rows.length,remittanceDatesCorrected:snapshot.patches.length,amountsCoverageNopsAndFinancialFieldsPreserved:true,auditedRecords:audits.length,correctionVerified:true};
}
async function main(){
 if(process.argv.includes('--verify')){console.log(JSON.stringify(await db.begin('isolation level repeatable read read only',tx=>verify(tx,JSON.parse(fs.readFileSync(file,'utf8'))))));return;}
 const plan=JSON.parse(fs.readFileSync(`legacy-data/owner-receipts-${member}-private.json`,'utf8'));
 await db.begin(async tx=>{
  await tx`set transaction isolation level serializable`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`member-source-repair:${member}`},0))`;
  await tx`select set_config('app.user_name',${actor},true)`;
  const [{started}]=await tx`select transaction_timestamp()::text as started`;
  const before=serial(await tx`select * from collections where member_number=${member} order by collection_id for update`);
  const patches=[];
  for(const e of plan.expected){
   const matches=before.filter(r=>receiptKey(r.or_number)===e.key);assert.equal(matches.length,1);
   const r=matches[0];
   assert.equal(r.or_date.slice(0,10),e.orDate);assert.equal(Number(r.amount_collected),e.amount);
   assert.equal(r.month_from,e.monthFrom);assert.equal(r.month_to,e.monthTo);assert.equal(r.nop_from,e.nopFrom);assert.equal(r.nop_to,e.nopTo);assert.ok(!r.linked_remittance_id);
   if(r.date_remitted?.slice(0,10)!==e.dateRemitted)patches.push({id:r.collection_id,date:e.dateRemitted});
  }
  assert.ok(patches.length>0);
  const links=await tx`select remittance_collection_id from remittance_collections where collection_id in ${tx(patches.map(p=>p.id))}`;assert.equal(links.length,0);
  const snapshot={member,before,patches,started,correctionId:`COR-HIST-${member}-${Date.now().toString(36).toUpperCase()}`};
  fs.writeFileSync(`backups/owner-receipt-dates-${member}-before-${Date.now()}-private.json`,JSON.stringify(snapshot));
  for(const p of patches)await tx`update collections set date_remitted=${p.date} where collection_id=${p.id}`;
  await tx`insert into record_corrections ${tx({correction_id:snapshot.correctionId,module:actor,record_id:member,
   reason:'Owner confirmed 5364 M: Jan18,2026 PHP350 January/NOP6, remitted Jan19; 5367 M: Jan24,2026 PHP1750 February-June/NOP7-11, remitted Jan24. Both receipts already exist on the requested member, including the legacy duplicate marker on 5367 M. Correct only their remittance dates; preserve all other fields.',
   before_json:before.filter(r=>patches.some(p=>p.id===r.collection_id)),after_json:patches,corrected_at:new Date().toISOString(),encoded_by_name:actor,encoded_at:new Date().toISOString()})}`;
  fs.writeFileSync(apply?file:`backups/owner-receipt-dates-${member}-preview-private.json`,JSON.stringify(snapshot));
  console.log(JSON.stringify({mode:apply?'apply':'preview',...await verify(tx,snapshot)}));
  if(!apply)throw new Rollback();
 });
 console.log('Committed.');
}
main().catch(e=>{if(e instanceof Rollback){console.log('Preview passed; all writes rolled back.');return;}fs.writeFileSync('backups/owner-receipt-dates-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack}));console.error('Correction stopped; diagnostic saved privately.');process.exitCode=1;}).finally(async()=>{await db.end();});
