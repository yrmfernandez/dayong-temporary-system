/** Owner-supplied receipt ledger, October 14, 2026. Dry run unless --apply. */
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}}),apply=process.argv.includes('--apply');
const member='PH-70661323',enrollment='ENR-LEG-97D0960851',newId='COL-LEG-OWNER-70661323-4191S',otherId='COL-LEG-19416758F0';
const plan=[
 ['4105S','2026-02-06',1050,'2025-12','2026-02',39,41,'2026-02-07'],
 ['779S','2026-04-24',700,'2026-03','2026-04',42,43,'2026-04-27'],
 ['2299S','2026-07-15',1050,'2026-05','2026-07',44,46,'2026-07-16'],
 ['4191S','2026-10-12',700,'2026-08','2026-09',47,48,'2026-10-12'],
];
const reason='Owner supplied PH-70661323 receipt ledger October 14, 2026: 4191 S is PHP 700 dated/remitted October 12, 2026 covering August–September, NOP 47–48. Keep PH-41570505 separate PHP 180 receipt dated February 3, 2026 and mark that shared-number copy duplicated. First receipt covers December 2025 through February 2026; preceding receipt amounts, dates, coverage and NOPs preserved.';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-confirmed receipt restoration',true)`;
 const [a]=await tx`select a.enrollment_id,a.member_id,a.program_id,a.doi::text,a.branch,a.mas,a.mas_employee_id,a.account_status,m.member_number,p.base_pay::float8 as rate,coalesce(p.pay_balance_total,0)::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum from member_programs a join members m on m.member_id=a.member_id join programs p on p.program_id=a.program_id where a.enrollment_id=${enrollment} for update of a`;
 if(!a||a.member_number!==member||a.program_id!=='DP-0013'||a.doi!=='2022-10-01'||a.rate!==350)throw new Error('Account differs; stop.');
 const before=await tx`select collection_id,or_key,or_number,or_date::text,amount_collected::float8 as amount,month_from,month_to,nop_from,nop_to,date_remitted::text from collections where enrollment_id=${enrollment} and status='Posted' order by or_date,collection_id for update`;
 const [other]=await tx`select c.collection_id,m.member_number,c.or_number,c.or_key,c.legacy_duplicate,c.or_date::text,c.amount_collected::float8 as amount from collections c join members m on m.member_id=c.member_id where c.collection_id=${otherId} for update of c`;
 if(!other||other.member_number!=='PH-41570505'||other.or_date!=='2026-02-03'||other.amount!==180||!['4191S','4191SDUPLICATED'].includes(other.or_key))throw new Error('Other receipt differs; stop.');
 const conflicts=await tx`select collection_id from collections where (or_key in ('4191S','4191SDUPLICATED') or (enrollment_id=${enrollment} and or_date='2026-10-12' and amount_collected=700)) and collection_id not in (${otherId},${newId})`;
 const sales=await tx`select sale_id from sales where upper(regexp_replace(coalesce(or_number,''),'[^A-Za-z0-9]','','g'))='4191S'`;
 if(conflicts.length||sales.length)throw new Error('Another matching receipt exists; review before inserting.');
 if(before.length!==3&&before.length!==4)throw new Error('Unexpected history size.');
 for(const [key,date,amount,from,to,nf,nt] of plan.slice(0,3)){const r=before.find(r=>r.or_key===key);if(!r||r.or_date!==date||r.amount!==amount||r.month_from!==from||r.month_to!==to||r.nop_from!==nf||r.nop_to!==nt)throw new Error(`Previous receipt ${key} differs.`);}
 if(before.length===4&&!before.some(r=>r.collection_id===newId))throw new Error('Unexpected fourth payment.');
 const stamp=new Date().toISOString();let changes=0;
 if(other.or_number!=='4191 S (duplicated)'||!other.legacy_duplicate){await tx`update collections set or_number='4191 S (duplicated)',legacy_duplicate=true where collection_id=${otherId}`;changes++;}
 if(!before.some(r=>r.collection_id===newId)){
  await tx`insert into collections ${tx({collection_id:newId,collection_batch_id:'CBT-LEG-OWNER-70661323-4191S',enrollment_id:enrollment,member_id:a.member_id,member_number:member,program_id:a.program_id,branch:a.branch,mas:a.mas,or_number:'4191 S',or_date:'2026-10-12',amount_collected:700,month_from:'2026-08',month_to:'2026-09',nop_from:47,nop_to:48,date_remitted:'2026-10-12',status:'Posted',created_at:stamp,encoded_by_name:'Owner-confirmed receipt restoration',encoded_at:stamp,remittance_status:'Remitted',linked_remittance_id:null,remittance_amount:null,remittance_breakdown:null,legacy_duplicate:false,collected_by_role:'MAS',accountable_employee_id:a.mas_employee_id,accountable_name:a.mas,accountable_role:'MAS',remittance_method:'Cash'})}`;changes++;
 }
 for(const [key,,,,,,,remitted] of plan.slice(0,3)){const r=before.find(r=>r.or_key===key);if(r.date_remitted!==remitted){await tx`update collections set date_remitted=${remitted} where collection_id=${r.collection_id}`;changes++;}}
 const after=await tx`select collection_id,or_key,or_number,or_date::text,amount_collected::float8 as amount,month_from,month_to,nop_from,nop_to,date_remitted::text from collections where enrollment_id=${enrollment} and status='Posted' order by or_date,collection_id`;
 if(after.length!==4||plan.some(([key,date,amount,from,to,nf,nt,remitted],i)=>{const r=after[i];return r.or_key!==key||r.or_date!==date||r.amount!==amount||r.month_from!==from||r.month_to!==to||r.nop_from!==nf||r.nop_to!==nt||r.date_remitted!==remitted;}))throw new Error('Ledger verification failed.');
 const status=accountState({id:enrollment,memberId:a.member_id,memberNumber:member,programId:a.program_id,doi:a.doi,branch:a.branch,mas:a.mas,basePay:a.rate,payBalanceTotal:a.total,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum},after.map(r=>({id:r.collection_id,enrollmentId:enrollment,orNumber:r.or_number,orDate:r.or_date,amount:r.amount,monthFrom:r.month_from,monthTo:r.month_to,nopFrom:r.nop_from,nopTo:r.nop_to,dateRemitted:r.date_remitted,mas:a.mas})),'2026-10-14').status;
 if(status!==a.account_status){await tx`update member_programs set account_status=${status} where enrollment_id=${enrollment}`;changes++;}
 if(changes)await tx`insert into record_corrections ${tx({correction_id:`COR-4191S-${Date.now().toString(36).toUpperCase()}`,module:'Owner-confirmed receipt restoration',record_id:newId,reason,before_json:{history:before,other,status:a.account_status},after_json:{history:after,other:{...other,or_number:'4191 S (duplicated)',legacy_duplicate:true},status},corrected_at:stamp,encoded_by_name:'Owner-confirmed receipt restoration',encoded_at:stamp})}`;
 console.log(JSON.stringify({apply,changes,member,program:'D-350',payments:after,status,otherMember:'PH-41570505',otherReceipt:'4191 S (duplicated)',otherAmount:180},null,2));
 if(!apply&&changes)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}
finally{await sql.end();}
