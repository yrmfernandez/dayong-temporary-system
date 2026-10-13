/** Owner correction for MD-2026-0053, October 13, 2026: today's incentive must total PHP 196.50.
 * Scoped to today's two entries; does not change program tiers. Default executes and rolls back; --apply commits.
 * All edits are audited; the full calculation and before/after values are kept in Record Corrections.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
const apply=process.argv.includes('--apply');
const verify=process.argv.includes('--verify');
const employee='MD-2026-0053', date='2026-10-13', target=19650;
const correctionId='COR-INC-GOTUAL-20261013';
const cents=value=>Math.round(Number(value??0)*100);
class Rollback extends Error {}
try {
await sql.begin(async tx=>{
const entries=await tx`select collection_id,program_id,or_number,nop_from,nop_to,amount_collected,remittance_amount,remittance_breakdown,forfeited_incentive,linked_remittance_id,remittance_status,fidelity_amount from collections where accountable_employee_id=${employee} and (date_remitted=${date}::date or (encoded_at at time zone 'Asia/Manila')::date=${date}::date) order by collection_id for update`;
const total=entries.reduce((sum,row)=>sum+cents(row.amount_collected)-cents(row.remittance_amount),0);
if(verify){
if(total!==target||entries.length!==2)throw new Error('Daily incentive verification failed.');
const [slip]=await tx`select gross_collection,total_remittance,difference,fidelity_amount from remittances where remittance_id=${entries[0].linked_remittance_id}`;
const expected=entries.reduce((sum,row)=>sum+cents(row.remittance_amount),0)+cents(slip?.fidelity_amount);
const maps=await tx`select collection_id,amount from remittance_collections where remittance_id=${entries[0].linked_remittance_id}`;
const corrections=await tx`select correction_id from record_corrections where correction_id=${correctionId}`;
if(!slip||cents(slip.gross_collection)!==expected||cents(slip.total_remittance)!==expected||cents(slip.difference)!==0||maps.length!==2||maps.some(map=>!entries.some(row=>row.collection_id===map.collection_id&&cents(row.remittance_amount)===cents(map.amount)))||corrections.length!==1)throw new Error('Remittance/correction verification failed.');
console.log(JSON.stringify({employee,date,entries:entries.length,incentive:total/100,remittance:expected/100,balanced:true,correctionRecorded:true}));return;
}
if(total===target){console.log('Already corrected: PHP 196.50.');return;}
if(entries.length!==2||entries.some(row=>row.remittance_status!=='Pending Remittance Approval'||cents(row.forfeited_incentive)!==0))throw new Error('Daily entries changed; review before correction.');
const entry=entries.find(row=>row.collection_id==='COL-20261013082846-7CNY'&&row.program_id==='DP-0009'&&row.nop_from===9&&row.nop_to===9);
const other=entries.find(row=>row.collection_id==='COL-20261013082846-40T7'&&row.program_id==='DP-0031');
if(!entry||!other||cents(entry.amount_collected)!==35000||cents(entry.remittance_amount)!==35000||cents(other.amount_collected)-cents(other.remittance_amount)!==7400)throw new Error('Payment calculation no longer matches the reviewed case.');
const slipId=entry.linked_remittance_id;
if(entries.some(row=>row.linked_remittance_id!==slipId))throw new Error('Entries are no longer on one slip.');
const [slip]=await tx`select * from remittances where remittance_id=${slipId} for update`;
if(!slip||slip.status!=='Pending Approval'||slip.encoded_by_user_id!=='system'||String(slip.cash_count??'').trim()||cents(slip.gross_collection)!==cents(slip.total_remittance)||cents(slip.difference)!==0)throw new Error('Slip is no longer an uncounted automatic pending slip.');
const mappings=await tx`select remittance_collection_id,collection_id,amount from remittance_collections where remittance_id=${slipId} for update`;
if(mappings.length!==entries.length||mappings.some(map=>!entries.some(row=>row.collection_id===map.collection_id&&cents(row.remittance_amount)===cents(map.amount))))throw new Error('Slip mappings do not match the entries.');
const oldExpected=entries.reduce((sum,row)=>sum+cents(row.remittance_amount),0)+cents(slip.fidelity_amount);
if(oldExpected!==cents(slip.gross_collection))throw new Error('Slip expected total does not match its entries and Fidelity.');
const delta=target-total,newIncentive=cents(entry.amount_collected)-cents(entry.remittance_amount)+delta,newRemittance=cents(entry.remittance_amount)-delta;
if(delta!==12250||newRemittance<0||entry.remittance_breakdown?.length!==1)throw new Error('Unexpected correction amount/breakdown.');
const breakdown=entry.remittance_breakdown.map(item=>({...item,incentive:newIncentive/100,remittance:newRemittance/100,incentiveAmount:35}));
const expected=(oldExpected-delta)/100;
await tx`select set_config('app.user_name','Owner-confirmed incentive correction',true)`;
await tx`update collections set remittance_amount=${newRemittance/100},remittance_breakdown=${tx.json(breakdown)} where collection_id=${entry.collection_id}`;
await tx`update remittance_collections set amount=${newRemittance/100} where remittance_id=${slipId} and collection_id=${entry.collection_id}`;
const reason='Owner confirmed GOTUAL incentives for October 13, 2026 total PHP 196.50: D-350 (5Y) NOP 9 PHP 122.50 plus D-370 NOP 44-45 PHP 74.00. Correction applies to these entries only.';
await tx`update remittances set gross_collection=${expected},total_remittance=${expected},difference=0,remarks=concat_ws(' | ',nullif(remarks,''),${reason}::text) where remittance_id=${slipId}`;
const now=new Date().toISOString();
await tx`insert into record_corrections ${tx({correction_id:correctionId,module:'Owner-confirmed incentive',record_id:entry.collection_id,reason,before_json:{employee,date,totalIncentive:total/100,entry,slip:{id:slipId,expected:oldExpected/100}},after_json:{totalIncentive:target/100,entryIncentive:newIncentive/100,entryRemittance:newRemittance/100,breakdown,slip:{id:slipId,expected}},corrected_at:now,encoded_by_name:'Owner-confirmed incentive correction',encoded_at:now})}`;
const [{incentive}]=await tx`select sum(amount_collected-remittance_amount)::float8 as incentive from collections where collection_id in ${tx(entries.map(row=>row.collection_id))}`;
if(cents(incentive)!==target)throw new Error('Correction verification failed.');
console.log(JSON.stringify({employee,date,previousIncentive:total/100,incentive,added:delta/100,remittance:slipId,expected,entryBreakdown:[{or:entry.or_number,incentive:newIncentive/100},{or:other.or_number,incentive:74}]}));
if(!apply)throw new Rollback();
});
} catch(error){if(error instanceof Rollback)console.log('Dry run: all changes rolled back.');else throw error;}
finally{await sql.end();}
