/** Owner requested October 14, 2026: flag this receipt so another entry may use plain 25516 N. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}}),apply=process.argv.includes('--apply');
const id='COL-20261013105211-WTBG',label='25516 N (to be checked)';
class DryRun extends Error{}
try{await sql.begin(async tx=>{
 await tx`select set_config('app.user_name','Owner-requested receipt review label',true)`;
 const [r]=await tx`select c.collection_id,m.member_number,c.or_number,c.or_key,c.or_date::text,c.amount_collected::float8 as amount,c.month_from,c.month_to,c.nop_from,c.nop_to,c.linked_remittance_id from collections c join members m on m.member_id=c.member_id where c.collection_id=${id} for update of c`;
 if(!r||r.member_number!=='PH-96295172'||!['25516 N',label].includes(r.or_number)||r.or_date!=='2026-10-13'||r.amount!==420)throw new Error('Receipt differs; stop for review.');
 const conflicts=await tx`select collection_id from collections where or_key in ('25516N','25516NTOBECHECKED') and collection_id<>${id} and status='Posted'`;
 if(conflicts.length)throw new Error('Another matching receipt exists; plain OR availability cannot be guaranteed.');
 if(r.or_number!==label){
  await tx`update collections set or_number=${label} where collection_id=${id}`;
  const stamp=new Date().toISOString();
  await tx`insert into record_corrections ${tx({correction_id:`COR-ORCHECK-${Date.now().toString(36).toUpperCase()}`,module:'Receipt review label',record_id:id,reason:'Owner requested adding (to be checked) to PH-96295172 receipt 25516 N so a different entry can use the unmarked OR number. Ownership, amount, dates, coverage and remittance unchanged.',before_json:r,after_json:{...r,or_number:label,or_key:'25516NTOBECHECKED'},corrected_at:stamp,encoded_by_name:'Owner-requested receipt review label',encoded_at:stamp})}`;
 }
 const [after]=await tx`select or_number,or_key from collections where collection_id=${id}`;
 const [{used}]=await tx`select count(*)::int as used from collections where or_key='25516N' and status='Posted'`;
 if(after.or_number!==label||after.or_key!=='25516NTOBECHECKED'||used!==0)throw new Error('Verification failed.');
 console.log(JSON.stringify({apply,member:r.member_number,receipt:after.or_number,plainOrAvailable:used===0,changed:r.or_number!==label}));
 if(!apply&&r.or_number!==label)throw new DryRun();
});}catch(e){if(e instanceof DryRun)console.log('Dry run rolled back.');else throw e;}
finally{await sql.end();}
