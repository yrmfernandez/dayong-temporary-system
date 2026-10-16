/**
 * Restores incentives lost on resubmitted batches (owner, October 16, 2026). A batch whose slip was returned and then
 * resubmitted got a new slip whose "cash received" time was searched again; it could pick a later clearing of the same
 * person (another handover after 3 PM) and forfeit incentives of cash cleared on time. The rule: cleared before the
 * deadline keeps the incentive, however late it was encoded or resubmitted. lib/remittance-workflow.ts receivedAtOf now
 * uses the clearing linked to the batch's earlier slip; this fixes entries saved before that.
 *
 * Affected: an entry with a forfeited incentive that went through a returned (Rejected) slip, whose cash was received
 * (the clearing linked to its slips, else the returned slip's time) by its deadline (3:00 PM the next working day after
 * the OR date) or on a grace day. Restoring gives the incentive back (company share = amount less incentive), and the
 * current slip's line and expected amount follow; its difference shows what the MAS is owed if they paid in full.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/restore-resubmit-incentives.mjs                       dry run (staging)
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/restore-resubmit-incentives.mjs [--apply]
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const { incentiveDeadline, INCENTIVE_GRACE_DAYS } = await import("../lib/remittance-deadline.ts");
const { declaredNonWorkingDays } = await import("../lib/work-calendar.ts");
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const round = (value) => Math.round(value * 100) / 100;
class DryRun extends Error {}

try {
  console.log(`Database ${ref}${apply ? " (APPLY)" : " (dry run)"}`);
  await sql.begin(async (tx) => {
    // Declared non-working days move the deadline, read as the app reads them.
    const days = await declaredNonWorkingDays();
    const entries = await tx`
      with linked as (
        select rc.collection_id as id, rc.remittance_id, r.status, r.date_remitted::text as slip_date, coalesce(nullif(trim(r.time_remitted), ''), '23:59') as slip_time from remittance_collections rc join remittances r on r.remittance_id = rc.remittance_id)
      select e.kind, e.id, e.or_date, e.branch, e.amount, e.share, e.forfeited, e.slip, e.slip_status,
        (select to_char(min(c.cleared_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') from clearings c where c.status <> 'Removed' and c.remittance_id in (select l.remittance_id from linked l where l.id = e.id)) as cleared_at,
        (select min(l.slip_date || ' ' || l.slip_time) from linked l where l.id = e.id and l.status = 'Rejected' and l.slip_date is not null) as returned_at
      from (
        select 'Collection' as kind, collection_id as id, or_date::text as or_date, branch, amount_collected::float8 as amount, remittance_amount::float8 as share, forfeited_incentive::float8 as forfeited, linked_remittance_id as slip, remittance_status as slip_status
          from collections where coalesce(forfeited_incentive, 0) > 0 and status = 'Posted'
        union all
        select 'New Sale', sale_id, coalesce(or_date::text, (date_created at time zone 'Asia/Manila')::date::text), branch, amount_paid::float8, remittance_amount::float8, forfeited_incentive::float8, linked_remittance_id, remittance_status
          from sales where coalesce(forfeited_incentive, 0) > 0
      ) e
      where exists (select 1 from linked l where l.id = e.id and l.status = 'Rejected')
      order by e.or_date, e.id`;
    const restore = [], kept = [];
    for (const entry of entries) {
      const received = entry.cleared_at || entry.returned_at || "";
      const deadline = incentiveDeadline(entry.or_date ?? "", { days, branch: entry.branch ?? "" });
      const onTime = received && (INCENTIVE_GRACE_DAYS.includes(received.slice(0, 10)) || !deadline || received <= deadline);
      (onTime ? restore : kept).push({ ...entry, received, deadline });
    }
    console.log(`\nForfeited entries that went through a returned slip: ${entries.length}`);
    console.log(`\nRestore (cash received by the deadline): ${restore.length}`);
    for (const item of restore) console.log(`  ${item.kind} ${item.id} · OR ${item.or_date} · deadline ${item.deadline} · cash received ${item.received} · incentive ${item.forfeited} · slip ${item.slip || "—"} (${item.slip_status})`);
    console.log(`\nKept forfeited (received after the deadline): ${kept.length}`);
    for (const item of kept) console.log(`  ${item.kind} ${item.id} · OR ${item.or_date} · deadline ${item.deadline} · cash received ${item.received || "unknown"}`);

    const slips = new Map();
    for (const item of restore) {
      const share = round(item.amount - item.forfeited);
      if (item.kind === "Collection") await tx`update collections set remittance_amount = ${share}, forfeited_incentive = null where collection_id = ${item.id}`;
      else await tx`update sales set remittance_amount = ${share}, mas_incentive = ${item.forfeited}, forfeited_incentive = null where sale_id = ${item.id}`;
      if (item.slip && item.slip_status !== "Returned") {
        await tx`update remittance_collections set amount = ${share} where remittance_id = ${item.slip} and collection_id = ${item.id}`;
        slips.set(item.slip, round((slips.get(item.slip) ?? 0) - item.forfeited));
      }
    }
    for (const [slip, delta] of slips) await tx`update remittances set gross_collection = round((coalesce(gross_collection, 0) + ${delta})::numeric, 2), difference = round((coalesce(total_remittance, 0) - coalesce(gross_collection, 0) - ${delta})::numeric, 2) where remittance_id = ${slip}`;
    if (slips.size) console.log(`\nSlips whose expected amount follows: ${[...slips].map(([slip, delta]) => `${slip} ${delta}`).join(", ")}`);
    if (restore.length) {
      const stamp = new Date().toISOString();
      await tx`select set_config('app.user_name', 'Resubmit incentive restore', true)`;
      await tx`insert into record_corrections ${tx({ correction_id: `COR-RESUBMIT-INC-${Date.now().toString(36).toUpperCase()}`, module: "Incentive", record_id: "Resubmitted batches", reason: "Cash cleared before the 3:00 PM deadline keeps its incentive, however late the batch was encoded or resubmitted (owner, October 16, 2026). Incentives forfeited on resubmitted batches restored.", before_json: restore.map((item) => ({ kind: item.kind, id: item.id, share: item.share, forfeited: item.forfeited })), after_json: restore.map((item) => ({ kind: item.kind, id: item.id, share: round(item.amount - item.forfeited), forfeited: 0, received: item.received, deadline: item.deadline })), corrected_at: stamp, encoded_by_name: "Resubmit incentive restore", encoded_at: stamp })}`;
    }
    if (!apply) throw new DryRun();
  });
  console.log(apply ? "\nApplied." : "");
} catch (error) {
  if (error instanceof DryRun) console.log("\nDry run rolled back. Add --apply to write.");
  else throw error;
} finally {
  await sql.end();
}
