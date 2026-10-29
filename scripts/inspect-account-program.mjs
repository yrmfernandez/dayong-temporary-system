/**
 * Read-only: why a member's account is in its program (accounts linked to the member, or saved with the number) (owner, October 29, 2026: PH-67986231 shows D-180 in Collections
 * instead of DC-180). For each of the member's accounts: program code, DOI, who created it and when (an ID with -LEG-
 * came from the old sheets); every logged change of its program (Audit Log) and every Record Correction on it; its
 * receipts and New Sales by program, old-sheet or encoded here, and who encoded them. IDs, codes, dates and counts only;
 * no names of members. Nothing is written.
 *
 *   npm run prod -- node scripts/inspect-account-program.mjs PH-67986231
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const number = process.argv[2]?.trim();
if (!number) { console.error("Usage: node scripts/inspect-account-program.mjs <member number>"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const at = (column) => sql`to_char(${sql(column)} at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')`;

try {
  console.log(`Database ${ref} (read only) · member ${number}`);
  const accounts = await sql`select mp.enrollment_id, mp.member_id, coalesce(mp.member_number, '') as member_number, mp.program_id, p.program_code, mp.doi::text as doi, mp.status, mp.account_status,
      ${at("mp.date_created")} as created, coalesce(mp.encoded_by_name, '') as encoder
    from member_programs mp join programs p on p.program_id = mp.program_id
    where mp.member_number = ${number} or mp.member_id in (select member_id from members where member_number = ${number}) order by mp.doi`;
  const [member] = await sql`select member_id from members where member_number = ${number}`;
  console.log(`Member record: ${member?.member_id ?? "none with that number"}`);
  if (!accounts.length) console.log("No accounts with that member number.");
  const ids = accounts.map((a) => a.enrollment_id);
  const memberIds = [...new Set(accounts.map((a) => a.member_id))];
  const codes = new Map((await sql`select program_id, program_code from programs`).map((p) => [p.program_id, p.program_code]));
  const code = (id) => (id ? `${codes.get(id) ?? "?"} (${id})` : "-");

  for (const account of accounts) {
    console.log(`\n${account.enrollment_id} · ${code(account.program_id)} · DOI ${account.doi} · ${account.status || "-"} · ${account.account_status || "-"}`);
    if (account.member_number !== number) console.log(`  member number saved on the account: ${account.member_number || "(blank)"} (the member's is ${number})`);
    console.log(`  created ${account.created || "?"} by ${account.encoder || "(not recorded)"}${account.enrollment_id.includes("-LEG-") ? " · from the old sheets" : ""}`);
    const changes = await sql`select ${at("logged_at")} as at, coalesce(user_name, user_id, '') as by, changes_json -> 'program_id' as change
      from audit_log where table_name = 'member_programs' and record_id = ${account.enrollment_id} and changes_json ? 'program_id' order by logged_at`;
    console.log(`  program changes logged: ${changes.length ? "" : "none"}`);
    for (const row of changes) console.log(`    ${row.at} · ${row.by || "?"} · ${code(row.change?.from)} → ${code(row.change?.to)}`);
    const fixes = await sql`select ${at("corrected_at")} as at, module, coalesce(encoded_by_name, '') as by, reason from record_corrections where record_id = ${account.enrollment_id} order by corrected_at`;
    console.log(`  record corrections: ${fixes.length ? "" : "none"}`);
    for (const row of fixes) console.log(`    ${row.at} · ${row.module} · ${row.by || "?"} · ${row.reason ?? ""}`);
  }

  if (memberIds.length) {
    const receipts = await sql`select enrollment_id, program_id, collection_id like '%-LEG-%' as legacy, coalesce(encoded_by_name, '') as by, count(*)::int as n,
        min(or_date)::text as first, max(or_date)::text as last
      from collections where member_id in ${sql(memberIds)} and status = 'Posted' group by 1, 2, 3, 4 order by first`;
    console.log("\nPosted receipts by account and program:");
    console.table(receipts.map((r) => ({ account: r.enrollment_id, program: code(r.program_id), source: r.legacy ? "old sheets" : "encoded here", by: r.by || "-", receipts: r.n, first: r.first, last: r.last })));
    const sales = await sql`select sale_id, program_id, ${at("date_created")} as created, coalesce(encoded_by_name, '') as by from sales where member_number = ${number} order by date_created`;
    console.log("New Sales:");
    console.table(sales.map((s) => ({ sale: s.sale_id, program: code(s.program_id), source: s.sale_id.includes("-LEG-") ? "old sheets" : "encoded here", created: s.created, by: s.by || "-" })));
  }
  if (member) {
    const gone = await sql`select ${at("logged_at")} as at, action, record_id, coalesce(user_name, user_id, '') as by, changes_json -> 'program_id' as program
      from audit_log where table_name = 'member_programs' and record_id not in ${sql(ids.length ? ids : [""])} and changes_json::text like ${`%${member.member_id}%`} order by logged_at`;
    console.log(`Other accounts of this member in the Audit Log (deleted or moved away): ${gone.length ? "" : "none"}`);
    for (const row of gone) console.log(`  ${row.at} · ${row.action} · ${row.record_id} · ${row.by || "?"}${row.program ? ` · program ${JSON.stringify(row.program)}` : ""}`);
  }
  if (ids.length) {
    const moved = await sql`select ${at("corrected_at")} as at, module, record_id, coalesce(encoded_by_name, '') as by from record_corrections
      where before_json::text ~ ${ids.join("|")} or after_json::text ~ ${ids.join("|")} order by corrected_at`;
    console.log(`Corrections that mention these accounts: ${moved.length ? "" : "none"}`);
    for (const row of moved) console.log(`  ${row.at} · ${row.module} · record ${row.record_id} · ${row.by || "?"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
