// Read-only slip/link/status audit; no member personal data printed.
import nextEnv from '@next/env';import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const id=process.argv[2];if(!id)throw Error('Pass remittance ID.');
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
try{
 const slip=await sql`select remittance_id,status,remittance_type,branch,date_remitted::text,gross_collection::float8,total_remittance::float8,difference::float8,collection_count,created_at,decision_at from remittances where remittance_id=${id}`;
 const links=await sql`select r.remittance_collection_id,r.collection_id,r.amount::float8,s.remittance_status,s.linked_remittance_id,s.amount_paid::float8 as sale_paid,s.remittance_amount::float8 as sale_share,s.program_id,s.encoded_at,s.encoded_by_employee_id from remittance_collections r left join sales s on s.sale_id=r.collection_id where r.remittance_id=${id}`;
 console.log(JSON.stringify({slip,links},null,2));
 const ids=links.map(r=>r.collection_id);
 if(ids.length){
 console.log(JSON.stringify({otherSlips:await sql`select rc.collection_id,r.remittance_id,r.status,r.remittance_type,r.created_at from remittance_collections rc join remittances r on r.remittance_id=rc.remittance_id where rc.collection_id in ${sql(ids)} order by r.created_at`,audit:await sql`select logged_at,action,table_name,record_id,jsonb_strip_nulls(jsonb_build_object('status',changes_json->'status','remittance_status',changes_json->'remittance_status','linked_remittance_id',changes_json->'linked_remittance_id')) as status_changes from audit_log where record_id in ${sql([...ids,id])} and table_name in ('remittances','sales') order by logged_at desc limit 35`},null,2));
 }
}finally{await sql.end();}

