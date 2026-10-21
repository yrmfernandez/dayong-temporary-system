// Aggregate lock progress only; never prints SQL text or application rows.
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
try{
  const rows=await db`select count(*)::int as imports_waiting,coalesce(max(extract(epoch from now()-query_start)),0)::int as longest_wait_seconds
    from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock'
      and query like 'lock table collections,member_programs,sales%'`;
  console.log(JSON.stringify(rows[0]));
  const blockers=await db`select b.state,b.wait_event_type,count(*)::int as connections,
    max(extract(epoch from now()-b.xact_start))::int as transaction_age_seconds
    from pg_stat_activity a cross join lateral unnest(pg_blocking_pids(a.pid)) as p(pid) join pg_stat_activity b on b.pid=p.pid
    where a.datname=current_database() and a.query like 'lock table collections,member_programs,sales%' and a.wait_event_type='Lock'
    group by b.state,b.wait_event_type`;
  console.log(JSON.stringify({blockerSummary:blockers}));
}finally{await db.end();}
