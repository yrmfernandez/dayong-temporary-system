/** Recalculate TANGAL's OR 17552B using the current D-320 Collector tier. Default: rollback; --apply writes; --verify reads. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
const id='COL-20261013081610-4ARZ',correctionId='COR-INC-TANGAL-20261013';
const cents=value=>Math.round(Number(value??0)*100);
const apply=process.argv.includes('--apply'),verify=process.argv.includes('--verify');
class Rollback extends Error {}
try {
await sql.begin(async tx=>{
const [entry]=await tx`select * from collections where collection_id=${id} for update`;
if(!entry||entry.accountable_employee_id!=='MD-2026-0025'||entry.encoded_by_employee_id!=='MD-2026-0077'||entry.program_id!=='DP-0011'||entry.nop_from!==29||entry.nop_to!==29||entry.collected_by_role!=='Collector'||cents(entry.amount_collected)!==32000||cents(entry.forfeited_incentive)!==0)throw new Error('Entry differs from reviewed case.');
const [slip]=await tx`select * from remittances where remittance_id=${entry.linked_remittance_id} for update`;
const maps=await tx`select * from remittance_collections where remittance_id=${entry.linked_remittance_id} for update`;
if(!slip||maps.length!==1||maps[0].collection_id!==id||cents(maps[0].amount)!==cents(entry.remittance_amount))throw new Error('Slip links differ from reviewed case.');
const rows=await tx`select collection_id from collections where linked_remittance_id=${slip.remittance_id}`;
if(rows.length!==1)throw new Error('Slip has additional entries.');
const tiers=await tx`select incentive_id,mark_up,incentive_amount,incentive_type,branch_id from program_incentives where program_id=${entry.program_id} and role='Collector' and from_month<=29 and to_month>=29 and (branch_id is null or branch_id=${entry.branch_id}) order by branch_id nulls last`;
const scoped=tiers.filter(tier=>tier.branch_id===entry.branch_id),effective=scoped.length?scoped:tiers.filter(tier=>tier.branch_id===null);
if(effective.length!==1)throw new Error('Collector tier is missing or ambiguous.');
const tier=effective[0];
if(tier.incentive_type!=='percentage'||Number(tier.incentive_amount)!==10||cents(tier.mark_up)!==0)throw new Error('Configured tier changed; review required.');
const incentive=32,remittance=288,expected=remittance+Number(slip.fidelity_amount??0);
if(verify){
const corrections=await tx`select correction_id from record_corrections where correction_id=${correctionId}`;
if(cents(entry.amount_collected)-cents(entry.remittance_amount)!==3200||cents(slip.gross_collection)!==cents(expected)||cents(slip.total_remittance)!==cents(expected)||cents(slip.difference)!==0||corrections.length!==1)throw new Error('Correction verification failed.');
console.log(JSON.stringify({or:entry.or_number,incentive,expected,balanced:true,correctionRecorded:true}));return;
}
if(cents(entry.remittance_amount)===28800){console.log('Already corrected.');return;}
if(entry.remittance_status!=='Pending Remittance Approval'||slip.status!=='Pending Approval'||slip.encoded_by_user_id!=='system'||String(slip.cash_count??'').trim()||cents(slip.gross_collection)!==cents(entry.remittance_amount)+cents(slip.fidelity_amount)||cents(slip.total_remittance)!==cents(slip.gross_collection)||cents(slip.difference)!==0||entry.remittance_breakdown?.length!==1)throw new Error('Slip no longer matches the reviewed automatic pending case.');
const breakdown=entry.remittance_breakdown.map(item=>({...item,tierId:tier.incentive_id,incentiveAmount:10,incentive,remittance}));
await tx`select set_config('app.user_name','Tangal incentive correction',true)`;
await tx`update collections set remittance_amount=${remittance},remittance_breakdown=${tx.json(breakdown)} where collection_id=${id}`;
await tx`update remittance_collections set amount=${remittance} where remittance_collection_id=${maps[0].remittance_collection_id}`;
const reason='Owner requested correction of TANGAL, MARY JEAN, MATINA, encoded by ABESIA, DARYL JANE: OR 17552B, D-320 NOP 29, Collector incentive recalculated at configured 10% (PHP 32.00).';
await tx`update remittances set gross_collection=${expected},total_remittance=${expected},difference=0,remarks=concat_ws(' | ',nullif(remarks,''),${reason}::text) where remittance_id=${slip.remittance_id}`;
const now=new Date().toISOString();
await tx`insert into record_corrections ${tx({correction_id:correctionId,module:'Collector incentive correction',record_id:id,reason,before_json:{incentive:(cents(entry.amount_collected)-cents(entry.remittance_amount))/100,remittance:Number(entry.remittance_amount),breakdown:entry.remittance_breakdown,slip:{id:slip.remittance_id,expected:Number(slip.gross_collection)}},after_json:{incentive,remittance,breakdown,slip:{id:slip.remittance_id,expected}},corrected_at:now,encoded_by_name:'Tangal incentive correction',encoded_at:now})}`;
console.log(JSON.stringify({or:entry.or_number,previousIncentive:(cents(entry.amount_collected)-cents(entry.remittance_amount))/100,incentive,remittance,expected,slip:slip.remittance_id}));
if(!apply)throw new Rollback();
});
}catch(error){if(error instanceof Rollback)console.log('Dry run: all changes rolled back.');else throw error;}
finally{await sql.end();}
