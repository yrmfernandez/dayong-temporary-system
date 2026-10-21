/**
 * Correct older Clearing lines ticked Both when only one kind was actually encoded.
 * Uses the Clearing page's 60-day window and latest-clearing ownership rules.
 * Today, Removed lines, both-kind lines and lines with no entries are never changed.
 * Preview: node scripts/fix-older-clearing-covers.mjs
 * Production: node scripts/prod.mjs node scripts/fix-older-clearing-covers.mjs
 * Add --apply to write; Audit Log and Record Corrections retain the change.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
const actor = "Older clearing covers correction";
const reason = "Owner requested correction of older clearings ticked Both although only New Sales or Collections were remitted; retain only the kind with encoded entries.";

try {
  await sql.begin(async (tx) => {
    // Keep the preview, updates and readback on a consistent snapshot. Applying also
    // prevents concurrent encoding from adding a kind while it is being unticked.
    await tx`set transaction isolation level repeatable read`;
    if (apply) await tx`lock table clearings, sales, collections in share row exclusive mode`;
    const [{ today }] = await tx`select (now() at time zone 'Asia/Manila')::date::text as today`;
    const rows = await tx`
      with live as (
        select *, to_char(cleared_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as stamp
        from clearings where status <> 'Removed' and cleared_date >= ${today}::date - 60
      ), entries as (
        select 'Collections' as kind, accountable_employee_id as person, branch, date_remitted,
          to_char(encoded_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as encoded,
          remittance_status
        from collections where lower(coalesce(status, '')) = 'posted'
          and coalesce(accountable_role, '') <> 'DTO' and date_remitted >= ${today}::date - 120
          and date_remitted <= (select max(cleared_date) from live)
        union all
        select 'New Sales', coalesce(accountable_employee_id, mas_employee_id), branch, date_remitted,
          to_char(encoded_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), remittance_status
        from sales where date_remitted >= ${today}::date - 120
          and date_remitted <= (select max(cleared_date) from live)
      ), owned as (
        select owner.clearing_id, e.kind, e.remittance_status from entries e
        join lateral (
          select l.clearing_id from live l where l.employee_id = e.person
            and lower(trim(l.branch)) = lower(trim(coalesce(e.branch, '')))
            and l.covers in ('Both', e.kind) and l.cleared_date >= e.date_remitted
            and (e.encoded is null or l.stamp <= e.encoded)
          order by l.stamp desc, l.cleared_at desc, l.clearing_id desc limit 1
        ) owner on true
      )
      select l.clearing_id as id, l.cleared_date::text as day, l.covers,
        count(*) filter (where o.kind = 'New Sales')::int as sales,
        count(*) filter (where o.kind = 'Collections')::int as collections,
        count(*) filter (where o.remittance_status = 'Remitted')::int as approved
      from live l left join owned o using (clearing_id)
      where l.cleared_date < ${today}::date and l.covers = 'Both'
      group by l.clearing_id, l.cleared_date, l.covers order by l.cleared_date, l.clearing_id`;
    const changes = rows.filter((row) => (row.sales > 0) !== (row.collections > 0))
      .map((row) => ({ ...row, next: row.sales > 0 ? "New Sales" : "Collections" }));
    const empty = rows.filter((row) => !row.sales && !row.collections);
    console.log(`${apply ? "APPLY" : "PREVIEW"}; Manila today ${today}; project ${/postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown"}`);
    for (const row of changes) console.log(`${row.id} | ${row.day} | Both -> ${row.next} | sales ${row.sales}, collections ${row.collections}, approved ${row.approved}`);
    console.log(`${changes.length} corrections; ${empty.length} empty Both lines left for review; ${rows.length - changes.length - empty.length} lines contain both kinds.`);
    for (const row of empty) console.log(`REVIEW ${row.id} | ${row.day} | no encoded entries`);
    if (!apply || !changes.length) return;
    await tx`select set_config('app.user_name', ${actor}, true)`;
    const correctionId = `COR-CLR-${Date.now().toString(36).toUpperCase()}`;
    for (const row of changes) {
      const updated = await tx`update clearings set covers = ${row.next}
        where clearing_id = ${row.id} and covers = 'Both' and status <> 'Removed' and cleared_date < ${today}::date
        returning clearing_id`;
      if (updated.length !== 1) throw new Error(`${row.id}: update guard failed.`);
    }
    await tx`insert into record_corrections ${tx({
      correction_id: correctionId, module: actor, record_id: "clearings", reason,
      before_json: changes.map(({ id, day, covers, sales, collections }) => ({ id, day, covers, sales, collections })),
      after_json: changes.map(({ id, next }) => ({ id, covers: next })),
      corrected_at: new Date().toISOString(), encoded_by_name: actor, encoded_at: new Date().toISOString(),
    })}`;
    const saved = await tx`select clearing_id as id, covers from clearings where clearing_id in ${tx(changes.map((row) => row.id))}`;
    if (saved.length !== changes.length || saved.some((row) => row.covers !== changes.find((change) => change.id === row.id)?.next)) throw new Error("Readback failed.");
    const audits = await tx`select distinct record_id from audit_log where table_name = 'clearings'
      and record_id in ${tx(changes.map((row) => row.id))} and user_name = ${actor} and logged_at >= transaction_timestamp()`;
    if (audits.length !== changes.length) throw new Error("Audit verification failed; rolling back.");
    console.log(`Verified ${saved.length} corrections and audit records; Record Corrections ${correctionId}.`);
  });
} finally {
  await sql.end();
}
