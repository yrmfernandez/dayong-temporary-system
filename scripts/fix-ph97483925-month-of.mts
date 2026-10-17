/**
 * Owner-confirmed coverage, October 17, 2026: PH-97483925 (D-300 (Bracketing), DOI 2023-02-01, BUHANGIN). The old
 * sheet (2026 DATABASE, M2-COLL) has the 2026 receipts as Month of January to September with NOP 36 to 44 (one row
 * typed NOP 7, which the import took as the start, so they landed on August 2023 to April 2024 with NOP 7 to 15).
 * Each receipt moves to its month: 973B January (NOP 36) through 14715 B September (NOP 44), and 16284B, encoded in
 * this system on October 12, continues as October (NOP 45). Receipt dates and amounts stay. The incentive and company
 * share follow the corrected NOPs (lib/entry-edit.ts repriceCollections: NOP 36+ is the 12% MAS tier, not 40%), and
 * the account status is worked out again (it was stored Forfeited from the wrong months).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/fix-ph97483925-month-of.mts                       staging (dry run)
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/fix-ph97483925-month-of.mts          production dry run
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/fix-ph97483925-month-of.mts --apply  production
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "unknown";
const { runAsSystem } = await import("../lib/encoder-context");
const { inTransaction, schema } = await import("../lib/db");
const { repriceCollections } = await import("../lib/entry-edit");
const { accountState, todayInManila } = await import("../lib/account-rules");
const { and, eq, sql } = await import("drizzle-orm");

const member = "PH-97483925", enrollment = "ENR-LEG-4F3C2FA919";
// OR number as stored, OR date, the NOP it has now, the month and NOP it should have.
const plan: Array<[string, string, number, string, number]> = [
  ["973B", "2026-01-11", 7, "2026-01", 36],
  ["1878 B", "2026-02-15", 8, "2026-02", 37],
  ["2526B", "2026-03-10", 9, "2026-03", 38],
  ["3740B", "2026-04-18", 10, "2026-04", 39],
  ["6650B", "2026-05-12", 11, "2026-05", 40],
  ["8575B", "2026-06-11", 12, "2026-06", 41],
  ["10597B", "2026-07-19", 13, "2026-07", 42],
  ["13131 B", "2026-08-20", 14, "2026-08", 43],
  ["14715 B", "2026-09-15", 15, "2026-09", 44],
  ["16284B", "2026-10-12", 16, "2026-10", 45],
];
class DryRun extends Error {}
console.log(`Supabase project: ${project}${apply ? "" : " · dry run"}`);

try {
  await runAsSystem(() => inTransaction(async (tx) => {
    const c = schema.collections, mp = schema.member_programs;
    const [account] = await tx.select().from(mp).where(eq(mp.enrollment_id, enrollment)).for("update");
    if (!account || account.member_number !== member || String(account.doi) !== "2023-02-01" || account.program_id !== "DP-0067") throw new Error("Account, DOI or program differs; stop for review.");
    const rows = await tx.select().from(c).where(eq(c.enrollment_id, enrollment)).for("update");
    if (rows.length !== plan.length) throw new Error(`Expected ${plan.length} receipts, found ${rows.length}; stop for review.`);
    const after = plan.map(([or, date, nopNow, month, nop]) => {
      const row = rows.find((item) => item.or_number === or);
      if (!row || String(row.or_date) !== date || Number(row.amount_collected) !== 300 || row.status !== "Posted" || row.nop_from !== nopNow || row.nop_to !== nopNow) throw new Error(`Unexpected receipt data: ${or}`);
      return { id: row.collection_id, or, date, month, nop, before: { month_from: row.month_from, month_to: row.month_to, nop_from: row.nop_from, nop_to: row.nop_to, remittance_amount: row.remittance_amount } };
    });
    for (const item of after) await tx.update(c).set({ month_from: item.month, month_to: item.month, nop_from: item.nop, nop_to: item.nop }).where(and(eq(c.collection_id, item.id), eq(c.enrollment_id, enrollment)));
    const priced = await repriceCollections(tx, after.map((item) => item.id));
    const [program] = await tx.select().from(schema.programs).where(eq(schema.programs.program_id, "DP-0067"));
    const state = accountState({ id: enrollment, memberId: account.member_id, memberNumber: member, programId: "DP-0067", doi: "2023-02-01", branch: "", mas: "", basePay: Number(program.base_pay), payBalanceTotal: Number(program.pay_balance_total ?? 0), storedStatus: "", flexible: Boolean(program.flexible), maxMonthlyPayment: program.max_monthly_payment === null ? null : Number(program.max_monthly_payment) },
      after.map((item) => ({ id: item.id, enrollmentId: enrollment, orDate: item.date, orNumber: item.or, monthFrom: item.month, monthTo: item.month, nopFrom: item.nop, nopTo: item.nop, amount: 300, dateRemitted: "", mas: "" })));
    await tx.update(mp).set({ account_status: state.status }).where(eq(mp.enrollment_id, enrollment));
    const shares = await tx.select({ or: c.or_number, share: c.remittance_amount }).from(c).where(eq(c.enrollment_id, enrollment));
    const stamp = new Date().toISOString();
    await tx.insert(schema.record_corrections).values({
      correction_id: `COR-COV-${member}-${Date.now().toString(36).toUpperCase()}`, module: "Payment coverage", record_id: enrollment,
      reason: "Owner confirmed October 17, 2026: the old sheet (2026 DATABASE, M2-COLL) has 973B as Month of January 2026, NOP 36, and the later receipts month by month through 14715 B, September, NOP 44 (one row typed NOP 7, which the import took as the start). 16284B continues as October, NOP 45. Receipt dates and amounts unchanged; incentive and company share follow the corrected NOPs; status worked out again.",
      before_json: { status: account.account_status, receipts: after.map((item) => ({ or: item.or, ...item.before })) },
      after_json: { status: state.status, receipts: after.map((item) => ({ or: item.or, month: item.month, nop: item.nop, share: shares.find((s) => s.or === item.or)?.share })) },
      corrected_at: stamp, encoded_by_name: "Owner-confirmed payment coverage correction", encoded_at: stamp,
    });
    console.log(JSON.stringify({ member, statusBefore: account.account_status, statusAfter: state.status, paidThrough: state.paidThrough, nextMonth: state.nextMonth, nextNop: state.nextNop, repriced: priced.repriced, slipsTouched: priced.slips,
      receipts: after.map((item) => `${item.or} ${item.date}: ${item.before.month_from} NOP ${item.before.nop_from} (share ${item.before.remittance_amount}) -> ${item.month} NOP ${item.nop} (share ${shares.find((s) => s.or === item.or)?.share})`) }, null, 2));
    void sql;
    if (!apply) throw new DryRun();
  }));
  console.log("Applied.");
} catch (error) { if (error instanceof DryRun) console.log("Dry run rolled back."); else throw error; }
process.exit(0);
