/** Read-only diagnosis by default. --or-date=YYYY-MM-DD dry-runs an owner-confirmed
 * OR 13335 B date correction; --apply commits it with an audit summary.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState,todayInManila,validDate,dateInMonth,forfeitMonthsFor} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const corrected=process.argv.find(v=>v.startsWith('--or-date='))?.slice(10);
const apply=process.argv.includes('--apply');
if(apply&&!corrected)throw Error('--apply requires an owner-confirmed --or-date.');
if(corrected&&!validDate(corrected))throw Error('Invalid --or-date.');
class DryRun extends Error{}
try {await db.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-confirmed OR date repair',true)`;
 const accounts=await tx`select mp.enrollment_id as id,mp.member_id as "memberId",mp.member_number as "memberNumber",mp.program_id as "programId",mp.doi::text,mp.branch,mp.mas,mp.account_status as "storedStatus",p.base_pay::float8 as "basePay",p.pay_balance_total::float8 as "payBalanceTotal",p.flexible,p.max_monthly_payment::float8 as "maxMonthlyPayment",p.category_id from member_programs mp join programs p on p.program_id=mp.program_id where mp.member_number='PH-73303959' for update of mp`;
 const history=await tx`select collection_id as id,enrollment_id as "enrollmentId",or_date::text as "orDate",or_number as "orNumber",month_from as "monthFrom",month_to as "monthTo",nop_from as "nopFrom",nop_to as "nopTo",amount_collected::float8 as amount,date_remitted::text as "dateRemitted",mas from collections where member_number='PH-73303959' and status='Posted' for update`;
 const diagnose=payments=>accounts.map(a=>{
  a.forfeitMonths=forfeitMonthsFor(a.category_id);
  const errors=[];
  for(let month=1;month<=10;month++){
   const end=month===10?todayInManila():dateInMonth(`2026-${String(month).padStart(2,'0')}`,31);
   if(a.doi>end)continue;
   try{accountState({...a,storedStatus:''},payments,end);}catch(e){errors.push({asOf:end,error:e.message});}
  }
  let state;try{state=accountState(a,payments,todayInManila());}catch(e){state={error:e.message};}
  return {account:a.id,program:a.programId,stored:a.storedStatus,status:state.status,error:state.error,errors};
 });
 const before=diagnose(history);console.log(JSON.stringify({before},null,2));
 if(!corrected)return;
 const receipt=history.find(r=>r.id==='COL-LEG-C8A2D15A6B');
 if(accounts.length!==2 || history.length!==6 || !receipt || receipt.enrollmentId!=='ENR-LEG-64C18329C0' || receipt.orNumber!=='13335 B' || receipt.amount!==280 || receipt.nopFrom!==44 || receipt.nopTo!==44 || receipt.monthFrom!=='2026-06' || receipt.monthTo!=='2026-06' || !['2026-01-31',corrected].includes(receipt.orDate))throw Error('Data differs from reviewed snapshot.');
 const revised=history.map(r=>r===receipt?{...r,orDate:corrected}:r);
 const after=diagnose(revised);
 if(after.some(a=>a.errors.length||a.error))throw Error('Proposed date still leaves account errors: '+JSON.stringify(after));
 console.log(JSON.stringify({receipt:receipt.orNumber,dateBefore:receipt.orDate,dateAfter:corrected,after,collectionsTotal:history.reduce((sum,r)=>sum+r.amount,0)},null,2));
 if(receipt.orDate===corrected && after.every(a=>a.stored===a.status)){console.log('Already corrected.');return;}
 await tx`update collections set or_date=${corrected} where collection_id=${receipt.id}`;
 for(const a of after)await tx`update member_programs set account_status=${a.status} where enrollment_id=${a.account}`;
 const stamp=new Date().toISOString();
 await tx`insert into record_corrections ${tx({correction_id:'COR-ORDATE-'+Date.now().toString(36).toUpperCase(),module:'OR date correction',record_id:receipt.id,reason:'Owner-confirmed actual OR date for 13335 B. Old January date caused June coverage to precede January-May receipts, breaking historical account states. Preserve amounts, NOPs, coverage, financial fields and both programs; recalculate stored statuses.',before_json:{receipt,accounts:before},after_json:{orDate:corrected,accounts:after},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-confirmed OR date repair'})}`;
 if(!apply)throw new DryRun();
 console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await db.end();}
