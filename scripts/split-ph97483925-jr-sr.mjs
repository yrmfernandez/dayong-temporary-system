// Owner-confirmed split: existing PH stays JR/D-300 Bracketing; new SR owns DSP-290.
// Dry run unless --apply. Existing account, sale and beneficiary IDs are retained.
import nextEnv from '@next/env';
import postgres from 'postgres';
import {createHash} from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const number='PH-97483925',juniorAccount='ENR-LEG-4F3C2FA919',seniorAccount='ENR-LEG-60FBF0375D',saleId='SALE-LEG-3C06924F7B';
const hashId=(prefix,...parts)=>`${prefix}-LEG-${createHash('sha1').update(parts.join('|')).digest('hex').slice(0,10).toUpperCase()}`;
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-confirmed JR SR member split',true)`;
 const [member]=await tx`select * from members where member_number=${number} for update`;
 if(!member || member.member_id!=='MEM-LEG-3C06924F7B')throw Error('Member differs from reviewed record.');
 const newId=hashId('MEM','SPLIT',member.member_id,'SR');
 const [existing]=await tx`select member_number,name_extension from members where member_id=${newId}`;
 if(existing){
  const accounts=await tx`select enrollment_id,member_id,member_number from member_programs where enrollment_id in (${juniorAccount},${seniorAccount})`;
  const [s]=await tx`select member_number,name_extension from sales where sale_id=${saleId}`;
  if(member.name_extension!=='JR.' || existing.name_extension!=='SR.' || !accounts.some(a=>a.enrollment_id===juniorAccount&&a.member_id===member.member_id&&a.member_number===number) || !accounts.some(a=>a.enrollment_id===seniorAccount&&a.member_id===newId&&a.member_number===existing.member_number) || s?.member_number!==existing.member_number || s.name_extension!=='SR.')throw Error('Partial or inconsistent prior split.');
  console.log(JSON.stringify({alreadySplit:true,junior:number,senior:existing.member_number}));return;
 }
 const accounts=await tx`select enrollment_id,member_id,member_number,program_id,doi::text,branch,mas,account_status from member_programs where member_id=${member.member_id} for update`;
 if(accounts.length!==2 || !accounts.some(a=>a.enrollment_id===juniorAccount&&a.program_id==='DP-0067'&&a.doi==='2023-02-01') || !accounts.some(a=>a.enrollment_id===seniorAccount&&a.program_id==='DP-0021'&&a.doi==='2026-09-30') || accounts.some(a=>a.branch!=='BUHANGIN'))throw Error('Accounts differ from reviewed snapshot.');
 const sales=await tx`select sale_id,member_number,program_id,or_date::text,amount_paid::float8 as amount,birthdate::text,address,member_contact,claimant_name,claimant_contact from sales where member_number=${number} for update`;
 if(sales.length!==1 || sales[0].sale_id!==saleId || sales[0].program_id!=='DP-0021' || sales[0].or_date!=='2026-09-30' || sales[0].amount!==500)throw Error('Buhangin New Sale differs from reviewed record.');
 const collections=await tx`select collection_id,enrollment_id,member_id,member_number,program_id,amount_collected::float8 as amount from collections where member_id=${member.member_id} for update`;
 if(collections.length!==10 || collections.some(c=>c.enrollment_id!==juniorAccount || c.program_id!=='DP-0067' || c.amount!==300))throw Error('Collection history differs from reviewed snapshot.');
 const beneficiaries=await tx`select beneficiary_id,sale_id from beneficiaries where member_id=${member.member_id} for update`;
 if(beneficiaries.some(b=>b.sale_id!==saleId))throw Error('Beneficiaries need separate ownership review.');
 // The master was created from the SR New Sale. Do not give its personal fields to JR.
 const sale=sales[0];
 const date=v=>v instanceof Date?v.toISOString().slice(0,10):String(v??'');
 if(date(member.birthdate)!==date(sale.birthdate) || String(member.address??'')!==String(sale.address??''))throw Error('Master personal fields differ from SR New Sale; review before separating.');
 let n=parseInt(createHash('sha1').update(newId).digest('hex').slice(0,12),16)%100000000;
 while((await tx`select 1 from members where member_number=${'PH-'+String(n).padStart(8,'0')}`).length)n=(n+1)%100000000;
 const newNumber='PH-'+String(n).padStart(8,'0'),stamp=new Date().toISOString();
 const {row_seq,...copy}=member;
 await tx`insert into members ${tx({...copy,member_id:newId,member_number:newNumber,name_extension:'SR.',encoded_by_name:'Owner-confirmed JR SR member split',encoded_at:stamp})}`;
 await tx`update member_programs set member_id=${newId},member_number=${newNumber} where enrollment_id=${seniorAccount}`;
 await tx`update sales set member_number=${newNumber},name_extension='SR.' where sale_id=${saleId}`;
 await tx`update beneficiaries set member_id=${newId} where member_id=${member.member_id} and sale_id=${saleId}`;
 await tx`update member_transfers set member_id=${newId},member_number=${newNumber} where enrollment_id=${seniorAccount}`;
 await tx`update members set name_extension='JR.',birthdate=null,birthplace=null,gender=null,age=null,civil_status=null,member_contact=null,address=null,claimant_name=null,claimant_contact=null,claimant_same_address=false,claimant_address=null where member_id=${member.member_id}`;
 const after=await tx`select m.member_number,m.name_extension,mp.enrollment_id,mp.program_id,(select count(*)::int from collections c where c.enrollment_id=mp.enrollment_id) as collections from members m join member_programs mp on mp.member_id=m.member_id where m.member_id in (${member.member_id},${newId}) order by m.member_number`;
 if(after.length!==2 || !after.some(a=>a.member_number===number&&a.name_extension==='JR.'&&a.program_id==='DP-0067'&&a.collections===10) || !after.some(a=>a.member_number===newNumber&&a.name_extension==='SR.'&&a.program_id==='DP-0021'&&a.collections===0))throw Error('Split verification failed.');
 await tx`insert into record_corrections ${tx({correction_id:hashId('COR','JR-SR-SPLIT',member.member_id),module:'Member split',record_id:member.member_id,reason:'Owner confirmed PH-97483925 is JR for D-300 Bracketing, while SR owns DSP-290. Buhangin New Sale M2-NS row188 dated September30,2026 belongs to SR. Separate identity and source personal details without altering payments or financial fields.',before_json:{member,accounts,collections,saleId,beneficiaryIds:beneficiaries.map(b=>b.beneficiary_id)},after_json:{junior:number,senior:newNumber,seniorMemberId:newId,accounts:after,personalDetailsAssignedTo:'SR',paymentTotal:3000,newSaleTotal:500},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Owner-confirmed JR SR member split'})}`;
 console.log(JSON.stringify({junior:number,senior:newNumber,accounts:after,movedNewSales:1,movedBeneficiaries:beneficiaries.length,collectionsTotal:3000,newSaleTotal:500},null,2));
 if(!apply)throw new DryRun();console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await sql.end();}
