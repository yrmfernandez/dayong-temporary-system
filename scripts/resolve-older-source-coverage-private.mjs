// Resolve Excel date-formatted NOP ranges against the confirmed DOI and source month names. No raw output.
import fs from 'node:fs';
import {sourceMonths,sourceCoverage,receiptKey} from './source-history-rules.mjs';
import {monthIndex,monthName,saleNops,firstCollectionNop,accountState,forfeitMonthsFor,todayInManila} from '../lib/account-rules.ts';
const member='PH-53228425';
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const review=JSON.parse(fs.readFileSync(`legacy-data/member-review-${member}-private.json`,'utf8'));
const plan=JSON.parse(fs.readFileSync('legacy-data/receipt-5367M-import-plan-private.json','utf8'));
const originals=JSON.parse(fs.readFileSync(`legacy-data/member-source-${member}-private.json`,'utf8'));
const a=plan.account??plan.candidates[0],checks=[],resolved=[];
for(const key of ['5364M','5367M']){
 const raw=key==='5367M'?{headers:plan.source.rawHeaders,row:plan.source.rawRow,id:plan.source.id}:originals.find(r=>receiptKey(r.row[r.headers.findIndex(h=>norm(h)==='ORNUMBER')])===key);
 if(!raw){checks.push({sourceFound:false});continue;}
 const pos=new Map(raw.headers.map((h,i)=>[norm(h),i])),nop=raw.row[pos.get('NOP')],months=sourceMonths(raw.row[pos.get('MONTHOF')]);
 const parsed=sourceCoverage(raw.row[pos.get('MONTHOF')],nop);
 const d=new Date(nop),from=parsed?.nopFrom??Math.min(d.getUTCMonth()+1,d.getUTCDate()),to=parsed?.nopTo??Math.max(d.getUTCMonth()+1,d.getUTCDate());
 const spansMatch=Boolean(months&&Number.isFinite(from)&&to-from+1===months.length);
 const start=monthName(monthIndex(a.day.slice(0,7))+from-saleNops({registrationFee:a.registration_fee_required}));
 const end=monthName(monthIndex(a.day.slice(0,7))+to-saleNops({registrationFee:a.registration_fee_required}));
 const monthNamesMatch=Boolean(months&&months[0].slice(5)===start.slice(5)&&months.at(-1).slice(5)===end.slice(5));
 const amount=Number(String(raw.row[pos.get('AMOUNTCOLLECTED')]).replace(/[^0-9.-]/g,''));
 const amountMatches=spansMatch&&Math.round(amount*100)===Math.round(a.rate*100)*months.length;
 const ready=spansMatch&&monthNamesMatch&&amountMatches&&from>=firstCollectionNop({registrationFee:a.registration_fee_required});
 checks.push({sourceFound:true,dateFormattedNop:/^\d{4}-\d\d-\d\dT/.test(String(nop)),decodedNopSpanMatchesMonthCount:spansMatch,decodedNopMatchesSourceMonthNames:monthNamesMatch,paymentMatchesSpan:amountMatches,decodedRangeAllowed:ready});
 if(ready)resolved.push({key,id:raw.id,monthFrom:start,monthTo:end,nopFrom:from,nopTo:to});
}
let valid=false,state,failureCategory;
if(resolved.length===2)try{
 const payments=review.history.map(r=>{const p=resolved.find(p=>p.id===r.collection_id);return{id:r.collection_id,enrollmentId:a.enrollment_id,orDate:r.day,orNumber:r.or_number,amount:Number(r.amount_collected),monthFrom:r.month_from,monthTo:r.month_to,nopFrom:r.nop_from,nopTo:r.nop_to,...p};});
 const p=resolved.find(p=>p.key==='5367M');payments.push({id:p.id,enrollmentId:a.enrollment_id,orDate:plan.source.orDate,orNumber:plan.source.or,amount:plan.source.amount,...p});
 state=accountState({id:a.enrollment_id,doi:a.day,basePay:a.rate,payBalanceTotal:a.total||0,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum,registrationFee:a.registration_fee_required,forfeitMonths:forfeitMonthsFor(a.category_id)},payments,todayInManila());valid=true;
}catch(e){failureCategory=/overlap/i.test(e.message)?'overlap':/gaps/i.test(e.message)?'missingInterveningMonths':/amount|installment/i.test(e.message)?'amountMismatch':'invalidHistory';}
const added=resolved.find(p=>p.key==='5367M');
const overlaps=added?review.history.filter(r=>(r.month_from<=added.monthTo&&r.month_to>=added.monthFrom)||(r.nop_from<=added.nopTo&&r.nop_to>=added.nopFrom)).length:0;
const overlapIsOtherRequestedReceipt=Boolean(added&&review.history.some(r=>receiptKey(r.or_number)==='5364M'&&((r.month_from<=added.monthTo&&r.month_to>=added.monthFrom)||(r.nop_from<=added.nopTo&&r.nop_to>=added.nopFrom))));
const existingCoverageChanges=resolved.filter(p=>{const r=review.history.find(r=>r.collection_id===p.id);return r&&(p.monthFrom!==r.month_from||p.monthTo!==r.month_to||p.nopFrom!==r.nop_from||p.nopTo!==r.nop_to);}).length;
fs.writeFileSync(`legacy-data/older-source-coverage-${member}-private.json`,JSON.stringify({member,checks,resolved,valid,state,failureCategory}));
console.log(JSON.stringify({sourceChecks:checks,combinedHistoryValid:valid,failureCategory,newPaymentOverlapsSaved:overlaps,overlapIsOtherRequestedReceipt,existingCoverageChanges}));
