/**
 * Read-only: where a clerk's "Pending cash, to be encoded" comes from (owner, October 28, 2026). The amount is typed in
 * the report's Notes (report_notes.pending_cash), not counted from entries. Prints the clerk's notes rows that carry
 * pending cash, with who saved them and when, plus the audit trail of those saves. Employee and report fields only;
 * no member data. Nothing is written.
 *
 *   node scripts/inspect-clerk-pending-cash.mjs <name part>                     staging
 *   npm run prod -- node scripts/inspect-clerk-pending-cash.mjs <name part>     production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const words = process.argv.slice(2).join(" ").trim().toLowerCase().split(/\s+/).filter(Boolean);
if (!words.length) { console.log("Give part of the clerk's name."); process.exit(1); }

try {
  console.log(`Database ${ref} (read only)`);
  const people = (await sql`select employee_id, full_name, primary_branch, employment_status from employees`)
    .filter((row) => words.every((word) => row.full_name.toLowerCase().includes(word)));
  if (!people.length) console.log("No employee matches.");
  for (const person of people) {
    console.log(`\n${person.employee_id} · ${person.full_name} · ${person.primary_branch ?? "—"} · ${person.employment_status ?? "—"}`);
    const notes = await sql`select note_key, period_kind, period_start::text as start, pending_cash::float8 as pending, specific_remarks, pending_transactions, other_comments,
        to_char(updated_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as at, updated_by
      from report_notes where lower(note_key) like ${`${person.employee_id.toLowerCase()}|%`} order by period_start, note_key`;
    const pending = notes.filter((row) => row.pending);
    console.log(`  ${notes.length} notes rows, ${pending.length} with pending cash`);
    for (const row of pending) {
      console.log(`  ${row.note_key}  pending ₱${row.pending}  saved ${row.at ?? "?"} by ${row.updated_by ?? "?"}`);
      for (const field of ["specific_remarks", "pending_transactions", "other_comments"]) if (row[field]) console.log(`      ${field}: ${row[field].replace(/\s+/g, " ")}`);
    }
  }
} finally {
  await sql.end();
}
