// Guarded historical receipt import. Preview rolls back; --apply commits; --verify reads saved snapshot. Aggregate output only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {sourceDay,receiptKey} from './source-history-rules.mjs';
import {accountState,forfeitMonthsFor,todayInManila} from '../lib/account-rules.ts';
import {repriceEntries} from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const key=String(process.argv[2]??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
if(!/^\d+[A-Z]+$/.test(key))throw new Error('Pass receipt number and suffix.');
const apply=process.argv.includes('--apply'),actor='Owner-confirmed source receipt import';
const ownerHistory=process.argv.includes('--owner-history');
const serial=v=>JSON.parse(JSON.stringify(v));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const canon=v=>receiptKey(v).replace(/^0+(?=\d)/,'');
const omit=(r,fields)=>Object.fromEntries(Object.entries(r).filter(([k])=>!fields.includes(k)));
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
class Rollback extends Error{}
async function verify(tx,snapshot){
  const [receipt]=serial(await tx`select * from collections where collection_id=${snapshot.inserted.collection_id}`);
  const history=serial(await tx`select * from collections where enrollment_id=${snapshot.account.enrollment_id} and collection_id<>${snapshot.inserted.collection_id} order by collection_id`);
  const [account]=serial(await tx`select * from member_programs where enrollment_id=${snapshot.account.enrollment_id}`);
  assert.deepEqual(receipt,snapshot.inserted);
  for(const row of history){
    const old=snapshot.history.find(r=>r.collection_id===row.collection_id);assert.ok(old);
    const patch=snapshot.ownerPatches?.find(p=>p.id===row.collection_id);
    const price=snapshot.finance?.changes.find(p=>p.id===row.collection_id);
    const allowed=[...(patch?['month_from','month_to','nop_from','nop_to','date_remitted']:[]),...(price?['remittance_amount','remittance_breakdown','forfeited_incentive']:[])];
    assert.deepEqual(omit(row,allowed),omit(old,allowed));
    if(patch){assert.equal(row.month_from,patch.monthFrom);assert.equal(row.month_to,patch.monthTo);assert.equal(row.nop_from,patch.nopFrom);assert.equal(row.nop_to,patch.nopTo);assert.equal(row.date_remitted?.slice(0,10),patch.dateRemitted);}
    if(price){assert.equal(Number(row.remittance_amount),price.after.remittance);assert.deepEqual(row.remittance_breakdown,price.after.breakdown);assert.equal(Number(row.forfeited_incentive),Number(price.after.forfeited));}
  }
  assert.equal(history.length,snapshot.history.length);
  if(snapshot.linkedBefore){
    const links=serial(await tx`select * from remittance_collections where collection_id in ${tx(snapshot.ownerPatches.map(p=>p.id))} order by remittance_collection_id`);
    assert.deepEqual(links,snapshot.linkedBefore);
    const parents=snapshot.parentBefore.length?serial(await tx`select * from remittances where remittance_id in ${tx(snapshot.parentBefore.map(r=>r.remittance_id))} order by remittance_id`):[];
    assert.deepEqual(parents,snapshot.parentBefore);
  }
  assert.deepEqual(omit(account,['account_status']),omit(snapshot.account,['account_status']));
  assert.equal(account.account_status,snapshot.status);
  const [{n}]=await tx`select count(*)::int as n from collections where regexp_replace(or_key,'^0+','')=${canon(key)}`;
  assert.equal(n,1);
  const corrections=await tx`select correction_id from record_corrections where correction_id=${snapshot.correctionId}`;
  const audits=await tx`select audit_id from audit_log where table_name='collections' and record_id=${snapshot.inserted.collection_id} and action='insert' and user_name=${actor}`;
  assert.equal(corrections.length,1);assert.equal(audits.length,1);
  if(snapshot.ownerChangedIds?.length){const updates=await tx`select distinct record_id from audit_log where table_name='collections' and record_id in ${tx(snapshot.ownerChangedIds)} and action='update' and user_name=${actor}`;assert.equal(updates.length,snapshot.ownerChangedIds.length);}
  return{receiptCount:1,memberConfirmed:true,coverageValidated:true,financialSnapshotVerified:true,existingReceiptsPreserved:true,correctionVerified:true,auditVerified:true};
}
async function main(){
  const snapshotFile=`backups/receipt-${key}-applied-private.json`;
  if(process.argv.includes('--verify')){
    const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
    console.log(JSON.stringify(await db.begin('isolation level repeatable read read only',tx=>verify(tx,snapshot))));return;
  }
  const plan=JSON.parse(fs.readFileSync(`legacy-data/receipt-${key}-import-plan-private.json`,'utf8'));
  assert.ok(plan.ready&&plan.confirmedMember&&plan.coverage);
  assert.ok(ownerHistory||!plan.existingPatches,'Owner history requires --owner-history');
  if(ownerHistory)assert.ok(plan.ownerHistoryReason&&plan.ownerExpected?.length===plan.existingPatches?.length+1&&plan.existingPatches.length<=plan.history.length);
  await db.begin(async tx=>{
    await tx`set transaction isolation level serializable`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`receipt-import:${canon(key)}`},0))`;
    await tx`select set_config('app.user_name',${actor},true)`;
    const [account]=serial(await tx`select * from member_programs where enrollment_id=${plan.account.enrollment_id} for update`);
    const history=serial(await tx`select * from collections where enrollment_id=${plan.account.enrollment_id} order by collection_id for update`);
    for(const field of Object.keys(account))if(field!=='doi')assert.deepEqual(account[field],plan.account[field]);
    assert.equal(account.member_number,plan.confirmedMember);assert.equal(account.doi.slice(0,10),plan.account.day);
    assert.deepEqual(history,serial(plan.history).map(r=>omit(r,['day'])).sort((a,b)=>a.collection_id.localeCompare(b.collection_id)));
    const used=await tx`select collection_id from collections where regexp_replace(or_key,'^0+','')=${canon(key)} union all
      select sale_id from sales where regexp_replace(regexp_replace(upper(coalesce(or_number,'')),'[^A-Z0-9]','','g'),'^0+','')=${canon(key)}`;
    assert.equal(used.length,0);
    fs.mkdirSync('backups',{recursive:true});
    const snapshot={account,history,plan};
    fs.writeFileSync(`backups/receipt-${key}-before-private-${Date.now()}.json`,JSON.stringify(snapshot));
    if(ownerHistory){
      snapshot.ownerPatches=plan.existingPatches;
      snapshot.ownerChangedIds=[];
      snapshot.linkedBefore=serial(await tx`select * from remittance_collections where collection_id in ${tx(plan.existingPatches.map(p=>p.id))} order by remittance_collection_id for update`);
      snapshot.parentBefore=snapshot.linkedBefore.length?serial(await tx`select * from remittances where remittance_id in ${tx([...new Set(snapshot.linkedBefore.map(r=>r.remittance_id))])} order by remittance_id for update`):[];
      for(const p of plan.existingPatches){
        const old=history.find(r=>r.collection_id===p.id);assert.ok(old&&(p.allowLinked||!old.linked_remittance_id));
        assert.equal(receiptKey(old.or_number),p.key);assert.equal(old.or_date.slice(0,10),p.orDate);assert.equal(Number(old.amount_collected),p.amount);
        const links=snapshot.linkedBefore.filter(r=>r.collection_id===p.id);if(!p.allowLinked)assert.equal(links.length,0);
        if(old.month_from!==p.monthFrom||old.month_to!==p.monthTo||old.nop_from!==p.nopFrom||old.nop_to!==p.nopTo||old.date_remitted?.slice(0,10)!==p.dateRemitted){
          await tx`update collections set month_from=${p.monthFrom},month_to=${p.monthTo},nop_from=${p.nopFrom},nop_to=${p.nopTo},date_remitted=${p.dateRemitted} where collection_id=${p.id}`;
          snapshot.ownerChangedIds.push(p.id);
        }
      }
    }
    const source=plan.source,headers=source.rawHeaders.map(norm);
    const cell=name=>source.rawRow[headers.lastIndexOf(name)];
    const channel=/COLLECTOR/i.test(String(cell('STATUS')??''))?'Collector':/DTO/i.test(String(cell('STATUS')??''))?'DTO':'MAS';
    const sourceAgent=String(source.mas||source.rawRow[headers.findIndex(h=>h.startsWith('MARKETINGAGENT'))]||'').trim();
    const aliases=JSON.parse(fs.readFileSync('config/legacy-migration-map.json','utf8')).agents??{};
    const overrideId=Object.entries(aliases).find(([label])=>norm(label)===norm(sourceAgent))?.[1];
    const employees=await tx`select employee_id,full_name from employees`;
    const employeeMatches=employees.filter(e=>{
      if(overrideId)return e.employee_id===overrideId;
      if(norm(e.full_name)===norm(sourceAgent)||norm(e.employee_id)===norm(sourceAgent))return true;
      const [surname,given='']=e.full_name.split(',').map(v=>v.trim());
      const initials=given.split(/\s+/).filter(Boolean).map(w=>w[0]).join('');
      return [norm(`${surname},${given.slice(0,1)}`),norm(`${surname},${initials}`)].includes(norm(sourceAgent));
    });
    let employee=employeeMatches.length===1?employeeMatches[0]:employeeMatches.find(e=>e.employee_id===account.mas_employee_id&&channel==='MAS');
    assert.ok(employee||sourceAgent,'SOURCE_AGENT_EMPTY');
    const agentName=employee?.full_name??sourceAgent;
    const dateRemitted=sourceDay(source.dateRemitted);
    assert.ok(dateRemitted&&dateRemitted>=source.orDate,'SOURCE_REMITTANCE_DATE_INVALID');
    const yes=v=>/^(?:YES|Y|TRUE|1)$/i.test(String(v??'').trim());
    const timestamp=cell('TIMESTAMP');
    const recordedAt=sourceDay(timestamp)?new Date(timestamp).toISOString():new Date().toISOString();
    const receipt={collection_id:source.id,collection_batch_id:`CBT-LEG-${createHash('sha1').update(source.ref).digest('hex').slice(0,10).toUpperCase()}`,
      enrollment_id:account.enrollment_id,member_id:account.member_id,member_number:account.member_number,program_id:account.program_id,
      branch:account.branch,mas:agentName,or_number:source.or,or_date:source.orDate,amount_collected:source.amount,
      month_from:plan.coverage.monthFrom,month_to:plan.coverage.monthTo,nop_from:plan.coverage.nopFrom,nop_to:plan.coverage.nopTo,
      reactivation:yes(cell('REACTIVATION')),transferred:yes(cell('TRANSFERRED')),suspended:String(cell('IFSUSPENDED')??'')||null,
      original_mas:source.rawRow[headers.findIndex(h=>h.includes('ORIGINALMAS'))]||null,status:'Posted',created_at:recordedAt,
      encoded_by_user_id:null,encoded_by_employee_id:null,encoded_by_name:actor,encoded_at:recordedAt,
      collected_by_role:channel,remittance_status:'Remitted',linked_remittance_id:null,accountable_employee_id:employee?.employee_id??null,accountable_name:agentName,
      accountable_role:channel==='Collector'?'Collector':'MAS',remittance_method:'Cash',date_remitted:dateRemitted,legacy_duplicate:false};
    await tx`insert into collections ${tx(receipt)}`;
    const finance=await repriceEntries((query,params)=>tx.unsafe(query,params),{collectionIds:[source.id,...(snapshot.ownerChangedIds??[])]});
    if(ownerHistory)assert.equal(finance.slips.length,0,'Remittance expectations must remain unchanged');
    const rows=await tx`select *,or_date::text as day from collections where enrollment_id=${account.enrollment_id}`;
    const a=plan.account;
    const state=accountState({id:a.enrollment_id,doi:a.day,basePay:a.rate,payBalanceTotal:a.total||0,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum,registrationFee:a.registration_fee_required,forfeitMonths:forfeitMonthsFor(a.category_id)},
      rows.filter(h=>h.status==='Posted').map(h=>({id:h.collection_id,enrollmentId:a.enrollment_id,orDate:h.day,orNumber:h.or_number,monthFrom:h.month_from,monthTo:h.month_to,nopFrom:h.nop_from,nopTo:h.nop_to,amount:Number(h.amount_collected)})),todayInManila());
    await tx`update member_programs set account_status=${state.status} where enrollment_id=${account.enrollment_id}`;
    const [saved]=serial(await tx`select * from collections where collection_id=${source.id}`);
    assert.equal(saved.member_number,plan.confirmedMember);assert.equal(Number(saved.amount_collected),source.amount);
    snapshot.inserted=saved;snapshot.status=state.status;snapshot.finance=finance;
    snapshot.correctionId=`COR-OR-${key}-${Date.now().toString(36).toUpperCase()}`;
    await tx`insert into record_corrections ${tx({correction_id:snapshot.correctionId,module:actor,record_id:source.id,
      reason:ownerHistory?plan.ownerHistoryReason:`Owner requested adding OR ${key} and explicitly confirmed member ${plan.confirmedMember}. Original source receipt/date/amount/month retained; NOP aligned with confirmed account DOI and continuous existing history. Historical collection imported without a new turnover or changes to existing receipts.`,
      before_json:{source:source.ref,accountStatus:account.account_status,sourceCoverage:source.coverage,...(ownerHistory?{history}: {})},after_json:{receipt:saved,accountStatus:state.status,finance,...(ownerHistory?{explicitOwnerCoverage:plan.ownerExpected}: {})},
      corrected_at:new Date().toISOString(),encoded_by_name:actor,encoded_at:new Date().toISOString()})}`;
    await tx`insert into audit_log ${tx({action:'insert',table_name:'collections',record_id:source.id,changes_json:saved,user_name:actor})}`;
    fs.writeFileSync(apply?snapshotFile:`backups/receipt-${key}-preview-private.json`,JSON.stringify(snapshot));
    console.log(JSON.stringify({mode:apply?'apply':'preview',...await verify(tx,snapshot),financialSnapshotsCalculated:finance.changes.length}));
    if(!apply)throw new Rollback();
  });
  console.log('Committed.');
}
main().catch(e=>{if(e instanceof Rollback){console.log('Preview passed; all writes rolled back.');return;}
  fs.writeFileSync('backups/receipt-import-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack}));console.error('Import stopped; private diagnostic saved. No member/source records printed.');process.exitCode=1;
}).finally(async()=>{await db.end();});
