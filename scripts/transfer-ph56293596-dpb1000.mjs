/** Owner-requested transfer to DPB-1000. Without --start=YYYY-MM, inspect only.
 * --start sets the owner-confirmed first covered month; NOP follows existing DOI.
 * Dry run by default; --apply commits the full account/payment correction.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import {accountState,monthIndex,monthName,validMonth,todayInManila,forfeitMonthsFor} from '../lib/account-rules.ts';
import {repriceEntries} from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const start=process.argv.find(a=>a.startsWith('--start='))?.slice(8);
const apply=process.argv.includes('--apply');
if((start&&!validMonth(start)) || (apply&&!start))throw Error('A valid owner-confirmed --start=YYYY-MM is required.');
const member='PH-56293596',accountId='ENR-LEG-C443E4D5B4';
const wanted=['4459M','4485M','8254M','8268M','8287BDUPLICATED','8299M','8074B','8091B','15002B'];
const key=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 const targets=await tx`select program_id,program_name,program_code,base_pay::float8 as rate,pay_balance_total::float8 as total,flexible,max_monthly_payment::float8 as maximum,category_id from programs where upper(regexp_replace(coalesce(program_name,''),'[^A-Za-z0-9]','','g'))='DPB1000' or upper(regexp_replace(coalesce(program_code,''),'[^A-Za-z0-9]','','g'))='DPB1000'`;
 if(targets.length!==1 || targets[0].rate!==1000)throw Error('DPB-1000 is missing, ambiguous or not at PHP1,000.');
 const target=targets[0];
 const accounts=await tx`select enrollment_id,member_id,member_number,program_id,doi::text,account_status,branch,mas from member_programs where member_number=${member} for update`;
 if(accounts.length!==1 || accounts[0].enrollment_id!==accountId || accounts[0].doi!=='2025-01-01' || !['DP-0017',target.program_id].includes(accounts[0].program_id))throw Error('Account differs from reviewed snapshot.');
 const a=accounts[0];
 const before=await tx`select collection_id,member_id,member_number,enrollment_id,program_id,or_number,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to,status from collections where enrollment_id=${accountId} order by or_date,collection_id for update`;
 if(before.length!==9 || before.some(r=>r.member_id!==a.member_id || r.member_number!==member || r.program_id!==a.program_id || r.amount!==1000 || r.status!=='Posted' || !wanted.includes(key(r.or_number))) || new Set(before.map(r=>key(r.or_number))).size!==9)throw Error('Receipt data differs from reviewed snapshot.');
 console.log(JSON.stringify({member,target,existingDoi:a.doi,existingCoverage:[before[0].month_from,before.at(-1).month_to],receipts:before.length,total:9000},null,2));
 if(!start){console.log('Inspection only; pass the confirmed first covered month with --start.');return;}
 if(monthIndex(start)<monthIndex(a.doi.slice(0,7)))throw Error('Coverage cannot precede DOI.');
 const payments=before.map((r,i)=>({id:r.collection_id,enrollmentId:accountId,orDate:r.or_date,orNumber:r.or_number,monthFrom:monthName(monthIndex(start)+i),monthTo:monthName(monthIndex(start)+i),nopFrom:monthIndex(start)+i-monthIndex(a.doi.slice(0,7))+1,nopTo:monthIndex(start)+i-monthIndex(a.doi.slice(0,7))+1,amount:r.amount,dateRemitted:'',mas:''}));
 const state=accountState({id:accountId,memberId:a.member_id,memberNumber:member,programId:target.program_id,doi:a.doi,branch:a.branch,mas:a.mas,basePay:target.rate,payBalanceTotal:target.total,flexible:target.flexible,maxMonthlyPayment:target.maximum,storedStatus:'',forfeitMonths:forfeitMonthsFor(target.category_id)},payments,todayInManila());
 if((await tx`select 1 from sales where member_number=${member}`).length || (await tx`select 1 from member_transfers where enrollment_id=${accountId}`).length)throw Error('Additional account history requires review.');
 await tx`select set_config('app.user_name','Owner-confirmed DPB-1000 transfer',true)`;
 for(const p of payments)await tx`update collections set program_id=${target.program_id},nop_from=${p.nopFrom},nop_to=${p.nopTo},month_from=${p.monthFrom},month_to=${p.monthTo} where collection_id=${p.id}`;
 await tx`update member_programs set program_id=${target.program_id},account_status=${state.status} where enrollment_id=${accountId}`;
 const finance=await repriceEntries((query,params)=>tx.unsafe(query,params),{collectionIds:payments.map(p=>p.id)});
 const saved=await tx`select program_id,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to from collections where enrollment_id=${accountId} order by or_date,collection_id`;
 if(saved.length!==9 || saved.some((r,i)=>r.program_id!==target.program_id || r.amount!==before[i].amount || r.or_date!==before[i].or_date || r.nop_from!==payments[i].nopFrom || r.nop_to!==payments[i].nopTo || r.month_from!==payments[i].monthFrom || r.month_to!==payments[i].monthTo))throw Error('Post-transfer verification failed.');
 console.log(JSON.stringify({coverage:[payments[0].monthFrom,payments.at(-1).monthTo],nop:[payments[0].nopFrom,payments.at(-1).nopTo],status:state.status,financialChanges:finance.changes.length,slips:finance.slips.length,total:9000},null,2));
 const stamp=new Date().toISOString();
 await tx`insert into record_corrections ${tx({correction_id:'COR-DPB1000-'+Date.now().toString(36).toUpperCase(),module:'Program account transfer',record_id:accountId,reason:`Owner confirmed transfer of PH-56293596 to DPB-1000 and first covered month ${start}. Nine PHP1000 receipts each cover one month; NOPs follow retained January1,2025 DOI. Preserve actual amounts/dates, identity, branch/MAS and OR8287B duplicate flag.`,before_json:{account:a,receipts:before},after_json:{program:target.program_id,start,status:state.status,payments,finance},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-confirmed DPB-1000 transfer'})}`;
 if(!apply)throw new DryRun();
 console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
