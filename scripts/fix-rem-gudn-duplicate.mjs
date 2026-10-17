// Retire only the stale duplicate; never change/approve its already-remitted sale.
import nextEnv from '@next/env';import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const apply=process.argv.includes('--apply'),id='REM-20261017074154-GUDN',approved='REM-20261017074155-FU2X',saleId='SALE-1792209619986-F0OT6Q';
class DryRun extends Error{}
try{await db.begin(async tx=>{
 const slips=await tx`select remittance_id,status,gross_collection::float8,total_remittance::float8,fidelity_amount::float8,rejection_reason from remittances where remittance_id in (${id},${approved}) order by remittance_id for update`;
 const stale=slips.find(r=>r.remittance_id===id),kept=slips.find(r=>r.remittance_id===approved);
 const [sale]=await tx`select remittance_status,linked_remittance_id,remittance_amount::float8 from sales where sale_id=${saleId} for update`;
 const links=await tx`select remittance_id,collection_id,amount::float8 from remittance_collections where remittance_id in (${id},${approved})`;
 if(!stale || !kept || kept.status!=='Approved' || sale?.remittance_status!=='Remitted' || sale.linked_remittance_id!==approved || sale.remittance_amount!==220 || links.length!==2 || links.some(r=>r.collection_id!==saleId || r.amount!==220) || slips.some(r=>r.gross_collection!==220 || r.total_remittance!==220 || Number(r.fidelity_amount)!==0))throw Error('Duplicate repair conditions differ; stop.');
 if(stale.status==='Rejected' && stale.rejection_reason?.includes(approved)){console.log('Already retired; approved sale intact.');return;}
 if(stale.status!=='Pending Approval')throw Error('Stale slip is no longer pending.');
 await tx`select set_config('app.user_name','Duplicate remittance correction',true)`;
 const reason=`Duplicate submission of the same New Sale; superseded by approved ${approved}. Sale remains Remitted on that approved slip. No second cash receipt or payment.`;
 await tx`update remittances set status='Rejected',rejection_reason=${reason},decision_at=now(),decision_by_name='Duplicate remittance correction' where remittance_id=${id}`;
 const stamp=new Date().toISOString();
 await tx`insert into record_corrections ${tx({correction_id:'COR-REM-GUDN-DUPLICATE',module:'Duplicate remittance',record_id:id,reason,before_json:{slip:stale,sale,links},after_json:{status:'Rejected',approvedSlip:approved,saleUnchanged:true,amountsUnchanged:true},corrected_at:stamp,encoded_at:stamp,encoded_by_name:'Duplicate remittance correction'})}`;
 console.log(JSON.stringify({retired:id,approvedSlip:approved,saleUnchanged:true,amount:220}));
 if(!apply)throw new DryRun();console.log('Applied.');
 });}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}finally{await db.end();}
