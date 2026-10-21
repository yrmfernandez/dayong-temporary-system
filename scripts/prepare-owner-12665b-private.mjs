// Owner-supplied history; keep comparisons private and display counts only.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {receiptKey} from './source-history-rules.mjs';
import {accountState,forfeitMonthsFor,todayInManila} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
const serial=v=>JSON.parse(JSON.stringify(v));
const expected=[
 ['4984M','2026-01-21',320,'2025-12',15,'2026-01-21'],
 ['6239M','2026-02-22',320,'2026-01',16,'2026-02-23'],
 ['8302M','2026-03-21',320,'2026-02',17,'2026-03-23'],
 ['3774B','2026-04-21',320,'2026-03',18,'2026-04-21'],
 ['6038B','2026-05-20',320,'2026-04',19,'2026-05-21'],
 ['9314B','2026-06-20',320,'2026-05',20,'2026-06-20'],
 ['10396B','2026-07-21',320,'2026-06',21,'2026-07-22'],
 ['12665B','2026-08-20',350,'2026-07',22,'2026-08-20'],
 ['14589B','2026-09-21',320,'2026-08',23,'2026-09-22']
].map(([key,orDate,amount,month,nop,dateRemitted])=>({key,orDate,amount,monthFrom:month,monthTo:month,nopFrom:nop,nopTo:nop,dateRemitted}));
try{
 const file='legacy-data/receipt-12665B-import-plan-private.json';
 const p=JSON.parse(fs.readFileSync(file,'utf8'));
 await db.begin('isolation level repeatable read read only',async tx=>{
  const history=serial(await tx`select *,or_date::text as day from collections where member_number='PH-77690372' order by or_date,collection_id`);
  const [freshAccount]=serial(await tx`select a.*,a.doi::text as day,p.base_pay::float8 as rate,p.pay_balance_total::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum,p.registration_fee_required,p.category_id from member_programs a join programs p using(program_id) where a.enrollment_id=${p.account.enrollment_id}`);
  p.account=freshAccount;
  const existingPatches=[];
  for(const r of history){
   const e=expected.find(e=>e.key===receiptKey(r.or_number));if(!e)continue;
   assert.equal(r.day,e.orDate);assert.equal(Number(r.amount_collected),e.amount);
   assert.equal(r.enrollment_id,p.account.enrollment_id);assert.ok(!r.linked_remittance_id);
   existingPatches.push({id:r.collection_id,...e});
  }
  assert.equal(existingPatches.length,8);
  const additional=history.filter(r=>!existingPatches.some(p=>p.id===r.collection_id));
  assert.equal(additional.length,1);
  const newer=additional[0];
  assert.ok(newer.day>'2026-09-21'&&newer.status==='Posted');
  assert.equal(newer.month_from,'2026-08');assert.equal(newer.month_to,'2026-08');assert.equal(newer.nop_from,23);assert.equal(newer.nop_to,23);
  const newerExpected={key:receiptKey(newer.or_number),orDate:newer.day,amount:Number(newer.amount_collected),monthFrom:'2026-09',monthTo:'2026-09',nopFrom:24,nopTo:24,dateRemitted:newer.date_remitted.slice(0,10)};
  existingPatches.push({id:newer.collection_id,...newerExpected,allowLinked:true});
  const fullExpected=[...expected,newerExpected];
  const e=expected.find(e=>e.key==='12665B');
  assert.equal(p.source.orDate,e.orDate);assert.equal(p.source.amount,e.amount);
  const occupied=await tx`select or_number from collections where collection_id=${p.source.id}`;
  if(occupied.length){
   assert.notEqual(receiptKey(occupied[0].or_number),'12665B');
   p.source.originalRowId=p.source.id;
   p.source.id='COL-REST-'+createHash('sha1').update(p.source.ref+'|PH-77690372|12665B').digest('hex').slice(0,10).toUpperCase();
  }
  p.source.dateRemitted=e.dateRemitted;p.coverage={monthFrom:e.monthFrom,monthTo:e.monthTo,nopFrom:e.nopFrom,nopTo:e.nopTo};
  const a=p.account;
  const state=accountState({id:a.enrollment_id,doi:a.day,basePay:a.rate,payBalanceTotal:a.total||0,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum,registrationFee:a.registration_fee_required,forfeitMonths:forfeitMonthsFor(a.category_id)},fullExpected.map(e=>({id:e.key,enrollmentId:a.enrollment_id,orDate:e.orDate,orNumber:e.key,amount:e.amount,...e})),todayInManila());
  p.history=history;p.existingPatches=existingPatches;p.ownerExpected=fullExpected;p.state=state;p.ready=true;
  p.ownerHistoryReason='Owner explicitly supplied nine receipts, dates, amounts, covered months and NOPs for PH-77690372, then explicitly confirmed moving the newer remitted payment to September/NOP24. December before January is December 2025. Normalize the supplied 8/20/0226 remittance date to 2026-08-20 matching the OR date and surrounding 2026 history. This explicit history supersedes the earlier DOI-derived coverage inference. Preserve DOI and existing receipt identities, OR dates and amounts.';
  fs.writeFileSync(file,JSON.stringify(p));
  console.log(JSON.stringify({existingReceiptsVerified:history.length,coverageCorrections:existingPatches.filter(e=>{const r=history.find(r=>r.collection_id===e.id);return r.month_from!==e.monthFrom||r.month_to!==e.monthTo||r.nop_from!==e.nopFrom||r.nop_to!==e.nopTo;}).length,remittanceDateCorrections:existingPatches.filter(e=>history.find(r=>r.collection_id===e.id).date_remitted?.slice(0,10)!==e.dateRemitted).length,receiptToAdd:1,sourceRowIdCollisionAvoided:!!p.source.originalRowId,completeHistoryValid:true,privatePlanSaved:true}));
 });
}catch(e){fs.writeFileSync('backups/owner-12665b-prepare-error-private.json',JSON.stringify({message:e.message,stack:e.stack}));console.error('Preparation stopped; diagnostic saved privately.');process.exitCode=1;}finally{await db.end();}
