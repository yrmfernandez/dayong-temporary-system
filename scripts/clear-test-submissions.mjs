/**
 * Clears one MAS's test submissions on Submit New Sales and Submit Collections (owner, November 3, 2026: MD-2026-0054's
 * were only testing). Deletes that employee's rows in sale_submissions and collection_submissions that were never saved
 * (Submitted, Remitted, Rejected, Returned), so they leave My submissions, the clerk's Submitted by MAS lists and the
 * sidebar numbers. A clearing that Mark remitted recorded for one of them is taken off the Clearing list (Removed, with
 * the reason) while still Open. Saved submissions are left and listed: their New Sales and Collections are real entries,
 * removed only through the normal delete, never here. The Audit Log keeps every deleted row.
 *
 *   node scripts/clear-test-submissions.mjs MD-2026-0054                    dry run (staging)
 *   npm run prod -- node scripts/clear-test-submissions.mjs MD-2026-0054 [--apply]
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const employeeId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!employeeId) throw new Error("Give the MAS's employee ID, e.g. MD-2026-0054.");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const UNSAVED = ["Submitted", "Remitted", "Rejected", "Returned"];
class DryRun extends Error {}

try {
  console.log(`Database ${ref}${apply ? " (APPLY)" : " (dry run)"} · MAS ${employeeId}`);
  await sql.begin(async (tx) => {
    const [employee] = await tx`select employee_id, full_name from employees where employee_id = ${employeeId}`;
    if (!employee) throw new Error(`No employee ${employeeId}.`);
    console.log(`Employee: ${employee.full_name}`);
    const sales = await tx`select submission_id as id, 'New Sales' as kind, branch, status, sale_count as count, total_amount::float8 as total, submitted_at, clearing_id, sale_ids as saved_ids
      from sale_submissions where mas_employee_id = ${employeeId} order by row_seq for update`;
    const collections = await tx`select submission_id as id, 'Collections' as kind, branch, status, entry_count as count, total_amount::float8 as total, submitted_at, clearing_id, collection_ids as saved_ids
      from collection_submissions where mas_employee_id = ${employeeId} order by row_seq for update`;
    const all = [...sales, ...collections];
    if (!all.length) { console.log("No submissions for this MAS."); return; }
    for (const row of all) console.log(`  ${row.kind.padEnd(11)} ${row.id}  ${row.status.padEnd(9)} ${row.branch} · ${row.count} · ₱${row.total.toFixed(2)} · submitted ${new Date(row.submitted_at).toISOString().slice(0, 16)}${row.clearing_id ? ` · clearing ${row.clearing_id}` : ""}`);

    const clear = all.filter((row) => UNSAVED.includes(row.status));
    const saved = all.filter((row) => row.status === "Saved");
    if (saved.length) {
      console.log(`\nLeft as they are (${saved.length} Saved: their entries are real New Sales / Collections; delete those entries through the normal delete if they were tests too):`);
      for (const row of saved) console.log(`  ${row.kind} ${row.id}: entries ${row.saved_ids || "(none listed)"}`);
    }
    const clearingIds = [...new Set(clear.map((row) => row.clearing_id).filter(Boolean))];
    console.log(`\nTo clear: ${clear.filter((row) => row.kind === "New Sales").length} New Sales and ${clear.filter((row) => row.kind === "Collections").length} Collections submissions; ${clearingIds.length} Mark remitted clearing(s) to take off the list if still Open.`);

    const saleIds = clear.filter((row) => row.kind === "New Sales").map((row) => row.id);
    const collectionIds = clear.filter((row) => row.kind === "Collections").map((row) => row.id);
    if (saleIds.length) await tx`delete from sale_submissions where submission_id in ${tx(saleIds)} and status in ${tx(UNSAVED)}`;
    if (collectionIds.length) await tx`delete from collection_submissions where submission_id in ${tx(collectionIds)} and status in ${tx(UNSAVED)}`;
    if (clearingIds.length) {
      const removed = await tx`update clearings set status = 'Removed', closed_at = now(), closed_reason = ${`Test MAS submission cleared (${employeeId})`}
        where clearing_id in ${tx(clearingIds)} and status = 'Open' returning clearing_id`;
      console.log(`Clearings taken off the list: ${removed.map((row) => row.clearing_id).join(", ") || "none (already encoded or removed)"}`);
    }
    if (!apply) throw new DryRun();
    console.log("\nApplied.");
  });
} catch (error) {
  if (error instanceof DryRun) console.log("\nDry run: nothing was changed. Run again with --apply to clear them.");
  else { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
} finally {
  await sql.end();
}
