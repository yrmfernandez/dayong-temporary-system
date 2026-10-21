/**
 * Scope (owner, October 21, 2026, after the production preview): only accounts started in this system, the account and
 * every collection created here (no LEG id). The old system and its receipts numbered these programs from NOP 2 too
 * (9,741 collections on production), so that history keeps its NOPs and continues from its own numbering.
 *
 * Registration-fee programs number NOPs from 1 (owner, October 21, 2026): the New Sale pays the registration only, so
 * the first collection, for the month after DOI, is NOP 1 (lib/account-rules.ts saleNops). Before, every New Sale was
 * NOP 1 and the first collection NOP 2. This lowers every NOP by one on the accounts of registration-fee programs that
 * were numbered the old way (each posted collection's first month is the DOI month plus NOP - 1); the months stay.
 * Accounts already numbered the new way are left; accounts whose collections fit neither way are listed, not changed.
 *
 * Incentives follow the NOP (NOP 1 uses the month-1 tier), so collections not yet remitted are worked out again
 * (repriceCollections: a pending slip's expected amount follows). Remitted or approved collections keep their figures. One collection at a time: one whose program has no single incentive tier for its new NOP in its branch keeps
 * its figures and is listed, so a tier set-up gap does not stop the fix. The preview does the whole fix and rolls it back,
 * so it shows those too. One transaction; the Audit Log keeps every change and Record Corrections a summary.
 *
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/fix-registration-fee-nops-20261021.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write.
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { accountState, monthIndex, todayInManila, type AccountPayment } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { encodedBy, inTransaction, schema } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { repriceCollections } from "@/lib/entry-edit";
import { createReadableId } from "@/lib/readable-id";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply"), countsOnly = process.argv.includes("--counts");
const rows = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
type Row = { enrollment_id: string; doi: string; program_name: string; collection_id: string; nop_from: number; nop_to: number; month_from: string; remittance_status: string | null };

async function main() {
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table collections, member_programs in share row exclusive mode`);
    const found = rows<Row>(await tx.execute(sql`select mp.enrollment_id, mp.doi::text as doi, p.program_name, c.collection_id, c.nop_from, c.nop_to,
        left(c.month_from, 7) as month_from, c.remittance_status
      from member_programs mp
      join programs p on p.program_id = mp.program_id and p.registration_fee_required
      join collections c on c.enrollment_id = mp.enrollment_id and c.status = 'Posted' and c.nop_from is not null
      where mp.doi is not null order by mp.enrollment_id, c.nop_from`));
    const byAccount = new Map<string, Row[]>();
    for (const row of found) byAccount.set(row.enrollment_id, [...(byAccount.get(row.enrollment_id) ?? []), row]);

    // Each collection's first month less the DOI month less its NOP: -1 under the old rule, 0 under the new.
    const old: Row[][] = [], irregular: Array<{ account: string; program: string; offsets: number[] }> = [];
    let alreadyNew = 0, oldSystem = 0;
    const legacy = (id: string) => id.includes("-LEG-");
    for (const [account, list] of byAccount) {
      // Old-system accounts and collections keep the numbering on their receipts.
      if (legacy(account) || list.some((row) => legacy(row.collection_id))) { oldSystem++; continue; }
      const offsets = [...new Set(list.map((row) => /^\d{4}-\d{2}$/.test(row.month_from) ? monthIndex(row.month_from) - monthIndex(row.doi.slice(0, 7)) - row.nop_from : NaN))];
      if (offsets.length === 1 && offsets[0] === -1) old.push(list);
      else if (offsets.length === 1 && offsets[0] === 0) alreadyNew++;
      else irregular.push({ account, program: list[0].program_name, offsets });
    }

    // The renumbered history must still pass the account rules.
    const today = todayInManila();
    const data = await loadAccountData({ enrollmentIds: old.map((list) => list[0].enrollment_id), includeDeactivated: true }, tx);
    const fixable: Row[][] = [], failing: Array<{ account: string; why: string }> = [];
    for (const list of old) {
      const account = data.accounts.find((item) => item.id === list[0].enrollment_id);
      if (!account) { failing.push({ account: list[0].enrollment_id, why: "account not loaded" }); continue; }
      const shifted: AccountPayment[] = data.payments.filter((payment) => payment.enrollmentId === account.id).map((payment) => ({ ...payment, nopFrom: payment.nopFrom - 1, nopTo: payment.nopTo - 1 }));
      try { accountState({ ...account, registrationFee: true }, shifted, today); fixable.push(list); }
      catch (error) { failing.push({ account: account.id, why: error instanceof Error ? error.message : "does not fit" }); }
    }

    const collections = fixable.flat();
    const kept = new Set(["Approved", "Remitted"]);
    const reprice = collections.filter((row) => !kept.has(row.remittance_status ?? "")).map((row) => row.collection_id);
    const byProgram = new Map<string, number>();
    for (const list of fixable) byProgram.set(list[0].program_name, (byProgram.get(list[0].program_name) ?? 0) + 1);
    console.log(`Registration-fee accounts with collections: ${byAccount.size}`);
    console.log(`  numbered the old way (to fix): ${fixable.length} accounts, ${collections.length} collections`);
    console.log(`  old-system accounts, left as numbered on their receipts: ${oldSystem}`);
    console.log(`  already numbered from NOP 1: ${alreadyNew}`);
    console.log(`  fit neither way (left, listed): ${irregular.length}`);
    console.log(`  would break the account rules (left, listed): ${failing.length}`);
    console.log(`Incentives worked out again: ${reprice.length} collections not yet remitted; ${collections.length - reprice.length} remitted or approved keep their figures.`);
    console.table([...byProgram].map(([program, accounts]) => ({ program, accounts })));
    const statuses = new Map<string, number>();
    for (const row of collections) statuses.set(row.remittance_status ?? "(none)", (statuses.get(row.remittance_status ?? "(none)") ?? 0) + 1);
    console.log(`  remittance status: ${[...statuses].map(([status, count]) => `${status} ${count}`).join(", ")}`);
    if (irregular.length) console.table(irregular.slice(0, 50).map((item) => ({ ...item, offsets: item.offsets.join(" ") })));
    if (failing.length) console.table(failing.slice(0, 50));

    if (countsOnly) throw new PreviewDone();
    const ids = collections.map((row) => row.collection_id);
    if (ids.length) {
      await tx.execute(sql`update collections set nop_from = nop_from - 1, nop_to = nop_to - 1 where collection_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    // One at a time: a collection whose tiers cannot price its new NOP keeps its figures and is listed (repriceCollections
    // throws before writing anything for it).
    const priced = { repriced: 0, slips: new Set<string>() };
    const unpriced: Array<{ collection: string; program: string; branch: string; nop: string; why: string }> = [];
    for (const id of reprice) {
      try { const result = await repriceCollections(tx, [id]); priced.repriced += result.repriced; for (const slip of result.slips) priced.slips.add(slip); }
      catch (error) {
        const [row] = rows<{ program: string; branch: string; nop: string }>(await tx.execute(sql`select coalesce(p.program_name, c.program_id) as program, coalesce(c.branch, '') as branch,
          c.nop_from || '-' || c.nop_to as nop from collections c left join programs p on p.program_id = c.program_id where c.collection_id = ${id}`));
        unpriced.push({ collection: id, program: row?.program ?? "", branch: row?.branch ?? "", nop: row?.nop ?? "", why: (error instanceof Error ? error.message : "cannot price").replace(/^Cannot recalculate incentives for \S+: /, "").replace(/ Nothing was saved\.$/, "") });
      }
    }
    console.log(`Incentives: ${priced.repriced} changed; ${unpriced.length} kept their figures because the program's tiers cannot price the new NOP (listed).`);
    if (unpriced.length) console.table(unpriced);
    if (!apply) throw new PreviewDone();
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Registration fee NOP numbering", record_id: "registration-fee-programs",
      reason: "Owner, October 21, 2026: on a program with a registration fee the first collection is NOP 1; accounts started in this system and numbered from NOP 2 were renumbered (months unchanged) and incentives not yet remitted worked out again. Old-system history keeps the NOPs on its receipts.",
      before_json: { accounts: fixable.map((list) => list[0].enrollment_id), collections: ids }, after_json: { nopLoweredBy: 1, repriced: priced.repriced, slips: [...priced.slips], unpriced },
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
    console.log(`Applied: ${ids.length} collections renumbered on ${fixable.length} accounts; ${priced.repriced} with new incentives${priced.slips.size ? `; slips ${[...priced.slips].join(", ")} follow` : ""}${unpriced.length ? `; ${unpriced.length} kept their figures (tiers listed above)` : ""}.`);
  }));
}

/** Ends a preview: everything the fix did is rolled back. */
class PreviewDone extends Error {}

main().then(() => process.exit(0), (error) => {
  if (error instanceof PreviewDone) { console.log("Preview only: the fix ran and was rolled back. Add --apply to write."); process.exit(0); }
  console.error(error); process.exit(1);
});
