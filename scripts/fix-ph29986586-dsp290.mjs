// Owner confirmed DSP-290 is this member's only program. Dry run unless --apply.
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState,todayInManila,forfeitMonthsFor} from '../lib/account-rules.ts';
import {repriceEntries} from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const member='PH-29986586',targetId='ENR-LEG-A07E8CFF51',sourceId='ENR-LEG-1BFA80F55F';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 const accounts=await tx`select *,doi::text as doi from member_programs where member_number=${member} for update`;
 const target=accounts.find(a=>a.enrollment_id===targetId),source=accounts.find(a=>a.enrollment_id===sourceId);
 const [program]=await tx`select program_id,program_name,base_pay::float8 as rate,pay_balance_total::float8 as total,flexible,max_monthly_payment::float8 as maximum,registration_fee_required,registration_amount::float8 as fee,category_id from programs where program_id='DP-0021'`;
 if(!target || !program || program.rate!==290 || !program.registration_fee_required || program.fee!==500 || target.program_id!=='DP-0021' || !['2026-10-01','2026-09-22'].includes(target.doi) || accounts.length!==(source?2:1) || (source && (source.program_id!=='DP-0057' || source.doi!=='2026-09-22' || source.member_id!==target.member_id || source.branch!==target.branch || source.mas!==target.mas)))throw Error('Account/program differs from reviewed snapshot.');
 const sales=await tx`select sale_id,program_id,doi::text,or_date::text,amount_paid::float8 as amount,registration_fee,registration_amount::float8,linked_remittance_id from sales where member_number=${member} for update`;
 const rows=await tx`select collection_id,member_id,enrollment_id,program_id,or_number,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to,status from collections where member_number=${member} for update`;
 const sale=sales[0],r=rows[0];
 if(sales.length!==1 || sale.sale_id!=='SALE-LEG-7B3B0C216D' || !['DP-0057','DP-0021'].includes(sale.program_id) || sale.doi!=='2026-09-22' || sale.or_date!=='2026-09-22' || sale.amount!==500 || sale.linked_remittance_id || rows.length!==1 || r.collection_id!=='COL-LEG-6F0038C5F5' || r.member_id!==target.member_id || r.enrollment_id!==targetId || r.program_id!=='DP-0021' || r.or_number!=='24069 N' || r.or_date!=='2026-09-22' || r.amount!==580 || r.month_from!=='2026-10' || r.month_to!=='2026-11' || r.status!=='Posted' || !((r.nop_from===1&&r.nop_to===2)||(r.nop_from===2&&r.nop_to===3)))throw Error('Sale/collection differs from reviewed snapshot.');
 const payment={id:r.collection_id,enrollmentId:targetId,orDate:r.or_date,orNumber:r.or_number,amount:r.amount,monthFrom:r.month_from,monthTo:r.month_to,nopFrom:2,nopTo:3,dateRemitted:'',mas:''};
 const state=accountState({id:targetId,memberId:target.member_id,memberNumber:member,programId:program.program_id,doi:'2026-09-22',branch:target.branch,mas:target.mas,basePay:program.rate,payBalanceTotal:program.total,flexible:program.flexible,maxMonthlyPayment:program.maximum,storedStatus:'',forfeitMonths:forfeitMonthsFor(program.category_id)},[payment],todayInManila());
 if(!source && sale.program_id==='DP-0021' && target.doi==='2026-09-22' && target.account_status===state.status && r.nop_from===2 && r.nop_to===3 && sale.registration_fee && sale.registration_amount===500){console.log('Already corrected and verified.');return;}
 await tx`select set_config('app.user_name','Owner-confirmed DSP-290 correction',true)`;
 await tx`update sales set program_id='DP-0021',registration_fee=true,registration_amount=500 where sale_id=${sale.sale_id}`;
 await tx`update member_programs set doi='2026-09-22',registration_fee=true,registration_amount=500,amount_paid=500,account_status=${state.status} where enrollment_id=${targetId}`;
 await tx`update collections set nop_from=2,nop_to=3 where collection_id=${r.collection_id}`;
 if(source){await tx`update member_transfers set enrollment_id=${targetId},program_id='DP-0021' where enrollment_id=${sourceId}`;await tx`delete from member_programs where enrollment_id=${sourceId}`;}
 const finance=await repriceEntries((query,params)=>tx.unsafe(query,params),{collectionIds:[r.collection_id],saleIds:[sale.sale_id]});
 const stamp=new Date().toISOString();
 await tx`insert into record_corrections ${tx({correction_id:'COR-DSP290-'+Date.now().toString(36).toUpperCase(),module:'Program account correction',record_id:targetId,reason:'Owner confirmed PH-29986586 has only DSP-290. September22,2026 PHP500 New Sale was misfiled under DSP-500; join it to DSP-290 with the actual enrollment DOI. PHP580 receipt24069N covers October-November2026, NOP2-3 after September enrollment. Preserve amounts, receipt dates, member, beneficiaries, branch and MAS.',before_json:{accounts,sales,collections:rows},after_json:{program:'DP-0021',doi:'2026-09-22',registration:500,collection:580,coverage:['2026-10','2026-11'],nop:[2,3],status:state.status,deletedAccount:source?sourceId:null,finance},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-confirmed DSP-290 correction'})}`;
 const verified=await tx`select program_id,doi::text from member_programs where member_number=${member}`;
 if(verified.length!==1 || verified[0].program_id!=='DP-0021' || verified[0].doi!=='2026-09-22')throw Error('Account verification failed.');
 console.log(JSON.stringify({member,program:program.program_name,doi:'2026-09-22',registration:500,collection:580,total:1080,coverage:['2026-10','2026-11'],nop:[2,3],status:state.status,financialChanges:finance.changes.length,slips:finance.slips.length},null,2));
 if(!apply)throw new DryRun();console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
