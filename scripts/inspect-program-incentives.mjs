/**
 * Read-only: how a program's incentives are set up per period, and how its collections at one NOP were actually priced
 * (owner, October 24, 2026: program 420 at NOP 6 showed 30% instead of 50%). Prints, for every program whose code or
 * name contains the text given:
 *   - its incentive tiers: role, months (NOP from-to), fixed/percentage, amount, mark-up, branch (blank = all branches),
 *     non-commissionable;
 *   - the tiers that apply in each branch that has its own tiers (lib/remittance.ts tiersForBranch);
 *   - its latest posted collections covering that NOP: OR, dates, branch, collected by, NOP, amount, company share, and
 *     the tier the saved breakdown used for that NOP, with what the current tiers would give now.
 * IDs, OR numbers, dates and amounts only; no member names. Nothing is written.
 *
 *   node scripts/inspect-program-incentives.mjs 420 6                       staging
 *   npm run prod -- node scripts/inspect-program-incentives.mjs 420 6       production
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { calculateRemittance, tiersForBranch } from "../lib/remittance.ts";

nextEnv.loadEnvConfig(process.cwd());
const [match = "420", nopText = "6"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const nop = Number(nopText);
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";
const tierLabel = (tier) => `${tier.role} NOP ${tier.fromMonth}-${tier.toMonth}: ${tier.incentiveType === "percentage" ? `${tier.incentiveAmount}%` : `₱${tier.incentiveAmount}`}${tier.markUp ? ` (mark-up ₱${tier.markUp})` : ""}${tier.branchName ? ` · branch ${tier.branchName}` : " · all branches"}${tier.nonCommissionable ? " · non-commissionable" : ""}`;

try {
  console.log(`Database ${ref} (read only) · programs matching "${match}" · NOP ${nop}`);
  const programs = await sql`select program_id, program_code, program_name, base_pay::float8 as rate, registration_fee_required as reg, flexible, status
    from programs where program_code ilike ${`%${match}%`} or program_name ilike ${`%${match}%`} order by program_code`;
  for (const program of programs) {
    console.log(`\n=== ${program.program_code || program.program_name} (${program.program_id}) · ₱${program.rate}/month${program.reg ? " · registration fee" : ""}${program.flexible ? " · flexible" : ""} · ${program.status}`);
    const rows = await sql`select i.incentive_id, i.role, i.from_month, i.to_month, i.incentive_type, coalesce(i.mark_up, 0)::float8 as mark_up, coalesce(i.incentive_amount, 0)::float8 as amount,
        coalesce(i.branch_id, '') as branch_id, coalesce(b.branch_name_code, '') as branch_name, coalesce(i.non_commissionable, false) as non_commissionable
      from program_incentives i left join branches b on b.branch_id = i.branch_id where i.program_id = ${program.program_id} order by i.role, coalesce(b.branch_name_code, ''), i.from_month`;
    const tiers = rows.map((row) => ({ id: row.incentive_id, role: row.role, fromMonth: row.from_month, toMonth: row.to_month, incentiveType: row.incentive_type, markUp: row.mark_up, incentiveAmount: row.amount, branchId: row.branch_id, branchName: row.branch_name, nonCommissionable: row.non_commissionable }));
    if (!tiers.length) { console.log("  No incentive tiers."); continue; }
    console.log("  Tiers as saved:");
    for (const tier of tiers) console.log(`    ${tier.id} · ${tierLabel(tier)}`);
    const overlaps = tiers.filter((a, i) => tiers.some((b, j) => j > i && a.role === b.role && a.branchId === b.branchId && a.fromMonth <= b.toMonth && b.fromMonth <= a.toMonth));
    if (overlaps.length) console.log(`  WARNING overlapping tiers: ${overlaps.map((tier) => tier.id).join(", ")}`);
    const atNop = tiers.filter((tier) => tier.fromMonth <= nop && nop <= tier.toMonth);
    console.log(`  Tiers covering NOP ${nop}: ${atNop.length ? atNop.map((tier) => tierLabel(tier)).join(" | ") : "none"}`);
    for (const branchId of [...new Set(tiers.map((tier) => tier.branchId).filter(Boolean))]) {
      const applied = tiersForBranch(tiers, branchId).filter((tier) => tier.fromMonth <= nop && nop <= tier.toMonth);
      console.log(`  In branch ${tiers.find((tier) => tier.branchId === branchId)?.branchName || branchId}, NOP ${nop} uses: ${applied.map((tier) => tierLabel(tier)).join(" | ") || "none"}`);
    }

    const receipts = await sql`select c.collection_id, c.or_number, c.or_date::text as or_date, c.encoded_at::text as encoded_at, c.branch, coalesce(c.branch_id, '') as branch_id, coalesce(c.collected_by_role, 'MAS') as role,
        c.nop_from, c.nop_to, c.amount_collected::float8 as amount, c.remittance_amount::float8 as share, c.remittance_breakdown as breakdown, c.reactivation, coalesce(c.no_incentive_reason, '') as no_incentive, coalesce(c.forfeited_incentive, 0)::float8 as forfeited
      from collections c where c.program_id = ${program.program_id} and c.status = 'Posted' and c.nop_from <= ${nop} and ${nop} <= c.nop_to
      order by c.encoded_at desc nulls last limit 15`;
    console.log(`  Latest posted collections covering NOP ${nop}: ${receipts.length}`);
    for (const receipt of receipts) {
      const saved = (Array.isArray(receipt.breakdown) ? receipt.breakdown : []).find((item) => item?.nop === nop);
      let now = "";
      try {
        const quote = calculateRemittance(program.rate, tiersForBranch(tiers, receipt.branch_id), receipt.role === "Collector" ? "Collector" : receipt.role === "DTO" ? "DTO" : "MAS", receipt.nop_from, receipt.nop_to, receipt.amount, program.flexible, null, { reactivation: receipt.reactivation === true, orc: Array.isArray(receipt.breakdown) && receipt.breakdown.some((item) => item?.orc === true) });
        const item = quote.breakdown.find((entry) => entry.nop === nop);
        now = item ? `${item.incentiveType === "percentage" ? `${item.incentiveAmount}%` : `₱${item.incentiveAmount}`} = ₱${item.incentive}` : "";
      } catch (error) { now = `cannot price: ${error instanceof Error ? error.message : error}`; }
      console.log(`    ${receipt.collection_id} · OR ${receipt.or_number} · OR date ${receipt.or_date} · encoded ${String(receipt.encoded_at ?? "").slice(0, 10)} · ${receipt.branch} · ${receipt.role}${receipt.reactivation ? " · REACTIVATION" : ""}${receipt.no_incentive ? " · NO INCENTIVE" : ""}${receipt.forfeited ? ` · forfeited ₱${receipt.forfeited}` : ""}`);
      console.log(`       NOP ${receipt.nop_from}-${receipt.nop_to} · ₱${receipt.amount} · company share ₱${receipt.share} · saved NOP ${nop}: ${saved ? `${saved.incentiveType === "percentage" ? `${saved.incentiveAmount}%` : `₱${saved.incentiveAmount}`} = ₱${saved.incentive} (tier ${saved.tierId || "—"}${saved.reactivation ? ", reactivation" : ""}${saved.orc ? ", ORC" : ""})` : "no breakdown saved"} · current tiers give: ${now}`);
    }
  }
} finally {
  await sql.end();
}
