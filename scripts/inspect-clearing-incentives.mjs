import postgres from 'postgres';
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
try {
const rows=await sql`with entries as (
select 'Collections' as kind,collection_id as id,accountable_employee_id as employee,branch,or_date,date_remitted,encoded_at,coalesce(forfeited_incentive,0)::float8 as forfeited,linked_remittance_id as slip,date_remitted_reason as reason from collections where forfeited_incentive>0 and encoded_at>='2026-10-08'
union all select 'New Sales',sale_id,accountable_employee_id,branch,coalesce(or_date,doi),date_remitted,encoded_at,coalesce(forfeited_incentive,0)::float8,linked_remittance_id,date_remitted_reason from sales where forfeited_incentive>0 and encoded_at>='2026-10-08'
) select e.kind,e.id,e.employee,e.branch,e.or_date::text,e.date_remitted::text,to_char(e.encoded_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI') as encoded,e.forfeited,e.slip,e.reason,r.status as slip_status,r.date_remitted::text as slip_date,r.time_remitted,c.clearing_id,to_char(c.cleared_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI') as cleared,c.status as clearing_status,c.covers
from entries e left join remittances r on r.remittance_id=e.slip left join lateral(select * from clearings where employee_id=e.employee and lower(trim(branch))=lower(trim(e.branch)) and status<>'Removed' and covers in ('Both',e.kind) and cleared_at<=e.encoded_at order by cleared_at desc limit 1)c on true order by e.encoded_at desc`;
const groups=new Map();for(const row of rows){const key=JSON.stringify([row.employee,row.branch,row.or_date,row.date_remitted,row.slip,row.slip_date,row.time_remitted,row.cleared,Boolean(row.reason)]);const group=groups.get(key)??{...row,count:0,total:0};group.count++;group.total+=row.forfeited;groups.set(key,group);} console.log(JSON.stringify([...groups.values()].map(({id,forfeited,...row})=>row),null,2));
} finally {await sql.end();}

