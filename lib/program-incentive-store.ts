import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";
import { deleteRowsWhere } from "@/lib/sheet-rows";

/*
 * Program Incentives: A incentive_id, B program_id, C role, D from_month, E to_month, F incentive_type, G mark_up,
 * H incentive_amount, I:L encoder identity, M branch_id. A blank branch_id is the program's base tier for every branch;
 * a branch's own tiers replace the base tiers for that role in that branch (lib/remittance.ts tiersForBranch).
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
    const known = new Set(((await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Branches!A:A" })).data.values ?? []).slice(1).map((row) => text(row[0])));
    const unknown = branchIds.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`Unknown branch in the incentive tiers: ${unknown.join(", ")}.`);
  }
  tiers.forEach((tier, index) => tiers.forEach((other, otherIndex) => {
    if (index < otherIndex && tier.role === other.role && text(tier.branchId) === text(other.branchId) && tier.fromMonth <= other.toMonth && other.fromMonth <= tier.toMonth) {
      throw new Error(`${tier.role} incentive tiers for ${text(tier.branchId) ? `branch ${text(tier.branchId)}` : "all branches"} cannot overlap.`);
    }
  }));
}

/** Writes a program's tiers, replacing any it already has. */
export async function writeProgramIncentives(programId: string, tiers: StoredTier[]) {
  await deleteRowsWhere("Program Incentives", (row) => text(row[1]) === programId);
  if (!tiers.length) return;
  await appendEncodedRows(
    { range: "'Program Incentives'!A:H", requestBody: { values: tiers.map((tier) => [createReadableId("INC"), programId, tier.role, tier.fromMonth, tier.toMonth, tier.incentiveType, Number(tier.markUp) || 0, Number(tier.incentiveAmount) || 0]) } },
    tiers.map((tier) => [text(tier.branchId)]),
  );
}
