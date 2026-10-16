/** Read-only program/branch incentive configuration, without member data. */
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const ids=process.argv.slice(2).filter(id=>/^DP-[A-Z0-9]+$/.test(id));
if(!ids.length)throw new Error('Supply program IDs.');
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
try {
  const programs=await db`select program_id,program_name,base_pay::float8 as base_pay from programs where program_id in ${db(ids)}`;
  const tiers=await db`select i.incentive_id,i.program_id,i.role,i.from_month,i.to_month,i.incentive_type,i.mark_up::float8 as mark_up,i.incentive_amount::float8 as incentive_amount,i.non_commissionable,i.branch_id,b.branch_name_code as branch from program_incentives i left join branches b on b.branch_id=i.branch_id where i.program_id in ${db(ids)} order by i.program_id,i.role,i.branch_id,i.from_month,i.to_month`;
  console.log(JSON.stringify({programs,tiers},null,2));
} finally {await db.end();}
