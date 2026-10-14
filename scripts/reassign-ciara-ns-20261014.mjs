/** Owner-requested correction of Ciara's October 14 New Sales from Nestor to Merlene. Dry run unless --apply. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}}),apply=process.argv.includes('--apply');
const clerk='DNDO-2026-0075',from='LEG-2026-0007',to='LEG-2026-0099',day='2026-10-14';
const ids=['SALE-1791949964370-Q100BR','SALE-1791949964424-NTN0MQ','SALE-1791949964444-L04E2V','SALE-1791949964465-IDP0P9','SALE-1791954964510-032NKM'];
const reason='Owner requested October 14, 2026: Ciara today New Sales recorded under Nestor Amora belong to Nalangan Merlene; align sales, member-program assignments and linked New Sales remittance for the report.';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
await tx`select set_config('app.user_name','Owner-requested Ciara New Sales reassignment',true)`;
const [target]=await tx`select employee_id,full_name,employment_status from employees where employee_id=${to} for update`;
if(!target||target.full_name!=='NALANGAN, MERLENE'||target.employment_status.toLowerCase()!=='active')throw new Error('Target differs.');
const branch=await tx`select b.branch_name_code from employee_branches eb join branches b on b.branch_id=eb.branch_id where eb.employee_id=${to}`;
const sales=await tx`select sale_id,member_number,program_id,mas,mas_employee_id,accountable_employee_id,branch,date_remitted::text,amount_paid::float8 as amount,linked_remittance_id,remittance_status from sales where sale_id in ${tx(ids)} and encoded_by_employee_id=${clerk} and (encoded_at at time zone 'Asia/Manila')::date=${day}::date for update`;
if(sales.length!==5||sales.reduce((n,s)=>n+s.amount,0)!==2320||sales.some(s=>![from,to].includes(s.mas_employee_id)||![from,to].includes(s.accountable_employee_id)||!branch.some(b=>b.branch_name_code===s.branch)))throw new Error('Unexpected sales or branch.');
const more=await tx`select sale_id from sales where encoded_by_employee_id=${clerk} and (encoded_at at time zone 'Asia/Manila')::date=${day}::date and mas_employee_id=${from} and sale_id not in ${tx(ids)}`;
if(more.length)throw new Error('New matching sales appeared; review scope.');
const slipIds=[...new Set(sales.map(s=>s.linked_remittance_id).filter(Boolean))];
const slips=slipIds.length?await tx`select remittance_id,mas,mas_employee_id,accountable_employee_id,status from remittances where remittance_id in ${tx(slipIds)} for update`:[];
for(const r of slips){
if(!['Pending Approval','Discrepancy'].includes(r.status)||![from,to].includes(r.mas_employee_id)||![from,to].includes(r.accountable_employee_id))throw new Error('Slip no longer pending or belongs elsewhere.');
const others=await tx`select collection_id as id from collections where linked_remittance_id=${r.remittance_id} union all select sale_id from sales where linked_remittance_id=${r.remittance_id} and sale_id not in ${tx(ids)} union all select collection_id from remittance_collections where remittance_id=${r.remittance_id} and collection_id not in ${tx(ids)}`;
if(others.length)throw new Error('Shared slip contains out-of-scope entries.');
}
const accounts=await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,a.branch,a.mas,a.mas_employee_id from member_programs a join members m on m.member_id=a.member_id where m.member_number in ${tx(sales.map(s=>s.member_number))} for update of a`;
const selected=sales.map(s=>accounts.find(a=>a.member_number===s.member_number&&a.program_id===s.program_id));
if(selected.some(a=>!a||![from,to].includes(a.mas_employee_id)))throw new Error('Member account differs.');
const changedAccounts=selected.filter(a=>a.mas_employee_id!==to||a.mas!==target.full_name),stamp=new Date().toISOString();
let changed=0;
for(const s of sales)if(s.mas_employee_id!==to||s.accountable_employee_id!==to||s.mas!==target.full_name){await tx`update sales set mas=${target.full_name},mas_employee_id=${to},accountable_employee_id=${to} where sale_id=${s.sale_id}`;changed++;}
for(const a of changedAccounts){
await tx`update member_programs set mas=${target.full_name},mas_employee_id=${to} where enrollment_id=${a.enrollment_id}`;
await tx`insert into member_transfers ${tx({transfer_id:`MTR-CIARA-${a.enrollment_id}`,enrollment_id:a.enrollment_id,member_id:a.member_id,member_number:a.member_number,program_id:a.program_id,branch:a.branch,from_mas:a.mas,to_mas:target.full_name,to_employee_id:to,reason,encoded_by_name:'Owner-requested Ciara New Sales reassignment',encoded_at:stamp})}`;changed++;
}
for(const r of slips)if(r.mas_employee_id!==to||r.accountable_employee_id!==to||r.mas!==target.full_name){await tx`update remittances set mas=${target.full_name},mas_employee_id=${to},accountable_employee_id=${to} where remittance_id=${r.remittance_id}`;changed++;}
const [{n}]=await tx`select count(*)::int as n from sales where sale_id in ${tx(ids)} and mas=${target.full_name} and mas_employee_id=${to} and accountable_employee_id=${to}`;
const [{a}]=await tx`select count(*)::int as a from member_programs where enrollment_id in ${tx(selected.map(a=>a.enrollment_id))} and mas_employee_id=${to} and mas=${target.full_name}`;
if(n!==5||a!==5)throw new Error('Verification failed.');
if(changed)await tx`insert into record_corrections ${tx({correction_id:`COR-CIARA-NS-${Date.now().toString(36).toUpperCase()}`,module:'New Sales MAS correction',record_id:clerk,reason,before_json:{sales,accounts:selected,slips},after_json:{saleIds:ids,toEmployee:to,toName:target.full_name,accounts:selected.map(a=>a.enrollment_id),slips:slipIds,amount:2320},corrected_at:stamp,encoded_by_name:'Owner-requested Ciara New Sales reassignment',encoded_at:stamp})}`;
console.log(JSON.stringify({apply,changes:changed,sales:n,memberAccounts:a,accountTransfers:changedAccounts.length,pendingSlips:slips.length,amount:2320,to:target.full_name,members:sales.map(s=>s.member_number)}));
if(!apply&&changed)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
