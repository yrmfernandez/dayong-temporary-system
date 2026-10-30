/**
 * Recalculates the incentive and company share of old-workbook entries (IDs with -LEG-) recorded under Entry Clerks
 * on October 1-11, 2026 (report weeks 1 and 2), with the current program rules (owner, October 30, 2026). The workbook
 * had no company share, so those entries showed almost no incentive on the clerks' reports. Gross amounts, receipts and
 * cash are not changed; entries forfeited or marked No incentive stay remitted whole (lib/entry-finance.mjs).
 *
 *   node scripts/reprice-legacy-weeks.mjs                     plan on staging (.env.local): reads only
 *   npm run prod -- node scripts/reprice-legacy-weeks.mjs [--apply]
 *
 * The plan prices each entry as repriceEntries does, without a transaction or locks; an entry the rules cannot price
 * (a missing incentive tier) is left as it is and listed by ID. --apply then reprices the rest in one repriceEntries
 * call, in one transaction. Prints clerk names, counts and totals only.
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { repriceEntries } from "../lib/entry-finance.mjs";
import { calculateRemittance, calculateSaleIncentive, tiersForBranch } from "../lib/remittance.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const FROM = "2026-10-01", TO = "2026-10-11";
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const week = (day) => (day <= "2026-10-04" ? "Week 1 (Oct 1-4)" : "Week 2 (Oct 5-11)");

const sql = postgres(url, { max: 1, onnotice: () => {} });
console.log(`Supabase project ${project}.${apply ? "" : " Plan only: nothing is written."}\n`);
try {
  const collections = await sql`select c.collection_id as id, c.encoded_by_name as clerk, (c.encoded_at at time zone 'Asia/Manila')::date::text as day,
      c.program_id, coalesce(c.branch_id, b.branch_id, '') as pricing_branch_id, c.amount_collected::float8 as amount, c.nop_from, c.nop_to,
      c.collected_by_role, c.accountable_role, c.reactivation, c.remittance_amount::float8 as remittance_amount, c.remittance_breakdown,
      c.forfeited_incentive::float8 as forfeited_incentive, c.no_incentive_reason, p.base_pay::float8 as rate, p.flexible, p.max_monthly_payment::float8 as maximum
    from collections c join programs p on p.program_id = c.program_id left join branches b on lower(trim(b.branch_name_code)) = lower(trim(c.branch))
    where c.collection_id like '%-LEG-%' and c.status = 'Posted' and coalesce(c.encoded_by_employee_id, '') <> ''
      and (c.encoded_at at time zone 'Asia/Manila')::date between ${FROM} and ${TO}`;
  const sales = await sql`select s.sale_id as id, s.encoded_by_name as clerk, (s.encoded_at::timestamptz at time zone 'Asia/Manila')::date::text as day,
      s.program_id, coalesce(s.branch_id, b.branch_id, '') as pricing_branch_id, s.amount_paid::float8 as amount, s.remittance_amount::float8 as remittance_amount,
      s.forfeited_incentive::float8 as forfeited_incentive, s.no_incentive_reason, p.base_pay::float8 as rate, p.flexible, p.max_monthly_payment::float8 as maximum,
      p.registration_fee_required, p.new_sale_incentive_type, p.new_sale_incentive_amount::float8 as new_sale_incentive_amount
    from sales s join programs p on p.program_id = s.program_id left join branches b on lower(trim(b.branch_name_code)) = lower(trim(s.branch))
    where s.sale_id like '%-LEG-%' and coalesce(s.encoded_by_employee_id, '') <> ''
      and (s.encoded_at::timestamptz at time zone 'Asia/Manila')::date between ${FROM} and ${TO}`;
  const tierRows = await sql`select * from program_incentives`;
  const tiersOf = (row) => tiersForBranch(tierRows.filter((tier) => tier.program_id === row.program_id).map((tier) => ({
    id: tier.incentive_id, role: tier.role, fromMonth: Number(tier.from_month), toMonth: Number(tier.to_month), incentiveType: tier.incentive_type,
    markUp: Number(tier.mark_up || 0), incentiveAmount: Number(tier.incentive_amount || 0), branchId: tier.branch_id || "", nonCommissionable: Boolean(tier.non_commissionable),
  })), row.pricing_branch_id);

  // The plan: the same pricing as lib/entry-finance.mjs repriceEntries.
  const totals = new Map(), skipped = [], plan = { collectionIds: [], saleIds: [] };
  let changed = 0;
  for (const [kind, rows] of [["Collection", collections], ["New Sale", sales]]) for (const row of rows) {
    const key = `${week(row.day)}|${row.clerk}|${kind}`;
    const line = totals.get(key) ?? { week: week(row.day), clerk: row.clerk, kind, entries: 0, changed: 0, gross: 0, incentiveBefore: 0, incentiveAfter: 0 };
    line.entries++; line.gross = money(line.gross + row.amount);
    const before = row.remittance_amount == null ? 0 : money(row.amount - row.remittance_amount);
    line.incentiveBefore = money(line.incentiveBefore + before);
    let after = before;
    try {
      const tiers = tiersOf(row);
      let remittance;
      if (kind === "Collection") {
        const breakdown = json(row.remittance_breakdown);
        const channel = row.collected_by_role || row.accountable_role || "MAS";
        const role = channel === "Collector" ? "Collector" : channel === "DTO" ? "DTO" : "MAS";
        const orc = role === "Collector" && Array.isArray(breakdown) && breakdown.some((part) => part?.orc === true);
        remittance = calculateRemittance(row.rate, tiers, role, row.nop_from, row.nop_to, row.amount, row.flexible, row.maximum, { orc, reactivation: row.reactivation === true }).remittance;
      } else {
        remittance = calculateSaleIncentive({ basePay: row.rate, flexible: row.flexible, maxMonthlyPayment: row.maximum, registrationFeeRequired: row.registration_fee_required,
          saleIncentiveType: row.new_sale_incentive_type || "", saleIncentiveAmount: row.new_sale_incentive_amount || 0, incentiveTiers: tiers }, row.amount).remittance;
      }
      const forfeited = Number(row.forfeited_incentive || 0) > 0 || Boolean(String(row.no_incentive_reason ?? "").trim());
      after = money(row.amount - money(forfeited ? row.amount : remittance));
      (kind === "Collection" ? plan.collectionIds : plan.saleIds).push(row.id);
      if (row.remittance_amount == null || Math.abs(after - before) > 0.009) { line.changed++; changed++; }
    } catch (failure) {
      skipped.push(`${kind} ${row.id} (${row.clerk}, ${row.day}): ${failure instanceof Error ? failure.message : failure}`);
    }
    line.incentiveAfter = money(line.incentiveAfter + after);
    totals.set(key, line);
  }
  const rows = [...totals.values()].sort((a, b) => `${a.week}${a.clerk}${a.kind}`.localeCompare(`${b.week}${b.clerk}${b.kind}`));
  console.table(rows);
  const sum = (pick) => money(rows.reduce((total, row) => total + pick(row), 0));
  console.log(`Entries: ${sum((row) => row.entries)}; to recalculate: ${changed}. Incentive ${sum((row) => row.incentiveBefore)} → ${sum((row) => row.incentiveAfter)} (gross ${sum((row) => row.gross)} unchanged).`);
  if (skipped.length) console.log(`\nLeft as they are, the rules cannot price them (${skipped.length}):\n${skipped.join("\n")}`);

  if (apply) {
    const result = await sql.begin((tx) => repriceEntries((text, params) => tx.unsafe(text, params), plan));
    console.log(`\nApplied: ${result.changes.length} entries recalculated; remittance slips adjusted: ${result.slips.length}. Incentive of the repriced entries now ${result.incentiveTotal}.`);
  } else console.log("\nPlan only. Add --apply to write.");
} finally {
  await sql.end();
}
