// Read-only trace of the reported PHP9.20 remittance discrepancy.
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
 console.log(JSON.stringify({programs:await sql`select program_id,program_code,program_name from programs where program_id in ('DP-0022','DP-0023')`}));
 const slips = await sql`select remittance_id,status,remittance_type,branch,date_remitted::text,gross_collection::float8 as expected,total_remittance::float8 as actual,difference::float8,created_at from remittances where abs(coalesce(difference,0))>0.001 and status not in ('Rejected','Voided') order by created_at desc limit 30`;
 console.log(JSON.stringify({slips},null,2));
 const ids = slips.filter(s=>Math.abs(Math.abs(s.difference)-9.2)<0.001 || ['Pending Approval','Discrepancy'].includes(s.status)).map(s=>s.remittance_id);
 if (!ids.length) process.exitCode=0;
 else {
 const links=await sql`select rc.remittance_id,rc.collection_id,rc.amount::float8 as linked_share,coalesce(c.or_number,s.or_number) as receipt,coalesce(c.member_number,s.member_number) as member,coalesce(c.program_id,s.program_id) as program_id,c.nop_from,c.nop_to,c.amount_collected::float8,c.remittance_amount::float8,c.remittance_breakdown,s.amount_paid::float8,s.remittance_amount::float8 as sale_share from remittance_collections rc left join collections c on c.collection_id=rc.collection_id left join sales s on s.sale_id=rc.collection_id where rc.remittance_id in ${sql(ids)} order by rc.remittance_id,rc.collection_id`;
 console.log(JSON.stringify({linkTotals:ids.map(id=>({id,count:links.filter(l=>l.remittance_id===id).length,total:Math.round(links.filter(l=>l.remittance_id===id).reduce((n,l)=>n+l.linked_share,0)*100)/100}))},null,2));
 const audit=await sql`select logged_at,action,table_name,record_id,changes_json from audit_log where record_id in ${sql([...ids,...links.map(l=>l.collection_id)])} and table_name in ('remittances','collections','sales') order by logged_at desc limit 80`;
 // Only financial/coverage changes; omit identifying personal fields.
 const filtered=audit.map(a=>({...a,changes_json:Object.fromEntries(Object.entries(a.changes_json??{}).filter(([key])=>['gross_collection','total_remittance','difference','program_id','amount_collected','nop_from','nop_to','remittance_amount','remittance_breakdown'].includes(key)))})).filter(a=>Object.keys(a.changes_json).length);
 console.log(JSON.stringify({audit:filtered,affectedEntries:links.filter(l=>filtered.some(a=>a.record_id===l.collection_id))},null,2));
 console.log(JSON.stringify({slipHistory:await sql`select logged_at,action,record_id,changes_json from audit_log where table_name='remittances' and record_id in ${sql(ids)} order by logged_at`},null,2));
 }
} finally { await sql.end(); }
