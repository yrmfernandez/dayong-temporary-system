/** Import only the two owner-selected 2025 advance payments. Dry run unless --apply.
 * Reuses legacy-sources and account-rules; deterministic legacy IDs make reruns safe.
 * No New Sale or personal/contact details are invented for collections-only records.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {loadLegacySources} from './legacy-sources.mjs';
import {accountState,monthIndex,monthName,todayInManila,forfeitMonthsFor} from '../lib/account-rules.ts';
nextEnv.loadEnvConfig(process.cwd());
const apply=process.argv.includes('--apply');
const file='legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx';
const sourceHash=createHash('sha256').update(readFileSync(file)).digest('hex');
const sources=await loadLegacySources([file]);
const key=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const text=v=>String(v??'').trim();
const hashId=(prefix,...parts)=>`${prefix}-LEG-${createHash('sha1').update(parts.join('|')).digest('hex').slice(0,10).toUpperCase()}`;
const targets=[{first:'Arman',row:8949,or:'13395'},{first:'Juliet',row:8950,or:'13396'}];
const plan=[];
for(const t of targets){
 const source=sources[0], tab=source.tabs.find(t=>t.title==='M2 - COL.');
 if(!tab)throw Error('Reviewed source tab missing.');
 const headers=tab.rows[0], row=tab.rows[t.row-tab.firstRow];
 const cell=name=>row?.[headers.findIndex(h=>key(h)===key(name))];
 const name=text(cell('PH/MEMBER'));
 if(key(name)!==key(`Lugon,${t.first}`) || text(cell('OR NUMBER'))!==t.or || Number(cell('AMOUNT COLLECTED'))!==2760 || text(cell('NOP'))!=='49-60' || key(cell('DAYONG PROGRAM'))!=='D230' || key(cell('BRANCH'))!=='AGDAO' || key(cell('MARKETING AGENT'))!=='CAPACITEC' || !(cell('OR DATE') instanceof Date) || cell('OR DATE').toISOString().slice(0,10)!=='2025-10-09' || !(cell('DATE REMITTED') instanceof Date) || cell('DATE REMITTED').toISOString().slice(0,10)!=='2025-10-10' || !/^october\s+to\s+september\s+2026$/i.test(text(cell('MONTH OF'))))throw Error(`Source row ${t.row} differs from reviewed values.`);
 const ref=`${source.title}|${tab.title}|${t.row}`;
 // Same collection ID formula as migrate-legacy-members; member ID also follows its collections-only grouping.
 const core=['LUGON',t.first.toUpperCase()].sort().join(' ');
 const memberId=hashId('MEM','COLL',`M2 - COL.|${core}`);
 const doi=monthName(monthIndex('2025-10')-48)+'-01';
 if(doi!=='2021-10-01')throw Error('Unexpected DOI inference.');
 const timestamp=cell('Timestamp');
 if(!(timestamp instanceof Date))throw Error('Invalid source timestamp.');
 plan.push({...t,memberId,ref,doi,collectionId:hashId('COL',ref),created:new Date(timestamp.getTime()-8*3600000).toISOString(),reactivation:/^(yes|y|true|1)$/i.test(text(cell('REACTIVATION'))),transferred:/^(yes|y|true|1)$/i.test(text(cell('TRANSFERRED'))),suspended:text(cell('IF SUSPENDED')),sourceStatus:text(cell('STATUS'))});
}
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Selected 2025 workbook import',true)`;
 await tx`select pg_advisory_xact_lock(hashtext('selected-lugon-2025-import'))`;
 const [program]=await tx`select program_id,program_name,base_pay::float8 as rate,pay_balance_total::float8 as total,flexible,max_monthly_payment::float8 as maximum,category_id from programs where program_id='DP-0063'`;
 const branches=await tx`select branch_id,branch_name_code from branches where upper(trim(branch_name_code))='AGDAO'`;
 const agents=await tx`select employee_id,full_name from employees where full_name ilike '%Capacite%'`;
 if(!program || program.program_name!=='D-230' || program.rate!==230 || branches.length!==1 || agents.length!==1 || !agents[0].full_name.toUpperCase().includes('CORAZON'))throw Error('Program, branch or MAS mapping is missing/ambiguous.');
 const branch=branches[0],agent=agents[0],summary=[];
 for(const item of plan){
  // Match existing people without treating a shared surname as identity. Stop on ambiguous matches.
  const matches=await tx`select member_id,member_number from members where lower(trim(surname))='lugon' and lower(trim(first_name))=${item.first.toLowerCase()} and coalesce(trim(middle_name),'')='' and coalesce(trim(name_extension),'')='' for update`;
  const near=await tx`select member_id from members where concat_ws(' ',surname,first_name,middle_name) ilike '%lugon%' and concat_ws(' ',surname,first_name,middle_name) ilike ${'%'+item.first+'%'}`;
  if(matches.length>1 || near.some(r=>!matches.some(m=>m.member_id===r.member_id)))throw Error(`Ambiguous existing identity for source row ${item.row}.`);
  const existing=matches[0];
  const memberId=existing?.member_id??item.memberId;
  if(!existing && (await tx`select 1 from members where member_id=${memberId}`).length)throw Error('Deterministic member ID collision.');
  let number=existing?.member_number;
  if(!number){let n=parseInt(createHash('sha1').update(memberId).digest('hex').slice(0,12),16)%100000000;
   while((await tx`select 1 from members where member_number=${'PH-'+String(n).padStart(8,'0')}`).length)n=(n+1)%100000000;
   number='PH-'+String(n).padStart(8,'0');
  }
  const accounts=await tx`select enrollment_id,doi::text from member_programs where member_id=${memberId} and program_id=${program.program_id} for update`;
  if(accounts.length>1)throw Error('Duplicate existing accounts.');
  const enrollmentId=accounts[0]?.enrollment_id??hashId('ENR',memberId,program.program_id);
  if(accounts[0] && accounts[0].doi!==item.doi)throw Error('Existing account DOI conflicts with the source.');
  const receipt=await tx`select collection_id,member_id,enrollment_id,or_date::text,amount_collected::float8 as amount,month_from,month_to,nop_from,nop_to from collections where collection_id=${item.collectionId} or (or_key=${item.or} and status='Posted') for update`;
  if(receipt.length){
   if(receipt.length!==1 || !existing || !accounts[0] || receipt[0].collection_id!==item.collectionId || receipt[0].member_id!==memberId || receipt[0].enrollment_id!==enrollmentId || receipt[0].or_date!=='2025-10-09' || receipt[0].amount!==2760 || receipt[0].month_from!=='2025-10' || receipt[0].month_to!=='2026-09' || receipt[0].nop_from!==49 || receipt[0].nop_to!==60)throw Error('Receipt already exists with different provenance/data.');
   summary.push({sourceRow:item.row,memberNumber:number,receipt:item.or,result:'Already imported'});continue;
  }
  if((await tx`select 1 from sales where upper(regexp_replace(coalesce(or_number,''),'[^A-Za-z0-9]','','g'))=${item.or}`).length)throw Error('OR already used by a New Sale.');
  const payments=await tx`select collection_id as id,enrollment_id as "enrollmentId",or_date::text as "orDate",or_number as "orNumber",month_from as "monthFrom",month_to as "monthTo",nop_from as "nopFrom",nop_to as "nopTo",amount_collected::float8 as amount,date_remitted::text as "dateRemitted",mas from collections where enrollment_id=${enrollmentId} and status='Posted'`;
  const payment={id:item.collectionId,enrollmentId,orDate:'2025-10-09',orNumber:item.or,monthFrom:'2025-10',monthTo:'2026-09',nopFrom:49,nopTo:60,amount:2760,dateRemitted:'2025-10-10',mas:agent.full_name};
  const account={id:enrollmentId,memberId,memberNumber:number,programId:program.program_id,doi:item.doi,branch:branch.branch_name_code,mas:agent.full_name,basePay:program.rate,payBalanceTotal:program.total,flexible:program.flexible,maxMonthlyPayment:program.maximum,storedStatus:'',forfeitMonths:forfeitMonthsFor(program.category_id)};
  const state=accountState(account,[...payments,payment],todayInManila());
  const stamp=new Date().toISOString(),encoder={encoded_by_name:'Selected 2025 workbook import',encoded_at:stamp};
  if(!existing)await tx`insert into members ${tx({member_id:memberId,member_number:number,surname:'Lugon',first_name:item.first,status:'Active',...encoder})}`;
  if(!accounts[0])await tx`insert into member_programs ${tx({enrollment_id:enrollmentId,member_id:memberId,member_number:number,program_id:program.program_id,doi:item.doi,branch:branch.branch_name_code,branch_id:branch.branch_id,mas:agent.full_name,mas_employee_id:agent.employee_id,remittance_method:'Cash',status:'Active',date_created:item.created,account_status:state.status,...encoder})}`;
  await tx`insert into collections ${tx({collection_id:item.collectionId,collection_batch_id:hashId('CBT','M2 - COL.','AGDAO',agent.full_name,'2025-10-10'),enrollment_id:enrollmentId,member_id:memberId,member_number:number,program_id:program.program_id,branch:branch.branch_name_code,branch_id:branch.branch_id,mas:agent.full_name,mas_employee_id:agent.employee_id,or_number:item.or,or_date:payment.orDate,amount_collected:payment.amount,month_from:payment.monthFrom,month_to:payment.monthTo,nop_from:49,nop_to:60,reactivation:item.reactivation,transferred:item.transferred,suspended:item.suspended,status:'Posted',created_at:item.created,collected_by_role:'MAS',remittance_status:'Remitted',accountable_employee_id:agent.employee_id,accountable_name:agent.full_name,accountable_role:'MAS',remittance_method:'Cash',date_remitted:payment.dateRemitted,...encoder})}`;
  if(accounts[0])await tx`update member_programs set account_status=${state.status} where enrollment_id=${enrollmentId}`;
  await tx`insert into record_corrections ${tx({correction_id:hashId('COR',item.ref),module:'Selected legacy import',record_id:enrollmentId,reason:'Owner requested only Lugon Arman and Lugon Juliet from new 2025 workbook. Collections-only source: preserve NOP49-60, October2025-September2026 advance coverage; DOI October1,2021 inferred from first coverage month and NOP, following existing migration convention. No New Sale, contact, birthdate or financial share invented.',before_json:{sourceRef:item.ref,sourceHash,sourceStatus:item.sourceStatus},after_json:{memberId,memberNumber:number,enrollmentId,collectionId:item.collectionId,or:item.or,amount:2760,doi:item.doi,monthFrom:payment.monthFrom,monthTo:payment.monthTo,nopFrom:49,nopTo:60,status:state.status},corrected_at:stamp,...encoder})}`;
  summary.push({sourceRow:item.row,memberNumber:number,receipt:item.or,amount:2760,coverage:[payment.monthFrom,payment.monthTo],nop:[49,60],doi:item.doi,status:state.status,result:'Imported'});
 }
 console.log(JSON.stringify({apply,summary},null,2));
 mkdirSync('backups',{recursive:true});
 writeFileSync(`backups/lugon-import-${apply?'applied':'preview'}-${Date.now()}.json`,JSON.stringify({sourceHash,summary},null,2));
 if(!apply)throw new DryRun();
 });console.log('Applied or already present.');
}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
