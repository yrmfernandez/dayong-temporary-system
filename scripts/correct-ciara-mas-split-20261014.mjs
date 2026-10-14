/** Owner clarification: four specified New Sales to Amora; Lorna's one stays Nalangan. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}}),apply=process.argv.includes('--apply');
const ids=['SALE-1791949964370-Q100BR','SALE-1791949964424-NTN0MQ','SALE-1791949964444-L04E2V','SALE-1791949964465-IDP0P9'];
const amora='LEG-2026-0007',nalangan='LEG-2026-0099';
const reason='Owner clarified October 14, 2026: Ciara New Sales split is four under Nestor Amora (PH-49964148, PH-49964158, PH-49964163, PH-49964168) and one under Merlene Nalangan (PH-54964332). Correct earlier five-sale reassignment.';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
await tx`select set_config('app.user_name','Owner-clarified Ciara MAS split',true)`;
const [target]=await tx`select full_name from employees where employee_id=${amora} and lower(employment_status)='active'`;
if(target?.full_name!=='AMORA, NESTOR')throw new Error('Target differs.');
const sales=await tx`select sale_id,member_number,program_id,mas,mas_employee_id,accountable_employee_id,linked_remittance_id,amount_paid::float8 as amount from sales where sale_id in ${tx(ids)} and encoded_by_employee_id='DNDO-2026-0075' and (encoded_at at time zone 'Asia/Manila')::date='2026-10-14' for update`;
if(sales.length!==4||sales.some(s=>![amora,nalangan].includes(s.mas_employee_id)||s.linked_remittance_id||s.amount!==500))throw new Error('Sales changed; review.');
const accounts=await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,a.branch,a.mas,a.mas_employee_id from member_programs a join members m on m.member_id=a.member_id where m.member_number in ${tx(sales.map(s=>s.member_number))} for update of a`;
if(accounts.length!==4||accounts.some(a=>a.program_id!=='DP-0021'||![amora,nalangan].includes(a.mas_employee_id)))throw new Error('Accounts differ.');
const stamp=new Date().toISOString();let changes=0;
for(const s of sales)if(s.mas_employee_id!==amora||s.accountable_employee_id!==amora||s.mas!==target.full_name){await tx`update sales set mas=${target.full_name},mas_employee_id=${amora},accountable_employee_id=${amora} where sale_id=${s.sale_id}`;changes++;}
for(const a of accounts)if(a.mas_employee_id!==amora||a.mas!==target.full_name){
await tx`update member_programs set mas=${target.full_name},mas_employee_id=${amora} where enrollment_id=${a.enrollment_id}`;
await tx`insert into member_transfers ${tx({transfer_id:`MTR-CIARA-COR-${a.enrollment_id}`,enrollment_id:a.enrollment_id,member_id:a.member_id,member_number:a.member_number,program_id:a.program_id,branch:a.branch,from_mas:a.mas,to_mas:target.full_name,to_employee_id:amora,reason,encoded_by_name:'Owner-clarified Ciara MAS split',encoded_at:stamp})}`;changes++;}
const [{n}]=await tx`select count(*)::int as n from sales where sale_id in ${tx(ids)} and mas_employee_id=${amora} and accountable_employee_id=${amora}`;
const [{a}]=await tx`select count(*)::int as a from member_programs where enrollment_id in ${tx(accounts.map(a=>a.enrollment_id))} and mas_employee_id=${amora}`;
const [lorna]=await tx`select s.mas_employee_id,s.accountable_employee_id,a.mas_employee_id as account_mas,r.mas_employee_id as slip_mas from sales s join members m on m.member_number=s.member_number join member_programs a on a.member_id=m.member_id and a.program_id=s.program_id join remittances r on r.remittance_id=s.linked_remittance_id where s.sale_id='SALE-1791954964510-032NKM'`;
if(n!==4||a!==4||!lorna||Object.values(lorna).some(v=>v!==nalangan))throw new Error('Four/one split verification failed.');
if(changes)await tx`insert into record_corrections ${tx({correction_id:`COR-CIARA-SPLIT-${Date.now().toString(36).toUpperCase()}`,module:'New Sales MAS split correction',record_id:'DNDO-2026-0075',reason,before_json:{sales,accounts},after_json:{amoraSales:ids,nalanganSale:'SALE-1791954964510-032NKM'},corrected_at:stamp,encoded_by_name:'Owner-clarified Ciara MAS split',encoded_at:stamp})}`;
console.log(JSON.stringify({apply,changes,amoraSales:n,amoraAccounts:a,nalanganSales:1,nalanganAccountAndSlipVerified:true,collectionsUnchanged:true}));
if(!apply&&changes)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
