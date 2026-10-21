/**
 * Undoes part of scripts/fix-program-move-months-20261021.mts (applied October 21, 2026, 05:05 UTC, "Program move months"):
 * that repair took each moved collection's month from the first month/NOP change after its program move, so where a
 * deliberate correction came after the move (Source Month of / NOP correction, Receipt consolidation, Member split, an
 * owner-confirmed transfer) it put back the value from before that correction. Found on PH-00555176 (owner, October
 * 21, 2026): 362 collections on 43 accounts. The owner chose to restore all of them.
 *
 * Whole accounts: on every account holding such a collection, every collection the repair changed (corrected or not, so
 * the account is exactly as it was) gets month_from, month_to, nop_from and nop_to back as they were just before the
 * repair (the Audit Log "from" of the repair's change). Collections encoded on those accounts after the repair followed
 * its numbering, so they are numbered on from the restored history (OR-date order, each keeping its months). A collection
 * changed again since the repair is listed and left. Each restored account must pass the account rules; its status is
 * recalculated; collections not Remitted or Approved get their incentives worked out again (one at a time; one whose
 * tiers cannot price it keeps its figures and is listed). Collections the repair changed on other accounts (no later
 * correction anywhere on the account) stay as the repair left them. One transaction; Record Corrections keeps a summary.
 *
 * Preview (runs and rolls back): node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/restore-program-move-repair-20261021.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { accountState, monthIndex, monthName, todayInManila } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { encodedBy, inTransaction, schema } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { repriceCollections } from "@/lib/entry-edit";
import { createReadableId } from "@/lib/readable-id";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const rows = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
type Change = { from?: unknown; to?: unknown };
type Repaired = { record_id: string; changes: Record<string, Change>; enrollment_id: string; month_from: string; month_to: string; nop_from: number; nop_to: number; remittance_status: string | null };
const FIELDS = ["month_from", "month_to", "nop_from", "nop_to"] as const;
class PreviewDone extends Error {}

async function main() {
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table collections, member_programs in share row exclusive mode`);
    const [run] = rows<{ at: string; n: number }>(await tx.execute(sql`select corrected_at::text as at, jsonb_array_length(before_json->'changes') as n
      from record_corrections where module = 'Program move months' order by corrected_at desc limit 1`));
    if (!run) throw new Error("The program-move repair was not found in Record Corrections.");
    // The repair's own change of each collection, for those that had a deliberate correction after their first move.
    const repaired = rows<Repaired>(await tx.execute(sql`with repair as (
        select record_id, logged_at, changes_json from audit_log
        where table_name = 'collections' and logged_at between ${run.at}::timestamptz - interval '10 minutes' and ${run.at}::timestamptz + interval '1 minute'
          and user_name = 'System' and (changes_json ? 'month_from' or changes_json ? 'nop_from')),
      first_move as (
        select record_id, min(logged_at) as moved_at from audit_log where table_name = 'collections' and changes_json ? 'program_id' and logged_at >= '2026-10-01' group by record_id),
      corrected as (
        select distinct a.record_id from audit_log a join first_move m using (record_id) join repair r using (record_id)
        where a.table_name = 'collections' and (a.changes_json ? 'month_from' or a.changes_json ? 'nop_from')
          and a.logged_at > m.moved_at + interval '10 minutes' and a.logged_at < r.logged_at),
      affected as (select distinct c.enrollment_id from collections c join corrected k on k.record_id = c.collection_id)
      select r.record_id, r.changes_json as changes, c.enrollment_id, c.month_from, c.month_to, c.nop_from, c.nop_to, c.remittance_status
      from repair r join collections c on c.collection_id = r.record_id join affected a on a.enrollment_id = c.enrollment_id order by c.enrollment_id, c.nop_from`));

    // Left as they are: changed again since the repair (the current value is not what the repair wrote).
    const changedSince: Array<{ collection: string; field: string; repairWrote: string; now: string }> = [];
    const restore: Array<{ id: string; account: string; set: Record<string, string | number>; status: string | null }> = [];
    for (const row of repaired) {
      const set: Record<string, string | number> = {};
      let moved = false;
      for (const field of FIELDS) {
        const change = row.changes[field];
        if (!change) continue;
        if (String(change.to ?? "") !== String(row[field] ?? "")) { changedSince.push({ collection: row.record_id, field, repairWrote: String(change.to), now: String(row[field]) }); moved = true; break; }
        set[field] = field.startsWith("nop") ? Number(change.from) : String(change.from ?? "");
      }
      if (!moved && Object.keys(set).length) restore.push({ id: row.record_id, account: row.enrollment_id, set, status: row.remittance_status });
    }
    const accounts = [...new Set(restore.map((item) => item.account))];
    console.log(`Repair run ${run.at}: ${run.n} collections changed.`);
    console.log(`To restore (accounts where a deliberate correction came after a move): ${restore.length} collections on ${accounts.length} accounts; changed again since the repair, left: ${changedSince.length}.`);
    if (changedSince.length) console.table(changedSince);

    for (const item of restore) {
      await tx.update(schema.collections).set(item.set).where(sql`${schema.collections.collection_id} = ${item.id}`);
    }
    // Collections encoded on these accounts after the repair continue from the restored history.
    const after = accounts.length ? rows<{ collection_id: string; enrollment_id: string; nop_from: number; nop_to: number; remittance_status: string | null }>(await tx.execute(sql`
      select collection_id, enrollment_id, nop_from, nop_to, remittance_status from collections
      where enrollment_id in (${sql.join(accounts.map((id) => sql`${id}`), sql`, `)}) and status = 'Posted' and nop_from is not null
        and encoded_at > ${run.at}::timestamptz and collection_id not in (${sql.join(restore.map((item) => sql`${item.id}`), sql`, `)})
      order by enrollment_id, or_date, nop_from`)) : [];
    const continued: Array<{ collection: string; to: string }> = [];
    for (const account of new Set(after.map((row) => row.enrollment_id))) {
      const ids = new Set(after.filter((row) => row.enrollment_id === account).map((row) => row.collection_id));
      const [last] = rows<{ nop: number; month: string }>(await tx.execute(sql`select nop_to as nop, left(month_to, 7) as month from collections
        where enrollment_id = ${account} and status = 'Posted' and nop_to is not null and collection_id not in (${sql.join([...ids].map((id) => sql`${id}`), sql`, `)})
        order by nop_to desc limit 1`));
      let nop = (last?.nop ?? 0) + 1, month = last ? monthIndex(last.month) + 1 : 0;
      for (const row of after.filter((item) => item.enrollment_id === account)) {
        const span = Math.max(1, row.nop_to - row.nop_from + 1);
        const set = { nop_from: nop, nop_to: nop + span - 1, month_from: monthName(month), month_to: monthName(month + span - 1) };
        await tx.update(schema.collections).set(set).where(sql`${schema.collections.collection_id} = ${row.collection_id}`);
        restore.push({ id: row.collection_id, account, set, status: row.remittance_status });
        continued.push({ collection: row.collection_id, to: `NOP ${set.nop_from}-${set.nop_to} ${set.month_from}..${set.month_to}` });
        nop += span; month += span;
      }
    }
    if (continued.length) { console.log(`Encoded after the repair, numbered on from the restored history: ${continued.length}`); console.table(continued); }
    // Each restored account must pass the account rules; its status follows.
    const data = await loadAccountData({ enrollmentIds: accounts, includeDeactivated: true }, tx);
    const today = todayInManila();
    const failing: Array<{ account: string; why: string }> = [];
    const statuses: Array<{ account: string; before: string; after: string }> = [];
    for (const account of data.accounts) {
      try {
        const status = accountState(account, data.payments.filter((payment) => payment.enrollmentId === account.id), today).status;
        if (status !== account.storedStatus) statuses.push({ account: account.id, before: account.storedStatus, after: status });
        await tx.update(schema.member_programs).set({ account_status: status }).where(sql`${schema.member_programs.enrollment_id} = ${account.id}`);
      } catch (error) { failing.push({ account: account.id, why: error instanceof Error ? error.message : "does not fit" }); }
    }
    if (failing.length) { console.table(failing); throw new Error(`${failing.length} restored accounts fail the account rules; nothing was saved.`); }

    // Incentives follow the NOP again, for collections not yet remitted.
    const kept = new Set(["Approved", "Remitted"]);
    const priced = { repriced: 0, slips: new Set<string>() };
    const unpriced: Array<{ collection: string; why: string }> = [];
    for (const item of restore.filter((entry) => !kept.has(entry.status ?? ""))) {
      try { const result = await repriceCollections(tx, [item.id]); priced.repriced += result.repriced; for (const slip of result.slips) priced.slips.add(slip); }
      catch (error) { unpriced.push({ collection: item.id, why: error instanceof Error ? error.message : "cannot price" }); }
    }
    console.log(`Account statuses changed: ${statuses.length}; incentives worked out again: ${priced.repriced}${priced.slips.size ? ` (slips ${[...priced.slips].join(", ")} follow)` : ""}; kept their figures (tiers): ${unpriced.length}.`);
    if (statuses.length) console.table(statuses);
    if (unpriced.length) console.table(unpriced);

    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Program move months restored", record_id: "program-moves",
      reason: "Owner, October 21, 2026 (found on PH-00555176): the program-move repair undid corrections made after the move. Collections with such a correction are back to their values just before the repair.",
      before_json: { repairRun: run.at, collections: restore.map((item) => item.id) }, after_json: { restored: restore.map(({ id, set }) => ({ id, ...set })), changedSince, statuses, repriced: priced.repriced, slips: [...priced.slips], unpriced },
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
    if (!apply) throw new PreviewDone();
    console.log(`Applied: ${restore.length} collections restored on ${accounts.length} accounts.`);
  }));
}

main().then(() => process.exit(0), (error) => {
  if (error instanceof PreviewDone) { console.log("Preview only: the restore ran and was rolled back. Add --apply to write."); process.exit(0); }
  console.error(error); process.exit(1);
});
