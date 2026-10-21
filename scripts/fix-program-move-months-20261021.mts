/**
 * RETIRED (October 21, 2026): do not run again. It took each collection's month from the first change after its move,
 * so it undid corrections made after the move (Source Month of / NOP correction, Receipt consolidation, Member split):
 * 362 collections on 43 accounts, found on PH-00555176 and put back by scripts/restore-program-move-repair-20261021.mts.
 *
 * Repairs Month of and NOP on accounts whose collections were moved between programs (owner, October 21, 2026: "when
 * transferring to another program the month of and NOP is mixed up"). Until today a move numbered the payments again
 * with months worked out from the DOI, which shifted every month on accounts whose DOI and NOPs do not line up (most
 * from the old system), and changing a New Sale's program moved the account without counting its receipts again at the
 * new pay. The code now starts from the account's own first payment (lib/entry-edit.ts numberingStart) and counts again.
 *
 * Accounts: those holding a posted collection whose program_id changed since October 1, 2026 (Audit Log). For each:
 *   - start: the current lowest NOP, at the month that payment covered before it was first moved (Audit Log "from");
 *   - months per receipt: as now, or, when the receipt's original program and the account's program differ in pay, the
 *     original months counted again at the current pay (receiptMonthsAt);
 *   - every posted payment numbered again in OR-date order from that start (renumber), and the history must pass the
 *     account rules, or the account is listed and left.
 * Changed collections not on an approved remittance get their incentives worked out again (repriceCollections; a
 * pending slip follows); those on approved remittances keep their figures. The account status is recalculated. Record
 * Corrections keeps a summary, the Audit Log every change. NOP numbering for registration-fee programs is left to
 * scripts/fix-registration-fee-nops-20261021.mts (run this one first).
 *
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/fix-program-move-months-20261021.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write; --all lists every change, not the first 200.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { accountState, todayInManila, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { encodedBy, inTransaction, schema } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { receiptMonthsAt, renumber, repriceCollections } from "@/lib/entry-edit";
import { createReadableId } from "@/lib/readable-id";

nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes("--i-know-it-is-retired")) { console.error("Retired: this repair undid later corrections. See the note at the top of the file."); process.exit(1); }
const apply = process.argv.includes("--apply"), all = process.argv.includes("--all");
const SINCE = "2026-10-01";
const rows = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
const list = (values: string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
type Original = { collection_id: string; moved_at: string; from_program: string | null; month_from: string | null; nop_from: number | null; nop_to: number | null };
type ProgramRow = { program_id: string; program_name: string; rate: number; flexible: boolean; max: number | null };

async function main() {
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table collections, member_programs in share row exclusive mode`);
    // Each moved collection: when it was first moved, from which program, and its month and NOPs before that move.
    const originals = rows<Original>(await tx.execute(sql`with moves as (
        select record_id as collection_id, min(logged_at) as moved_at from audit_log
        where table_name = 'collections' and lower(action) = 'update' and changes_json ? 'program_id' and logged_at >= ${SINCE}::date group by record_id),
      first_move as (
        select distinct on (a.record_id) a.record_id as collection_id, a.changes_json->'program_id'->>'from' as from_program
        from audit_log a join moves m on m.collection_id = a.record_id and a.logged_at = m.moved_at
        where a.table_name = 'collections' and a.changes_json ? 'program_id' order by a.record_id, a.row_seq),
      numbers as (
        select distinct on (a.record_id) a.record_id as collection_id, a.changes_json->'month_from'->>'from' as month_from,
          (a.changes_json->'nop_from'->>'from')::int as nop_from, (a.changes_json->'nop_to'->>'from')::int as nop_to
        from audit_log a join moves m on m.collection_id = a.record_id
        where a.table_name = 'collections' and lower(a.action) = 'update' and (a.changes_json ? 'month_from' or a.changes_json ? 'nop_from')
          and a.logged_at >= m.moved_at - interval '10 minutes' order by a.record_id, a.logged_at, a.row_seq)
      select m.collection_id, m.moved_at::text as moved_at, f.from_program, n.month_from, n.nop_from, n.nop_to
      from moves m left join first_move f on f.collection_id = m.collection_id left join numbers n on n.collection_id = m.collection_id`));
    const byCollection = new Map(originals.map((row) => [row.collection_id, row]));
    const moved = originals.map((row) => row.collection_id);
    const accountIds = moved.length ? rows<{ enrollment_id: string }>(await tx.execute(sql`select distinct enrollment_id from collections
      where collection_id in (${list(moved)}) and status = 'Posted' and enrollment_id is not null`)).map((row) => row.enrollment_id) : [];
    const programs = new Map(rows<ProgramRow>(await tx.execute(sql`select program_id, program_name, coalesce(base_pay, 0)::float8 as rate,
      coalesce(flexible, false) as flexible, max_monthly_payment::float8 as max from programs`)).map((row) => [row.program_id, row]));
    const rule = (program: ProgramRow) => ({ name: program.program_name, rate: program.rate, flexible: program.flexible, max: program.max });

    const data = accountIds.length ? await loadAccountData({ enrollmentIds: accountIds, includeDeactivated: true }, tx) : { accounts: [], payments: [] };
    const today = todayInManila();
    type Change = { account: string; program: string; collection: string; orDate: string; before: string; after: string; repriced: boolean };
    const changes: Change[] = [], left: Array<{ account: string; program: string; why: string }> = [];
    const plans: Array<{ account: string; status: string; payments: AccountPayment[] }> = [];
    let unchanged = 0;
    for (const account of data.accounts) {
      const payments = data.payments.filter((payment) => payment.enrollmentId === account.id && payment.nopFrom > 0);
      if (!payments.length) continue;
      try {
        const current = programs.get(account.programId);
        if (!current) throw new Error(`program ${account.programId} not found`);
        // The months each receipt covers now: its original months, counted again at the current pay when that differs.
        const span = (payment: AccountPayment) => {
          const original = byCollection.get(payment.id), from = original?.from_program ? programs.get(original.from_program) : undefined;
          const had = original?.nop_from && original.nop_to ? original.nop_to - original.nop_from + 1 : payment.nopTo - payment.nopFrom + 1;
          if (!from) return Math.max(1, payment.nopTo - payment.nopFrom + 1);
          const recount = receiptMonthsAt(rule(from), rule(current));
          return recount ? recount({ ...payment, nopFrom: 1, nopTo: had }) : had;
        };
        // Start: the current lowest NOP, at the month its payment covered before it was first moved.
        const lowest = [...payments].sort((a, b) => a.nopFrom - b.nopFrom || a.orDate.localeCompare(b.orDate))[0];
        const month = (byCollection.get(lowest.id)?.month_from || lowest.monthFrom).slice(0, 7);
        const planned = renumber({ nop: lowest.nopFrom, month }, payments, span);
        const status = accountState(account, planned, today).status;
        let changedHere = 0;
        for (const payment of planned) {
          const old = payments.find((item) => item.id === payment.id)!;
          if (old.nopFrom === payment.nopFrom && old.nopTo === payment.nopTo && old.monthFrom.slice(0, 7) === payment.monthFrom && old.monthTo.slice(0, 7) === payment.monthTo) continue;
          changedHere++;
          changes.push({ account: account.id, program: account.programName, collection: payment.id, orDate: payment.orDate,
            before: `NOP ${old.nopFrom}-${old.nopTo} ${old.monthFrom.slice(0, 7)}..${old.monthTo.slice(0, 7)}`,
            after: `NOP ${payment.nopFrom}-${payment.nopTo} ${payment.monthFrom}..${payment.monthTo}`, repriced: false });
        }
        if (changedHere) plans.push({ account: account.id, status, payments: planned });
        else unchanged++;
      } catch (error) {
        left.push({ account: account.id, program: account.programName, why: error instanceof Error ? error.message : "does not fit" });
      }
    }

    // Collections on an approved remittance keep their figures.
    const changedIds = changes.map((change) => change.collection);
    const approved = new Set(changedIds.length ? rows<{ id: string }>(await tx.execute(sql`select collection_id as id from collections
      where collection_id in (${list(changedIds)}) and remittance_status = 'Approved'`)).map((row) => row.id) : []);
    for (const change of changes) change.repriced = !approved.has(change.collection);

    console.log(`Collections moved between programs since ${SINCE}: ${moved.length}, on ${accountIds.length} accounts.`);
    console.log(`  accounts to repair: ${plans.length} (${changes.length} collections); already right: ${unchanged}; left (listed): ${left.length}`);
    console.log(`  incentives worked out again: ${changes.filter((change) => change.repriced).length}; on approved remittances, kept: ${approved.size}`);
    console.table((all ? changes : changes.slice(0, 200)));
    if (!all && changes.length > 200) console.log(`... ${changes.length - 200} more; add --all to list every one.`);
    if (left.length) console.table(left);

    if (!apply) { console.log("Preview only. Add --apply to write."); return; }
    for (const plan of plans) {
      for (const payment of plan.payments) {
        await tx.update(schema.collections).set({ nop_from: payment.nopFrom, nop_to: payment.nopTo, month_from: payment.monthFrom, month_to: payment.monthTo })
          .where(sql`${schema.collections.collection_id} = ${payment.id}`);
      }
      await tx.update(schema.member_programs).set({ account_status: plan.status }).where(sql`${schema.member_programs.enrollment_id} = ${plan.account}`);
    }
    const priced = await repriceCollections(tx, changes.filter((change) => change.repriced).map((change) => change.collection));
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Program move months", record_id: "program-moves",
      reason: "Owner, October 21, 2026: moves between programs mixed up Month of and NOP. Months continue again from each account's first payment as it was before the move; receipts counted again at the current pay where it differs.",
      before_json: { changes: changes.map(({ collection, before }) => ({ collection, before })) },
      after_json: { changes: changes.map(({ collection, after }) => ({ collection, after })), accounts: plans.map((plan) => ({ account: plan.account, status: plan.status })), repriced: priced.repriced, slips: priced.slips },
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
    console.log(`Applied: ${changes.length} collections on ${plans.length} accounts; ${priced.repriced} with new incentives${priced.slips.length ? `; slips ${priced.slips.join(", ")} follow` : ""}.`);
  }));
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
