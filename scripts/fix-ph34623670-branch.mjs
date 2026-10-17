// Owner-requested current account branch correction. Dry run unless --apply.
// Historical receipts retain the branch where they were recorded.
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const member=arg('member')||'PH-34623670';
const targetName=(arg('to')||'MAWAB').toUpperCase();
const account=arg('account')||'ENR-LEG-DEB62351C9';
const expectedFrom=(arg('from')||'NABUNTURAN').toUpperCase();
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-requested branch correction',true)`;
 const targets=await tx`select branch_id,branch_name_code from branches where upper(trim(branch_name_code))=${targetName}`;
 if(targets.length!==1)throw Error('Target branch missing or ambiguous.');
 const branch=targets[0];
 const rows=await tx`select enrollment_id,member_id,member_number,program_id,branch,branch_id,mas,mas_employee_id from member_programs where member_number=${member} for update`;
 if(rows.length!==1 || rows[0].enrollment_id!==account || ![expectedFrom,branch.branch_name_code].includes(rows[0].branch))throw Error('Account differs from reviewed snapshot.');
 const a=rows[0];
 const assignments=await tx`select branch_id from employee_branches where employee_id=${a.mas_employee_id}`;
 console.log(JSON.stringify({member:a.member_number,account:a.enrollment_id,from:a.branch,to:branch.branch_name_code,masEmployee:a.mas_employee_id,masAssignedToTarget:assignments.some(b=>b.branch_id===branch.branch_id)}));
 if(a.branch===branch.branch_name_code && a.branch_id===branch.branch_id){console.log('Already corrected.');return;}
 const stamp=new Date().toISOString();
 await tx`update member_programs set branch=${branch.branch_name_code},branch_id=${branch.branch_id} where enrollment_id=${a.enrollment_id}`;
 await tx`insert into record_corrections ${tx({correction_id:'COR-BRANCH-'+Date.now().toString(36).toUpperCase(),module:'Member account branch correction',record_id:a.enrollment_id,reason:`Owner requested ${member} branch to ${branch.branch_name_code}. Correct current account branch, preserve current MAS and historical receipt branches.`,before_json:a,after_json:{...a,branch:branch.branch_name_code,branch_id:branch.branch_id},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-requested branch correction'})}`;
 const [saved]=await tx`select branch,branch_id,mas_employee_id from member_programs where enrollment_id=${a.enrollment_id}`;
 if(saved.branch!==branch.branch_name_code || saved.branch_id!==branch.branch_id || saved.mas_employee_id!==a.mas_employee_id)throw Error('Branch verification failed.');
 if(!apply)throw new DryRun();
 console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
