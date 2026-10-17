/** Owner-confirmed account correction. Dry run by default; --apply commits.
 * Imported financial fields must be empty and receipts unlinked: missing first-year
 * incentive tiers must not cause this account repair to invent financial figures.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState,todayInManila} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const member='PH-80673488', memberId='MEM-LEG-26836A1BE0';
const source='ENR-LEG-AAC8A4DBAE', target='ENR-LEG-96C3E485FC';
const expected=[
 ['COL-LEG-2E7AA87E4F','4481 M','2026-02-06',10,'2026-02','2026-03'],
 ['COL-LEG-63C2BB6625','8270 M','2026-04-12',12,'2026-04','2026-05'],
 ['COL-LEG-9D1CB5F342','8056 B','2026-06-17',14,'2026-06','2026-07'],
 ['COL-LEG-E200C10EC2','8073 B','2026-07-14',16,'2026-08','2026-09'],
 ['COL-LEG-3B4EB29E87','08100 B','2026-09-14',18,'2026-10','2026-11'],
];
class DryRun extends Error {}
try { await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-confirmed D-250 FG correction',true)`;
 const accounts=await tx`select enrollment_id,member_id,member_number,program_id,doi::text,account_status from member_programs where member_id=${memberId} for update`;
 const kept=accounts.find(a=>a.enrollment_id===target);
 if(!kept || kept.program_id!=='DP-0016' || kept.doi!=='2025-05-01' || accounts.some(a=>a.member_number!==member || a.doi!==kept.doi || ![source,target].includes(a.enrollment_id) || (a.enrollment_id===source && a.program_id!=='DP-0005'))) throw Error('Account data differs from reviewed snapshot.');
 const before=await tx`select collection_id,member_id,member_number,enrollment_id,program_id,or_number,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to,status,remittance_amount,remittance_breakdown,forfeited_incentive,linked_remittance_id from collections where member_id=${memberId} for update`;
 if(before.length!==expected.length)throw Error('Unexpected receipt count.');
 for(const [id,or,date,nop,from,to] of expected){
  const r=before.find(r=>r.collection_id===id);
  if(!r || r.member_number!==member || r.or_number!==or || r.or_date!==date || r.amount!==500 || r.nop_from!==nop || r.nop_to!==nop+1 || r.month_from!==from || r.month_to!==to || r.status!=='Posted' || ![source,target].includes(r.enrollment_id) || r.program_id!==(r.enrollment_id===source?'DP-0005':'DP-0016'))throw Error('Receipt differs from reviewed snapshot: '+or);
  if(r.remittance_amount!==null || r.remittance_breakdown!==null || r.forfeited_incentive!==null || r.linked_remittance_id!==null)throw Error('Stored financial figures need separate review: '+or);
 }
 if((await tx`select 1 from remittance_collections where collection_id in ${tx(expected.map(r=>r[0]))}`).length)throw Error('Receipt linked to a remittance.');
 if((await tx`select 1 from sales where member_number=${member} and program_id='DP-0005'`).length || (await tx`select 1 from member_transfers where enrollment_id=${source}`).length)throw Error('Source account has other history.');
 const moved=before.filter(r=>r.enrollment_id===source);
 await tx`update collections set enrollment_id=${target},program_id='DP-0016' where member_id=${memberId} and enrollment_id=${source}`;
 const [p]=await tx`select base_pay::float8 as rate,pay_balance_total::float8 as total,flexible,max_monthly_payment::float8 as maximum from programs where program_id='DP-0016'`;
 const state=accountState({id:target,memberId,memberNumber:member,programId:'DP-0016',doi:kept.doi,branch:'',mas:'',basePay:p.rate,payBalanceTotal:p.total,flexible:p.flexible,maxMonthlyPayment:p.maximum,storedStatus:''},before.map(r=>({id:r.collection_id,enrollmentId:target,orDate:r.or_date,orNumber:r.or_number,monthFrom:r.month_from,monthTo:r.month_to,nopFrom:r.nop_from,nopTo:r.nop_to,amount:r.amount,dateRemitted:'',mas:''})),todayInManila());
 await tx`update member_programs set account_status=${state.status} where enrollment_id=${target}`;
 await tx`delete from member_programs where enrollment_id=${source} and member_id=${memberId}`;
 const after=await tx`select collection_id,program_id,enrollment_id,amount_collected::float8 as amount from collections where member_id=${memberId}`;
 if(after.length!==5 || after.some(r=>r.program_id!=='DP-0016' || r.enrollment_id!==target || r.amount!==500))throw Error('Verification failed.');
 console.log(JSON.stringify({member,moved:moved.map(r=>r.or_number),receipts:5,total:2500,coverage:'2026-02 through 2026-11',nop:'10 through 19',status:state.status,financialFields:'Preserved empty; first-year incentive tiers missing.'},null,2));
 if(moved.length){
  const stamp=new Date().toISOString();
  await tx`insert into record_corrections ${tx({correction_id:'COR-D250FG-'+Date.now().toString(36).toUpperCase(),module:'Program account correction',record_id:target,reason:'Owner confirmed October 17, 2026: all PH-80673488 payments belong to D-250 FG. Move two misfiled D-210 HG payments, preserve existing two-month coverage and amounts, remove empty erroneous account. Unpriced/unlinked legacy financial fields retained: D-250 FG has no incentive tiers for NOP 10-12; do not invent rates.',before_json:{accounts,receipts:before},after_json:{receipts:after,status:state.status,deletedAccount:source,financialFieldsPreserved:true},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-confirmed D-250 FG correction'})}`;
 }
 if(!apply)throw new DryRun();
 });console.log('Applied.');
}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
