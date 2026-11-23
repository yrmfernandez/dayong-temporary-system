/**
 * Read-only: why a collection (and the rest of its batch) has no incentive. Prints, for the collection's batch, each
 * collection's amount, company share, breakdown, forfeited incentive, No incentive reason, incentive decision, role and
 * MAS link, plus the account's status and the program's incentive tiers for the branch. Money and IDs only; no member
 * names or personal details.
 *
 *   npm run prod -- node scripts/inspect-collection-incentive.mjs COL-...
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const id = process.argv[2];
if (!id) throw new Error("Usage: node scripts/inspect-collection-incentive.mjs COL-...");
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log(`Supabase project: ${/postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown"}\n`);
  const [target] = await sql`select collection_batch_id, enrollment_id from collections where collection_id = ${id}`;
  if (!target) { console.log(`${id} not found.`); process.exit(0); }
  const rows = await sql`
    select c.*, c.or_date::text as or_date, c.date_remitted::text as date_remitted, mp.account_status, mp.doi::text as doi, mp.branch as account_branch, mp.mas as account_mas
    from collections c left join member_programs mp on mp.enrollment_id = c.enrollment_id
    where ${target.collection_batch_id ? sql`c.collection_batch_id = ${target.collection_batch_id}` : sql`c.collection_id = ${id}`}
    order by c.created_at, c.collection_id`;
  console.log(`Batch ${target.collection_batch_id || "(none)"}: ${rows.length} collection(s)\n`);
  for (const row of rows) console.log(JSON.stringify(row));
  const programs = [...new Set(rows.map((row) => row.program_id))];
  const tiers = await sql`select incentive_id, program_id, role, from_month, to_month, incentive_type, mark_up, incentive_amount, branch_id, non_commissionable from program_incentives where program_id in ${sql(programs)} order by program_id, role, from_month`;
  console.log(`\nIncentive tiers for ${programs.join(", ")}:`);
  for (const tier of tiers) console.log(JSON.stringify(tier));

  // What decided the incentive: the 3:00 PM rule (lib/remittance-deadline.ts) on the time received, or a decision.
  console.log("\nIncentive per collection:");
  for (const row of rows) console.log(JSON.stringify({ id: row.collection_id, amount: row.amount_collected, companyShare: row.remittance_amount, forfeited: row.forfeited_incentive,
    noIncentiveReason: row.no_incentive_reason, decision: row.incentive_decision, decisionReason: row.incentive_decision_reason, decisionBy: row.incentive_decision_by,
    orDate: row.or_date, dateRemitted: row.date_remitted, dateRemittedReason: row.date_remitted_reason, encodedAt: row.encoded_at, clearing: row.clearing_id, slip: row.linked_remittance_id }));
  const clearingIds = [...new Set(rows.map((row) => row.clearing_id).filter(Boolean))];
  if (clearingIds.length) {
    console.log("\nClearing (when the cash was received):");
    for (const row of await sql`select clearing_id, branch, employee_id, cleared_at::text, cleared_date::text, amount, status, covers, remittance_id from clearings where clearing_id in ${sql(clearingIds)}`) console.log(JSON.stringify(row));
  }
  const days = [...new Set(rows.map((row) => row.or_date))].sort();
  if (days.length) {
    const [from] = days, to = new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
    console.log(`\nDeclared non-working days ${from} to ${to} (empty: none):`);
    for (const row of await sql`select attendance_date::text, branch, attendance_status from attendance where employee_id is null and attendance_status = 'Non-working Day' and attendance_date between ${from} and ${to}`) console.log(JSON.stringify(row));
  }
  // The person's clearings from the OR date to the Date Remitted: with no clearing linked, the slip's time comes from these.
  const person = rows.find((row) => row.accountable_employee_id)?.accountable_employee_id;
  if (person && days.length) {
    const last = [...rows.map((row) => row.date_remitted).filter(Boolean), days.at(-1)].sort().at(-1);
    console.log(`\nClearings of ${person} from ${days[0]} to ${last}:`);
    for (const row of await sql`select clearing_id, branch, cleared_at::text, cleared_date::text, amount, status, covers, remittance_id, notes from clearings where employee_id = ${person} and cleared_date between ${days[0]} and ${last} order by cleared_at`) console.log(JSON.stringify(row));
  }
  const slips = [...new Set(rows.map((row) => row.linked_remittance_id).filter(Boolean))];
  if (slips.length) {
    console.log("\nSlip:");
    for (const row of await sql`select remittance_id, status, date_remitted::text, time_remitted, gross_collection, total_remittance, difference, fidelity_amount, received_by_name, created_at::text from remittances where remittance_id in ${sql(slips)}`.catch((error) => [{ error: error.message }])) console.log(JSON.stringify(row));
  }
} finally {
  await sql.end();
}
