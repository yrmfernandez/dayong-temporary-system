// Read-only: one account's posted collections now, with the repair's before-values and when each was created.
import postgres from "postgres";
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const account = process.argv[2];
  const rows = await sql`select c.collection_id, c.or_date::text as or_date, c.nop_from, c.nop_to, c.month_from, c.month_to, c.encoded_at::text as encoded,
      (select a.changes_json::text from audit_log a where a.table_name = 'collections' and a.record_id = c.collection_id and a.user_name = 'System'
        and a.logged_at between '2026-10-21 04:55:00+00' and '2026-10-21 05:07:00+00' and (a.changes_json ? 'month_from' or a.changes_json ? 'nop_from') limit 1) as repair
    from collections c where c.enrollment_id = ${account} and c.status = 'Posted' order by c.or_date, c.nop_from`;
  const [acc] = await sql`select doi::text as doi, program_id from member_programs where enrollment_id = ${account}`;
  console.log(account, acc);
  console.table(rows.map((r) => ({ id: r.collection_id, orDate: r.or_date, now: `NOP ${r.nop_from}-${r.nop_to} ${r.month_from}..${r.month_to}`, encoded: String(r.encoded ?? "").slice(0, 16), repair: r.repair ? r.repair.replace(/"(to|from)":/g, "$1:").slice(0, 150) : "" })));
} finally { await sql.end(); }
