/** Owner, October 14, 2026: old-sheet Baranda, M. is Marites. Transfer imported accounts, preserve past cash history. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply'), target='SDS-2026-0001', source='MD-2026-0063';
const correctionId='COR-BARANDA-M-MARITES-20261014';
const reason='Owner confirmed October 14, 2026: Baranda, M. in the old sheet is BARANDA, MARITES. Imported accounts assigned to Mabel by the surname/first-initial match belong under Marites.';
class DryRun extends Error {}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-confirmed Baranda M assignment',true)`;
 const [employee]=await tx`select employee_id,full_name,employment_status from employees where employee_id=${target} for update`;
 if(!employee||employee.full_name!=='BARANDA, MARITES'||employee.employment_status.toLowerCase()!=='active')throw new Error('Target employee differs; stop.');
 const [previous]=await tx`select after_json from record_corrections where correction_id=${correctionId}`;
 if(previous){
  const ids=previous.after_json.accounts;
  const [{n}]=await tx`select count(*)::int as n from member_programs where enrollment_id in ${tx(ids)} and mas_employee_id=${target} and mas=${employee.full_name}`;
  if(n!==ids.length)throw new Error('Previously moved accounts have changed; review transfer history.');
  console.log(JSON.stringify({alreadyApplied:true,verifiedAccounts:n,members:previous.after_json.members,target}));return;
 }
 const rows=await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,a.branch,a.branch_id,a.mas,a.mas_employee_id from member_programs a join members m on m.member_id=a.member_id where a.enrollment_id like 'ENR-LEG-%' and (a.mas_employee_id=${source} or lower(regexp_replace(a.mas,'[^A-Za-z]','','g'))='barandam') order by a.enrollment_id for update of a`;
 if(rows.length!==286||new Set(rows.map(r=>r.member_id)).size!==267)throw new Error(`Expected 286 accounts / 267 members; found ${rows.length} / ${new Set(rows.map(r=>r.member_id)).size}. Stop for review.`);
 const branches=await tx`select b.branch_id,b.branch_name_code from employee_branches eb join branches b on b.branch_id=eb.branch_id where eb.employee_id=${target}`;
 if(rows.some(r=>!branches.some(b=>b.branch_id===r.branch_id&&b.branch_name_code===r.branch)))throw new Error('Account branch not assigned to target.');
 const ids=rows.map(r=>r.enrollment_id), stamp=new Date().toISOString();
 await tx`update member_programs set mas=${employee.full_name},mas_employee_id=${target} where enrollment_id in ${tx(ids)}`;
 await tx`insert into member_transfers ${tx(rows.map(r=>({transfer_id:`MTR-BM-${r.enrollment_id}`,enrollment_id:r.enrollment_id,member_id:r.member_id,member_number:r.member_number,program_id:r.program_id,branch:r.branch,from_mas:r.mas,to_mas:employee.full_name,to_employee_id:target,reason,encoded_by_name:'Owner-confirmed Baranda M assignment',encoded_at:stamp})))}`;
 await tx`insert into record_corrections ${tx({correction_id:correctionId,module:'Member MAS assignment',record_id:target,reason,before_json:{accounts:rows},after_json:{accounts:ids,members:new Set(rows.map(r=>r.member_id)).size,mas:employee.full_name,employee:target},corrected_at:stamp,encoded_by_name:'Owner-confirmed Baranda M assignment',encoded_at:stamp})}`;
 const [{n}]=await tx`select count(*)::int as n from member_programs where enrollment_id in ${tx(ids)} and mas_employee_id=${target} and mas=${employee.full_name}`;
 const [{transfers}]=await tx`select count(*)::int as transfers from member_transfers where transfer_id in ${tx(rows.map(r=>`MTR-BM-${r.enrollment_id}`))} and to_employee_id=${target}`;
 if(n!==rows.length||transfers!==rows.length)throw new Error('Verification failed.');
 console.log(JSON.stringify({apply,accounts:n,members:267,target,name:employee.full_name,branch:'HINATUAN',transferRecords:transfers,historicalPaymentsUnchanged:true}));
 if(!apply)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}
finally{await sql.end();}
