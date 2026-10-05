import { eq, inArray } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/*
 * Program incentive tiers (program_incentives). A blank branch_id is the program's base tier for every branch; a
 * branch's own tiers replace the base tiers for that role in that branch (lib/remittance.ts tiersForBranch).
 */
export type StoredTier = { role: "MAS" | "Collector"; fromMonth: number; toMonth: number; incentiveType: "fixed" | "percentage"; markUp: number; incentiveAmount: number; branchId?: string };

const text = (value: unknown) => String(value ?? "").trim();

/** Throws when a tier is invalid, names an unknown branch, or overlaps another tier of the same role and branch. */
export async function validateIncentiveTiers(tiers: StoredTier[], basePay: number) {
  if (!tiers.some((tier) => !text(tier.branchId))) throw new Error("Add at least one base incentive tier (All branches).");
  for (const tier of tiers) {
    if (!Number.isInteger(tier.fromMonth) || !Number.isInteger(tier.toMonth) || tier.fromMonth < 1 || tier.toMonth < tier.fromMonth) throw new Error("Enter valid whole-month incentive ranges.");
    if (!Number.isFinite(tier.markUp) || tier.markUp < 0 || tier.markUp > basePay || !Number.isFinite(tier.incentiveAmount) || tier.incentiveAmount < 0 || (tier.incentiveType === "percentage" && tier.incentiveAmount > 100)) throw new Error("Enter valid mark-up and incentive amounts.");
  }
  const branchIds = [...new Set(tiers.map((tier) => text(tier.branchId)).filter(Boolean))];
  if (branchIds.length) {
    const known = new Set((await currentDb().select({ id: schema.branches.branch_id }).from(schema.branches).where(inArray(schema.branches.branch_id, branchIds))).map((row) => row.id));
    const unknown = branchIds.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`Unknown branch in the incentive tiers: ${unknown.join(", ")}.`);
  }
  tiers.forEach((tier, index) => tiers.forEach((other, otherIndex) => {
    if (index < otherIndex && tier.role === other.role && text(tier.branchId) === text(other.branchId) && tier.fromMonth <= other.toMonth && other.fromMonth <= tier.toMonth) {
      throw new Error(`${tier.role} incentive tiers for ${text(tier.branchId) ? `branch ${text(tier.branchId)}` : "all branches"} cannot overlap.`);
    }
  }));
}

/** Writes a program's tiers, replacing any it already has, in one transaction. */
export async function writeProgramIncentives(programId: string, tiers: StoredTier[]) {
  await inTransaction(async (tx) => {
    await tx.delete(schema.program_incentives).where(eq(schema.program_incentives.program_id, programId));
    if (!tiers.length) return;
    const identity = encodedBy();
    await tx.insert(schema.program_incentives).values(tiers.map((tier) => ({
      incentive_id: createReadableId("INC"), program_id: programId, role: tier.role, from_month: tier.fromMonth, to_month: tier.toMonth,
      incentive_type: tier.incentiveType, mark_up: Number(tier.markUp) || 0, incentive_amount: Number(tier.incentiveAmount) || 0,
      branch_id: text(tier.branchId) || null, ...identity,
    })));
  });
}
