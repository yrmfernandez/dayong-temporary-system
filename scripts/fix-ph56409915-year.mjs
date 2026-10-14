/** Owner confirmed October 14, 2026: PH-56409915's year is 2026, not 12026. Dry run unless --apply. */
import nextEnv from '@next/env';
import postgres from 'postgres';
import { accountState } from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const member='PH-56409915', enrollment='ENR-1791856410022-4RHLMJ', saleId='SALE-1791856410067-LCOV4X';
const oldDate='12026-10-12', date='2026-10-12';
class DryRun extends Error {}
try {
 await sql.begin(async tx=>{
  await tx`select set_config('app.user_name','Owner-confirmed year correction',true)`;
  const [a]=await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,a.doi::text,a.account_status,p.base_pay::float8 as rate,coalesce(p.pay_balance_total,0)::float8 as total,p.flexible,p.max_monthly_payment::float8 as maximum from member_programs a join members m on m.member_id=a.member_id join programs p on p.program_id=a.program_id where a.enrollment_id=${enrollment} for update of a`;
  const [s]=await tx`select sale_id,member_number,program_id,doi::text,or_date::text,date_remitted::text from sales where sale_id=${saleId} for update`;
  if(!a||!s||a.member_number!==member||s.member_number!==member||a.program_id!==s.program_id||![oldDate,date].includes(a.doi)||![oldDate,date].includes(s.doi)||![oldDate,date].includes(s.or_date)) throw new Error('Unexpected member/account/sale dates; stop for review.');
  const payments=(await tx`select collection_id,or_number,or_date::text,month_from,month_to,nop_from,nop_to,amount_collected::float8 as amount from collections where enrollment_id=${enrollment} and status='Posted' for update`).map(r=>({id:r.collection_id,enrollmentId:enrollment,orNumber:r.or_number,orDate:r.or_date,monthFrom:r.month_from,monthTo:r.month_to,nopFrom:r.nop_from,nopTo:r.nop_to,amount:r.amount,dateRemitted:'',mas:''}));
  const status=accountState({id:enrollment,memberId:a.member_id,memberNumber:member,programId:a.program_id,doi:date,branch:'',mas:'',basePay:a.rate,payBalanceTotal:a.total,storedStatus:a.account_status,flexible:a.flexible,maxMonthlyPayment:a.maximum},payments,'2026-10-14').status;
  const changes=[{table:'member_programs',id:enrollment,before:{doi:a.doi,status:a.account_status},after:{doi:date,status}},{table:'sales',id:saleId,before:{doi:s.doi,or_date:s.or_date},after:{doi:date,or_date:date}}];
  console.log(JSON.stringify({member,apply,changes,paymentsChecked:payments.length},null,2));
  if(a.doi===date&&a.account_status===status&&s.doi===date&&s.or_date===date){console.log('Already correct.');return;}
  await tx`update member_programs set doi=${date},account_status=${status} where enrollment_id=${enrollment}`;
  await tx`update sales set doi=${date},or_date=${date} where sale_id=${saleId}`;
  const stamp=new Date().toISOString();
  for(const c of changes) if(JSON.stringify(c.before)!==JSON.stringify(c.after)) await tx`insert into record_corrections ${tx({correction_id:`COR-YEAR-${c.id}-${Date.now().toString(36).toUpperCase()}`,module:'Owner-confirmed year correction',record_id:c.id,reason:'Owner confirmed PH-56409915 year is 2026, not 12026. Month and day remain October 12. Enrollment DOI and New Sale DOI/application date corrected.',before_json:c.before,after_json:c.after,corrected_at:stamp,encoded_by_name:'Owner-confirmed year correction',encoded_at:stamp})}`;
  const [v]=await tx`select a.doi::text as account_doi,s.doi::text as sale_doi,s.or_date::text from member_programs a join sales s on s.sale_id=${saleId} where a.enrollment_id=${enrollment}`;
  if(!v||[v.account_doi,v.sale_doi,v.or_date].some(d=>d!==date))throw new Error('Verification failed.');
  if(!apply)throw new DryRun();
  console.log('Applied and verified.');
 });
}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}
finally{await sql.end();}
