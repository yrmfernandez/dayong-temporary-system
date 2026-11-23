/**
 * Read-only: each MAS Collections batch still waiting in Submitted by MAS, entry by entry, with the collections already
 * saved that could be the same payment: on the same account (any NOP) or with the same OR number (any account). Shows
 * why Already saved: close batch does or does not see it (lib/submission-already-saved.ts). IDs, dates, NOPs and
 * amounts only; no member names or personal details.
 *
 *   npm run prod -- node scripts/inspect-waiting-submission.mjs [CSUB-...]
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const only = process.argv[2] ?? "";
const orKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

try {
  console.log(`Supabase project: ${/postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown"}\n`);
  const batches = await sql`select submission_id, branch, mas_employee_id, status, entries, entry_count, total_amount, submitted_at::text, clearing_id, remitted_at::text
    from collection_submissions where ${only ? sql`submission_id = ${only}` : sql`status in ('Submitted', 'Remitted')`} order by submitted_at`;
  if (!batches.length) console.log("No batch waiting.");
  for (const batch of batches) {
    console.log(`${batch.submission_id} · ${batch.status} · ${batch.branch} · MAS ${batch.mas_employee_id} · ${batch.entry_count} entries · ${batch.total_amount} · submitted ${batch.submitted_at} · clearing ${batch.clearing_id || "-"} · remitted ${batch.remitted_at || "-"}`);
    const entries = typeof batch.entries === "string" ? JSON.parse(batch.entries) : batch.entries ?? [];
    for (const [index, entry] of entries.entries()) {
      const nopFrom = Number(entry.nopFrom), nopTo = Number(entry.nopTo || entry.nopFrom);
      console.log(`  #${index + 1} account ${entry.enrollmentId} · program ${entry.programId ?? "-"} · OR ${entry.orNumber ?? "-"} (${entry.orDate ?? "-"}) · NOP ${nopFrom}${nopTo !== nopFrom ? `-${nopTo}` : ""} · ${entry.amount ?? entry.amountCollected ?? "-"} · keys ${Object.keys(entry).join(",")}`);
      const sameAccount = await sql`select collection_id, or_number, or_date::text, nop_from, nop_to, amount_collected, status, created_at::text, collection_batch_id
        from collections where enrollment_id = ${entry.enrollmentId} and status = 'Posted' order by nop_from desc nulls last limit 4`;
      for (const row of sameAccount) {
        const overlaps = row.nop_from !== null && row.nop_from <= nopTo && (row.nop_to ?? row.nop_from) >= nopFrom;
        console.log(`     same account: ${row.collection_id} · OR ${row.or_number} (${row.or_date}) · NOP ${row.nop_from}${row.nop_to && row.nop_to !== row.nop_from ? `-${row.nop_to}` : ""} · ${row.amount_collected} · saved ${row.created_at} · ${row.collection_batch_id || "-"}${overlaps ? " · OVERLAPS (seen as saved)" : ""}`);
      }
      const [account] = await sql`select enrollment_id, member_id, program_id, branch, mas, account_status, transferred_to, doi::text from member_programs where enrollment_id = ${entry.enrollmentId}`.catch(() =>
        sql`select enrollment_id, member_id, program_id, branch, mas, account_status, doi::text from member_programs where enrollment_id = ${entry.enrollmentId}`);
      console.log(`     account now: ${account ? JSON.stringify(account) : "NOT FOUND (removed or merged)"}`);
      // Saved on another account of the same member (another program, or after a merge or transfer), since the OR date.
      const since = String(entry.orDate || batch.submitted_at).slice(0, 10);
      const sameMember = await sql`select c.collection_id, c.enrollment_id, c.program_id, c.or_number, c.or_date::text, c.nop_from, c.nop_to, c.amount_collected, c.created_at::text, c.encoded_by_employee_id
        from collections c where c.member_id = ${entry.memberId} and c.status = 'Posted' and c.enrollment_id <> ${entry.enrollmentId} and c.or_date >= ${since}::date - 3 order by c.or_date`;
      for (const row of sameMember) console.log(`     same member, other account: ${row.collection_id} · account ${row.enrollment_id} · program ${row.program_id} · OR ${row.or_number} (${row.or_date}) · NOP ${row.nop_from}${row.nop_to && row.nop_to !== row.nop_from ? `-${row.nop_to}` : ""} · ${row.amount_collected} · saved ${row.created_at} by ${row.encoded_by_employee_id}`);
      // The same amount for this MAS around the OR date, on any account.
      const sameAmount = await sql`select c.collection_id, c.enrollment_id, c.member_id, c.or_number, c.or_date::text, c.nop_from, c.amount_collected, c.created_at::text
        from collections c where c.status = 'Posted' and c.amount_collected = ${Number(entry.amount)} and c.or_date between ${since}::date - 3 and ${since}::date + 10
          and (c.mas_employee_id = ${batch.mas_employee_id} or c.accountable_employee_id = ${batch.mas_employee_id}) order by c.or_date`;
      for (const row of sameAmount) {
        // Already part of another MAS batch: then it is that batch's payment, not this one's.
        const [claimed] = await sql`select submission_id from collection_submissions where status = 'Saved' and submission_id <> ${batch.submission_id} and ',' || collection_ids || ',' like ${`%,${row.collection_id},%`}`;
        console.log(`     same amount, same MAS: ${row.collection_id} · account ${row.enrollment_id}${row.member_id === entry.memberId ? " (same member)" : ""} · OR ${row.or_number} (${row.or_date}) · NOP ${row.nop_from} · ${row.amount_collected} · saved ${row.created_at}${claimed ? ` · ALREADY IN MAS BATCH ${claimed.submission_id}` : ""}`);
      }
      const key = orKey(entry.orNumber);
      if (key) {
        const sameOr = await sql`select collection_id, enrollment_id, or_number, or_date::text, nop_from, nop_to, amount_collected, status, created_at::text
          from collections where or_key = ${key} and status = 'Posted'`;
        for (const row of sameOr) console.log(`     same OR: ${row.collection_id} · account ${row.enrollment_id}${row.enrollment_id === entry.enrollmentId ? " (same account)" : " (OTHER account)"} · NOP ${row.nop_from}${row.nop_to && row.nop_to !== row.nop_from ? `-${row.nop_to}` : ""} · ${row.amount_collected} · saved ${row.created_at}`);
        if (!sameOr.length) console.log("     same OR: none saved");
      }
    }
    console.log("");
  }
} finally {
  await sql.end();
}
