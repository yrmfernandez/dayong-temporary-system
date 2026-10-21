// Targeted review: original/current records stay private; stdout contains verification counts only.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey,programKey,confirmedSequence,sourceMonths} from './source-history-rules.mjs';
import {accountState,forfeitMonthsFor,todayInManila,monthIndex,saleNops} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const member=process.argv[2];
if(!/^PH-\d{8}$/.test(member??''))throw new Error('Pass member number.');
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const serial=v=>JSON.parse(JSON.stringify(v));
async function main(){
 const index=JSON.parse(fs.readFileSync('legacy-data/other-program-source-index-20261021.json','utf8'));
 const aliases=new Map(Object.entries(JSON.parse(fs.readFileSync('config/legacy-programs.json','utf8')).aliases??{}).map(([k,v])=>[programKey(k),programKey(v)]));
 const resolveProgram=v=>aliases.get(v)??v;
 const sourceFile=`legacy-data/member-source-${member}-private.json`;
 const rawSources=new Map((fs.existsSync(sourceFile)?JSON.parse(fs.readFileSync(sourceFile,'utf8')):[]).map(r=>[r.id,r]));
 await db.begin('isolation level repeatable read read only',async tx=>{
  const members=await tx`select * from members where member_number=${member}`;
  const accounts=await tx`select a.*,a.doi::text as day,p.program_name,p.program_code,p.base_pay::float8 as rate,p.pay_balance_total::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum,p.registration_fee_required,p.category_id from member_programs a join programs p using(program_id) where a.member_number=${member} order by a.enrollment_id`;
  const history=await tx`select *,or_date::text as day from collections where member_number=${member} order by or_date,collection_id`;
  const sales=await tx`select *,or_date::text as receipt_day,doi::text as day from sales where member_number=${member}`;
  const programs=await tx`select program_id,program_name,program_code,base_pay::float8 as rate,pay_balance_total::float8 as total,flexible,max_monthly_payment::float8 as maximum,registration_fee_required,category_id from programs`;
  const cases=[];
  for(const a of accounts){
   const rows=history.filter(p=>p.enrollment_id===a.enrollment_id),ownSales=sales.filter(s=>s.program_id===a.program_id),keys=new Set([programKey(a.program_name),programKey(a.program_code)]);
   const flags={receipts:rows.length,sourceIdentityFailures:0,sourceProgramDifferences:0,ambiguousSourceCoverage:0,monthDifferences:0,nopDifferences:0,sourceNopDoiConflicts:0,linkedReceipts:0,nopDerivedFromExplicitMonthRange:0};
   const sourceProgramCounts=new Map();
   const proposed=[];
   let doi=a.day,saleConfirmed=false;
   if(ownSales.length===1){const s=ownSales[0],src=index.sales[s.sale_id];saleConfirmed=Boolean(src&&src.date===s.day&&s.day===s.receipt_day&&src.amount===Number(s.amount_paid)&&keys.has(src.program));if(saleConfirmed&&a.day.slice(0,7)===s.day.slice(0,7))doi=s.day;}
   for(const p of rows){
    const s=index.collections[p.collection_id];
    const raw=rawSources.get(p.collection_id);
    if(s&&!s.coverage&&raw&&raw.ref===s.ref&&/^\d{4}-\d\d-\d\dT/.test(String(raw.nopText))){
      const months=sourceMonths(raw.monthText);
      if(months&&months.length>1&&Math.round(Number(p.amount_collected)*100)===Math.round(a.rate*100)*months.length){
        const nopFrom=monthIndex(months[0])-monthIndex(doi.slice(0,7))+saleNops({registrationFee:a.registration_fee_required});
        s.coverage={monthFrom:months[0],monthTo:months.at(-1),nopFrom,nopTo:nopFrom+months.length-1};flags.nopDerivedFromExplicitMonthRange++;
      }
    }
    const identity=Boolean(s&&s.or===receiptKey(p.or_number)&&s.date===p.day&&s.amount===Number(p.amount_collected));
    if(!identity)flags.sourceIdentityFailures++;
    if(s&&!keys.has(resolveProgram(s.program)))flags.sourceProgramDifferences++;
    if(s)sourceProgramCounts.set(resolveProgram(s.program),(sourceProgramCounts.get(resolveProgram(s.program))??0)+1);
    if(!s?.coverage)flags.ambiguousSourceCoverage++;
    if(p.linked_remittance_id)flags.linkedReceipts++;
    if(s?.coverage){const c=s.coverage;flags.monthDifferences+=(p.month_from!==c.monthFrom||p.month_to!==c.monthTo)?1:0;flags.nopDifferences+=(p.nop_from!==c.nopFrom||p.nop_to!==c.nopTo)?1:0;
      if(!confirmedSequence({doi,registrationFee:a.registration_fee_required},[c]))flags.sourceNopDoiConflicts++;
      const nopFrom=monthIndex(c.monthFrom)-monthIndex(doi.slice(0,7))+saleNops({registrationFee:a.registration_fee_required});
      proposed.push({id:p.collection_id,monthFrom:c.monthFrom,monthTo:c.monthTo,nopFrom,nopTo:nopFrom+monthIndex(c.monthTo)-monthIndex(c.monthFrom),source:s.ref,sourceNop:[c.nopFrom,c.nopTo]});
    }
   }
   flags.hasConfirmedNewSale=saleConfirmed;flags.doiDayChange=doi!==a.day;
   flags.sourceProgramGroupCounts=[...sourceProgramCounts.values()].sort((a,b)=>b-a);
   const majority=[...sourceProgramCounts].sort((x,y)=>y[1]-x[1])[0];
   const targetCandidates=majority?programs.filter(p=>[programKey(p.program_name),programKey(p.program_code)].includes(majority[0])):[];
   flags.majoritySourceProgramCandidates=targetCandidates.length;
   const target=targetCandidates.length===1?targetCandidates[0]:null;
   flags.targetAmountsExactlyFit=Boolean(target&&rows.every(p=>{const c=index.collections[p.collection_id]?.coverage;return c&&Math.round(Number(p.amount_collected)*100)===Math.round(target.rate*100)*(c.nopTo-c.nopFrom+1);}));
   flags.currentAmountsExactlyFit=rows.every(p=>{const c=index.collections[p.collection_id]?.coverage;return c&&Math.round(Number(p.amount_collected)*100)===Math.round(a.rate*100)*(c.nopTo-c.nopFrom+1);});
   flags.targetAccountAlreadyExists=Boolean(target&&accounts.some(other=>other.program_id===target.program_id&&other.enrollment_id!==a.enrollment_id));
   const records=[a.enrollment_id,...rows.map(p=>p.collection_id)];
   const priorProgramChanges=await tx`select record_id,changes_json->'program_id'->>'from' as previous,changes_json->'program_id'->>'to' as next from audit_log where record_id in ${tx(records)} and table_name in ('collections','member_programs') and changes_json ? 'program_id'`;
   flags.priorProgramChanges=priorProgramChanges.length;
   flags.sourceProgramDifferencesExplainedByAudit=rows.filter(p=>!keys.has(resolveProgram(index.collections[p.collection_id]?.program))).every(p=>priorProgramChanges.some(log=>log.record_id===p.collection_id&&log.next===a.program_id));
   const priorCorrections=await tx`select module,reason,before_json,after_json from record_corrections where record_id in ${tx([member,...records])}`;
   flags.priorCorrections=priorCorrections.length;
   flags.priorOwnerProgramDecision=priorCorrections.some(r=>/owner/i.test(r.reason??'')&&/program|consolidat|merge/i.test(`${r.module??''} ${r.reason??''}`));
   flags.priorExplicitCoverageDecision=priorCorrections.some(r=>/owner.*(?:confirmed|requested|specified)/i.test(r.reason??'')&&/coverageStart|coverage start|explicit coverage|owner.confirmed coverage/i.test(JSON.stringify(r)));
   const minorityRows=rows.filter(p=>resolveProgram(index.collections[p.collection_id]?.program)!==majority?.[0]);
   flags.minorityOnlyLatestReceipt=minorityRows.length===1&&minorityRows[0].collection_id===rows.at(-1)?.collection_id;
   flags.targetRegistrationRuleMatches=Boolean(target&&target.registration_fee_required===a.registration_fee_required);
   flags.proposedSequenceValid=proposed.length===rows.length&&confirmedSequence({doi,registrationFee:a.registration_fee_required},proposed);
   const stateAccount={id:a.enrollment_id,doi,basePay:a.rate,payBalanceTotal:a.total||0,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum,registrationFee:a.registration_fee_required,forfeitMonths:forfeitMonthsFor(a.category_id)};
   const toPayment=(r,p)=>({id:r.collection_id,enrollmentId:a.enrollment_id,orDate:r.day,orNumber:r.or_number,amount:Number(r.amount_collected),...p});
   let beforeState,afterState;
   try{beforeState=accountState({...stateAccount,doi:a.day},rows.filter(r=>r.status==='Posted').map(r=>toPayment(r,{monthFrom:r.month_from,monthTo:r.month_to,nopFrom:r.nop_from,nopTo:r.nop_to})),todayInManila());flags.staleStatus=beforeState.status!==a.account_status;}catch{flags.invalidCurrentHistory=true;}
   if(flags.proposedSequenceValid)try{afterState=accountState(stateAccount,rows.map((r,i)=>toPayment(r,proposed[i])),todayInManila());flags.proposedHistoryValid=true;}catch{flags.proposedHistoryValid=false;}
   const changed=proposed.filter(p=>{const old=rows.find(r=>r.collection_id===p.id);return p.monthFrom!==old.month_from||p.monthTo!==old.month_to||p.nopFrom!==old.nop_from||p.nopTo!==old.nop_to;}).length;
   flags.proposedReceiptChanges=changed;
   const ready=rows.length>0&&!flags.sourceIdentityFailures&&(!flags.sourceProgramDifferences||flags.sourceProgramDifferencesExplainedByAudit)&&!flags.priorExplicitCoverageDecision&&!flags.ambiguousSourceCoverage&&!flags.linkedReceipts&&flags.proposedHistoryValid&&rows.every(r=>r.status==='Posted');
   flags.ready=Boolean(ready);
   cases.push({account:a,history:rows,sales:ownSales,doi,proposed,beforeState,afterState,changed,flags,ready,majoritySourceProgram:target,priorCorrections});
  }
  const snapshot=serial({member,members,accounts,history,sales,cases});
  fs.mkdirSync('backups',{recursive:true});fs.writeFileSync(`backups/member-review-${member}-${Date.now()}-private.json`,JSON.stringify(snapshot));
  fs.writeFileSync(`legacy-data/member-review-${member}-private.json`,JSON.stringify(snapshot));
  const repairCases=serial(cases.filter(c=>c.ready&&(c.changed||c.doi!==c.account.day||c.afterState.status!==c.account.account_status))).map(c=>({...c,status:c.afterState.status,nextNop:c.afterState.nextNop,nextMonth:c.afterState.nextMonth}));
  fs.writeFileSync(`legacy-data/member-repair-${member}-plan-private.json`,JSON.stringify({generatedAt:new Date().toISOString(),member,summary:{candidates:repairCases.length,historyAccounts:repairCases.filter(c=>c.changed).length,changedReceipts:repairCases.reduce((n,c)=>n+c.changed,0),doiChanges:repairCases.filter(c=>c.doi!==c.account.day).length,statusOnlyAccounts:repairCases.filter(c=>!c.changed&&c.doi===c.account.day).length},cases:repairCases,programCounts:[]}));
  console.log(JSON.stringify({memberRecords:members.length,accounts:accounts.length,receipts:history.length,newSales:sales.length,accountChecks:cases.map(c=>c.flags),privateSnapshotSaved:true}));
 });
}
main().catch(e=>{fs.writeFileSync('backups/member-review-error-private.json',JSON.stringify({code:e.code,message:e.message,stack:e.stack}));console.error('Review stopped; diagnostic saved privately.');process.exitCode=1;}).finally(async()=>{await db.end();});
