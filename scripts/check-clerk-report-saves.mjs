/**
 * Read-only: are Entry Clerk report saves reaching the database? (owner, October 24, 2026: on the Reports page,
 * clicking Save did nothing and the typed text disappeared.) For the last 3 Manila days, prints how many report notes /
 * Cash Beg, bank deposits, expenses and Fidelity slips each employee saved, with the latest time; and who is marked
 * Day Off today (Day Off blocks every save on the report). Employee IDs, counts and times only; no member data.
 * Nothing is written.
 *
 *   node scripts/check-clerk-report-saves.mjs                     staging
 *   npm run prod -- node scripts/check-clerk-report-saves.mjs     production
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const manila = (column) => sql.unsafe(`(${column} at time zone 'Asia/Manila')`);

try {
  const [{ today }] = await sql`select (now() at time zone 'Asia/Manila')::date::text as today`;
  console.log(`Database ${ref} (read only) · Manila today ${today} · last 3 days`);
  const groups = [
    ["Report notes", sql`select employee_id as who, ${manila("updated_at")} as at from report_notes where updated_at is not null`],
    ["Cash Beg", sql`select employee_id as who, ${manila("cash_beg_updated_at")} as at from report_notes where cash_beg_updated_at is not null`],
    ["Bank deposits", sql`select employee_id as who, ${manila("created_at")} as at from bank_deposits where created_at is not null`],
    ["Expenses", sql`select encoded_by_employee_id as who, ${manila("coalesce(encoded_at, created_at)")} as at from expenses where coalesce(encoded_at, created_at) is not null`],
    ["Fidelity slips", sql`select encoded_by_employee_id as who, ${manila("encoded_at")} as at from remittances where remittance_type = 'Fidelity' and encoded_at is not null`],
  ];
  for (const [label, rows] of groups) {
    const result = await sql`select who, at::date::text as day, count(*)::int as saved, to_char(max(at), 'HH24:MI') as latest
      from (${rows}) saved where at::date >= ${today}::date - 2 group by who, at::date order by at::date desc, who`;
    console.log(`\n${label}:`);
    if (!result.length) console.log("  none saved in the last 3 days");
    for (const row of result) console.log(`  ${row.day}  ${row.who || "(no employee)"}  ${row.saved} saved, latest ${row.latest}`);
  }
  // A clerk who saw no message may have clicked Save again: posted expenses by the same employee on the same day with
  // the same amount, receipt number and expense date.
  const repeats = await sql`select encoded_by_employee_id as who, ${manila("coalesce(encoded_at, created_at)")}::date::text as day, amount::float8 as amount,
      coalesce(receipt_number, '') as receipt, expense_date::text as expense_date, array_agg(expense_id order by coalesce(encoded_at, created_at)) as ids
    from expenses where coalesce(status, 'Posted') = 'Posted' and ${manila("coalesce(encoded_at, created_at)")}::date >= ${today}::date - 2
    group by 1, 2, 3, 4, 5 having count(*) > 1 order by 2 desc, 1`;
  console.log("\nPossible repeated expenses (same clerk, day, amount, receipt no. and expense date; still Posted):");
  if (!repeats.length) console.log("  none");
  for (const row of repeats) console.log(`  ${row.day}  ${row.who}  ₱${row.amount}  receipt ${row.receipt || "(blank)"}  dated ${row.expense_date}: ${row.ids.join(", ")}`);
  const dayOff = await sql`select distinct employee_id from attendance where attendance_date = ${today}::date and attendance_status = 'Day Off' order by employee_id`;
  console.log(`\nMarked Day Off today (every report save is refused for them): ${dayOff.map((row) => row.employee_id).join(", ") || "nobody"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
