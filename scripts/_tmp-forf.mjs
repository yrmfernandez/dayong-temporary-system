import nextEnv from "@next/env"; import postgres from "postgres";
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
console.log(/postgres\.([a-z0-9]+)/.exec(process.env.DIRECT_DATABASE_URL)?.[1]);
// entries linked to more than one slip (resubmitted) and now forfeited
const rows = await sql`select rc.collection_id, array_agg(r.remittance_id||':'||r.status||':'||coalesce(r.date_remitted::text,'')||' '||coalesce(r.time_remitted,'') order by r.created_at) slips,
  coalesce(c.forfeited_incentive, s.forfeited_incentive) forf, coalesce(c.or_date, s.or_date)::text or_date
  from remittance_collections rc join remittances r on r.remittance_id=rc.remittance_id
  left join collections c on c.collection_id=rc.collection_id left join sales s on s.sale_id=rc.collection_id
  group by rc.collection_id, c.forfeited_incentive, s.forfeited_incentive, c.or_date, s.or_date having count(*)>1 limit 20`;
for (const r of rows) console.log(r.collection_id, r.or_date, r.forf, r.slips.join(' | '));
console.log('resubmitted', rows.length);
await sql.end();
