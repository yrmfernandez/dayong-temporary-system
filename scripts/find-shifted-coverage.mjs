/** Read-only coverage/status audit. Receipt dates are clues, not proof of which month was paid. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState, paymentsByEnrollment, monthIndex, monthName, validMonth, todayInManila} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const today=todayInManila();
try {await db.begin('isolation level repeatable read read only',async tx=>{
  const accounts=await tx`select a.enrollment_id as id,a.member_id as "memberId",a.member_number as "memberNumber",a.program_id as "programId",a.doi::text as doi,a.account_status as "storedStatus",p.program_name as program,p.base_pay::float8 as "basePay",p.pay_balance_total::float8 as "payBalanceTotal",p.flexible,p.max_monthly_payment::float8 as "maxMonthlyPayment" from member_programs a join programs p on p.program_id=a.program_id`;
  const payments=await tx`select collection_id as id,enrollment_id as "enrollmentId",or_number as "orNumber",or_date::text as "orDate",amount_collected::float8 as amount,nop_from as "nopFrom",nop_to as "nopTo",month_from as "monthFrom",month_to as "monthTo",date_remitted::text as "dateRemitted" from collections where status='Posted'`;
  const grouped=paymentsByEnrollment(payments),candidates=[],statusOnly=[],invalid=[];
  for(const a of accounts){
    const history=(grouped.get(a.id)??[]).sort((x,y)=>(x.orDate??'').localeCompare(y.orDate??'')||x.id.localeCompare(y.id));
    let state;
    try {state=accountState({...a,branch:'',mas:''},history,today);}
    catch(error){invalid.push({member:a.memberNumber,account:a.id,program:a.program,reason:error.message});continue;}
    if(a.storedStatus!==state.status)statusOnly.push({member:a.memberNumber,account:a.id,program:a.program,stored:a.storedStatus,calculated:state.status});
    if(history.length<6||a.flexible||!history[0].orDate?.startsWith('2026-01')||!validMonth(history[0].monthFrom)||history[0].monthFrom>='2026-01'||history.at(-1).orDate<'2026-08-01')continue;
    if(history.some(r=>!validMonth(r.monthFrom)||!validMonth(r.monthTo)||r.nopTo-r.nopFrom+1<1||Math.round(r.amount*100)!==Math.round(a.basePay*100)*(r.nopTo-r.nopFrom+1)))continue;
    const offset=monthIndex('2026-01')-monthIndex(history[0].monthFrom);
    if(offset>3)continue;
    const proposed=history.map(r=>({...r,monthFrom:monthName(monthIndex(r.monthFrom)+offset),monthTo:monthName(monthIndex(r.monthTo)+offset),nopFrom:r.nopFrom+offset,nopTo:r.nopTo+offset}));
    let preview;
    try{preview=accountState({...a,branch:'',mas:''},proposed,today);}catch{continue;}
    const comparable=history[0].nopTo>history[0].nopFrom;
    candidates.push({member:a.memberNumber,account:a.id,program:a.program,rate:a.basePay,rank:comparable?'Multi-month January receipt':'Single-month January receipt',receiptCount:history.length,gross:history.reduce((sum,r)=>sum+r.amount,0),shiftMonths:offset,storedCoverage:[history[0].monthFrom,history.at(-1).monthTo],proposedCoverage:[proposed[0].monthFrom,proposed.at(-1).monthTo],storedStatus:a.storedStatus,calculatedStatus:state.status,proposedStatus:preview.status,receipts:history.map((r,i)=>({receipt:r.orNumber,date:r.orDate,amount:r.amount,storedMonths:[r.monthFrom,r.monthTo],storedNops:[r.nopFrom,r.nopTo],proposedMonths:[proposed[i].monthFrom,proposed[i].monthTo],proposedNops:[proposed[i].nopFrom,proposed[i].nopTo]}))});
  }
  candidates.sort((a,b)=>(a.rank.startsWith('Multi')?0:1)-(b.rank.startsWith('Multi')?0:1)||a.shiftMonths-b.shiftMonths||b.receiptCount-a.receiptCount||a.member.localeCompare(b.member));
  const summary={accountsScanned:accounts.length,receiptsScanned:payments.length,coverageCandidates:candidates.length,multiMonthJanuaryCandidates:candidates.filter(c=>c.rank.startsWith('Multi')).length,statusMismatches:statusOnly.length,invalidHistories:invalid.length};
  const base=`legacy-data/shifted-coverage-review-${today}`;
  fs.writeFileSync(base+'.json',JSON.stringify({generatedAt:new Date().toISOString(),summary,candidates,statusMismatches:statusOnly,invalidHistories:invalid},null,2));
  const lines=['# Possible shifted coverage','',`Read-only production snapshot on ${today}. No database changes. No names or contact details read.`,'','These accounts have six or more exact fixed-rate receipts, beginning with a January 2026 receipt whose stored coverage starts in October–December 2025, and continuing at least into August 2026. Multi-month January payments resemble the owner-corrected case most closely. Starting them in January yields a structurally valid alternative history, but prior-year arrears can be legitimate: confirmation is required before applying a shift. Proposed NOPs retain the existing DOI. Status differences can be stale cached values and do not prove coverage is wrong.','', '```json',JSON.stringify(summary,null,2),'```','','| Member | Program | First receipt | Amount | Stored coverage | January-start alternative | Pattern |','| --- | --- | --- | ---: | --- | --- | --- |',...candidates.map(c=>`| ${c.member} | ${c.program} | ${c.receipts[0].receipt} | ${c.receipts[0].amount} | ${c.storedCoverage.join(' to ')} | ${c.proposedCoverage.join(' to ')} | ${c.rank} |`),...candidates.filter(c=>c.rank.startsWith('Multi')).flatMap(c=>['',`## ${c.member}: ${c.program}`,'','| Receipt | OR date | Amount | Stored coverage | Proposed coverage | Proposed NOP |','| --- | --- | ---: | --- | --- | --- |',...c.receipts.map(r=>`| ${r.receipt} | ${r.date} | ${r.amount} | ${r.storedMonths.join(' to ')} | ${r.proposedMonths.join(' to ')} | ${r.proposedNops.join('–')} |`)])];
  fs.writeFileSync(base+'.md',lines.join('\n'));
  console.log(JSON.stringify({summary,first:candidates.slice(0,12).map(c=>({member:c.member,program:c.program,firstReceipt:c.receipts[0].receipt,amount:c.receipts[0].amount,storedCoverage:c.storedCoverage,proposedCoverage:c.proposedCoverage,rank:c.rank,receipts:c.receiptCount})),report:base+'.md'},null,2));
});}finally{await db.end();}
