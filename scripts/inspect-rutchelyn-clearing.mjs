// Read-only: trace today's clearing and deleted remittances for the requested employee.
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const employees = await sql`select employee_id as id, full_name from employees where full_name ilike '%BARRIENTOS%' and full_name ilike '%RUTCHELYN%'`;
  console.log(JSON.stringify({ employees }));
  if (employees.length !== 1) throw new Error('Expected one employee.');
  const id = employees[0].id;
  if (process.argv.includes('--summary')) {
    const counts = await sql`select
      (select count(*)::int from sales where encoded_by_employee_id = ${id} and (encoded_at at time zone 'Asia/Manila')::date = '2026-10-21') as sales,
      (select count(*)::int from collections where encoded_by_employee_id = ${id} and (encoded_at at time zone 'Asia/Manila')::date = '2026-10-21') as collections,
      (select count(*)::int from record_corrections where reason like 'Owner requested clearing BARRIENTOS, RUTCHELYN%') as corrections,
      (select count(*)::int from audit_log a where a.action = 'delete' and a.table_name in ('sales', 'collections') and a.record_id in (
        select record_id from record_corrections where reason like 'Owner requested clearing BARRIENTOS, RUTCHELYN%')) as audited_deletions`;
    console.log(JSON.stringify({ counts }));
    process.exitCode = 0;
  } else {
  const clearings = await sql`select clearing_id, branch, employee_id, cleared_date::text, cleared_at, status, covers, remittance_id, closed_reason
    from clearings where employee_id = ${id} or employee_name ilike '%RUTCHELYN%' or encoded_by_employee_id = ${id} order by cleared_at desc limit 15`;
  const entries = await sql`select 'sale' as kind, sale_id as id, date_remitted::text, encoded_at, remittance_status, linked_remittance_id
    from sales where encoded_by_employee_id = ${id} and encoded_at >= '2026-10-21T00:00:00+08:00' and encoded_at < '2026-10-22T00:00:00+08:00'
    union all select 'collection', collection_id, date_remitted::text, encoded_at, remittance_status, linked_remittance_id
    from collections where encoded_by_employee_id = ${id} and encoded_at >= '2026-10-21T00:00:00+08:00' and encoded_at < '2026-10-22T00:00:00+08:00'`;
  const unlinks = await sql`select record_id, table_name, logged_at, user_name, changes_json->'linked_remittance_id' as link
    from audit_log where table_name in ('collections', 'sales') and logged_at >= '2026-10-21T02:54:00Z' and logged_at < '2026-10-21T02:56:00Z'
    and changes_json ? 'linked_remittance_id' order by logged_at`;
  console.log(JSON.stringify({ unlinks }, null, 2));
  const audits = await sql`select logged_at, action, table_name, record_id, user_name,
    case when table_name = 'remittances' then changes_json - 'member_number' else
      jsonb_build_object('status', changes_json->'status', 'remittance_id', changes_json->'remittance_id', 'covers', changes_json->'covers') end as changes
    from audit_log where logged_at >= '2026-10-21T00:00:00+08:00' and (
      (table_name = 'remittances' and action = 'delete') or
      (table_name = 'clearings' and record_id in (select clearing_id from clearings where employee_id = ${id}))) order by logged_at`;
  console.log(JSON.stringify({ clearings, entries, audits }, null, 2));
  }
} finally { await sql.end(); }
