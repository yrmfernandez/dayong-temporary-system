/** Owner-requested report removal, October 14, 2026. Uses the expense void lifecycle; dry run unless --apply. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}}),apply=process.argv.includes('--apply');
const id='EXP-20261014044025-7EED';
const reason='Owner requested removal of the expense dated October 10, 2026 from the report (October 14, 2026).';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-requested expense removal',true)`;
 const [r]=await tx`select expense_id,expense_date::text,amount::float8 as amount,branch,description,status,voided_at::text,void_reason from expenses where expense_id=${id} for update`;
 if(!r||r.expense_date!=='2026-10-10'||r.amount!==278||r.branch!=='HINATUAN'||r.description!=='FOOD FOR PIG'||!['Posted','Voided'].includes(r.status))throw new Error('Expense differs; stop for review.');
 const links=await tx`select transaction_id from cash_transactions where reference_id=${id} and lower(coalesce(status,''))='posted'`;
 if(links.length)throw new Error('Linked cash records need review.');
 if(r.status==='Voided'){console.log(JSON.stringify({alreadyRemoved:true,id,amount:r.amount,date:r.expense_date}));return;}
 const stamp=new Date().toISOString();
 await tx`update expenses set status='Voided',voided_at=${stamp},void_reason=${reason} where expense_id=${id}`;
 await tx`insert into record_corrections ${tx({correction_id:`COR-EXP-${Date.now().toString(36).toUpperCase()}`,module:'Expense removal',record_id:id,reason,before_json:r,after_json:{...r,status:'Voided',voided_at:stamp,void_reason:reason},corrected_at:stamp,encoded_by_name:'Owner-requested expense removal',encoded_at:stamp})}`;
 const [{remaining}]=await tx`select count(*)::int as remaining from expenses where expense_id=${id} and lower(status)='posted'`;
 if(remaining)throw new Error('Report exclusion verification failed.');
 console.log(JSON.stringify({apply,id,description:r.description,date:r.expense_date,amount:r.amount,branch:r.branch,status:'Voided',excludedFromPostedReports:true}));
 if(!apply)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}
finally{await sql.end();}
