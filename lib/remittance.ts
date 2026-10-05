export type IncentiveTier = {
  id?: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType: "fixed" | "percentage";
  markUp: number;
  incentiveAmount: number;
  /** Blank = the program's base tier for every branch; otherwise the tier applies to that branch only. */
  branchId?: string;
};

/**
 * The tiers that apply in one branch: for each role, the branch's own tiers when it has any, else the base tiers.
 * A branch can therefore override MAS rates, Collector rates, or both.
 */
export function tiersForBranch<T extends { role: string; branchId?: string }>(tiers: T[], branchId: string): T[] {
  const branch = (branchId ?? "").trim();
  return (["MAS", "Collector"] as const).flatMap((role) => {
    const forRole = tiers.filter((tier) => tier.role === role);
    const own = branch ? forRole.filter((tier) => (tier.branchId ?? "").trim() === branch) : [];
    return own.length ? own : forRole.filter((tier) => !(tier.branchId ?? "").trim());
  });
}

/** A program's New Sale incentive for registration-fee programs (Programs Q type, R amount). Blank type = none. */
export type SaleIncentiveSetting = { saleIncentiveType: "fixed" | "percentage" | ""; saleIncentiveAmount: number };
export type SaleProgram = SaleIncentiveSetting & { basePay: number; registrationFeeRequired: boolean; incentiveTiers: IncentiveTier[]; /** Flexible program: basePay is the minimum; incentives follow the amount paid. */ flexible?: boolean };

export function normalizeSaleIncentive(input: { registrationFeeRequired?: unknown; saleIncentiveType?: unknown; saleIncentiveAmount?: unknown; registrationAmount?: unknown }): SaleIncentiveSetting {
  const type = String(input.saleIncentiveType ?? "").trim();
  if (!input.registrationFeeRequired || !type) return { saleIncentiveType: "", saleIncentiveAmount: 0 };
  if (type !== "fixed" && type !== "percentage") throw new Error("Choose a fixed or percentage New Sale incentive.");
  const amount = Math.round(Number(input.saleIncentiveAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0) throw new Error("The New Sale incentive cannot be negative.");
  if (type === "percentage" && amount > 100) throw new Error("A percentage New Sale incentive cannot exceed 100%.");
  if (type === "fixed" && amount > (Number(input.registrationAmount) || 0)) throw new Error("A fixed New Sale incentive cannot exceed the registration amount.");
  return { saleIncentiveType: type, saleIncentiveAmount: amount };
}

/**
 * What the MAS keeps from a New Sale, and what the company is owed.
 * - Programs with a registration fee: the program's own New Sale incentive, fixed or a percentage of the amount paid.
 * - Programs without one: the sale pays the first month, so the month-1 MAS incentive tier applies to the base pay,
 *   exactly as a Collection for NOP 1 would. Anything paid above one month is remitted in full.
 */
export function calculateSaleIncentive(program: SaleProgram, amountPaid: number) {
  const paidCents = Math.round(amountPaid * 100);
  if (!Number.isFinite(paidCents) || paidCents < 0) throw new Error("Enter a valid amount paid.");
  const none = (rule: string) => ({ incentive: 0, remittance: paidCents / 100, rule });
  if (program.registrationFeeRequired) {
    if (!program.saleIncentiveType || !program.saleIncentiveAmount) return none("No New Sale incentive is set for this program.");
    const incentiveCents = program.saleIncentiveType === "percentage"
      ? Math.round(paidCents * program.saleIncentiveAmount / 100)
      : Math.min(paidCents, Math.round(program.saleIncentiveAmount * 100));
    return { incentive: incentiveCents / 100, remittance: (paidCents - incentiveCents) / 100, rule: program.saleIncentiveType === "percentage" ? `${program.saleIncentiveAmount}% of the registration paid` : `Fixed New Sale incentive` };
  }
  if (paidCents < Math.round(program.basePay * 100)) return none(program.flexible ? "Less than the minimum monthly payment was paid, so no incentive applies." : "Less than one month's base pay was paid, so no incentive applies.");
  const quote = calculateRemittance(program.basePay, program.incentiveTiers, "MAS", 1, 1, amountPaid, program.flexible);
  return { incentive: Math.round((amountPaid - quote.remittance) * 100) / 100, remittance: quote.remittance, rule: program.flexible ? "Month-1 MAS incentive on the amount paid" : "Month-1 MAS incentive on the base pay" };
}

/**
 * `flexible`: the program's basePay is only the minimum; each NOP's installment is its share of the amount actually
 * collected, so incentives follow what was paid.
 */
export function calculateRemittance(basePay: number, tiers: IncentiveTier[], role: string, nopFrom: number, nopTo: number, amountCollected?: number, flexible = false) {
  if (!Number.isFinite(basePay) || basePay <= 0 || !Number.isInteger(nopFrom) || !Number.isInteger(nopTo) || nopFrom < 1 || nopTo < nopFrom || nopTo - nopFrom > 1199) throw new Error("Select a valid program and NOP range to calculate remittance.");
  if (role !== "MAS" && role !== "Collector") throw new Error("Select the collection role.");
  const count = nopTo - nopFrom + 1;
  const paidCents = amountCollected === undefined ? NaN : Math.round(amountCollected * 100);
  const flexibleShares = flexible && Number.isFinite(paidCents);
  if (flexibleShares && paidCents < Math.round(basePay * 100) * count) throw new Error(`Pay at least the minimum of ${basePay.toFixed(2)} per month.`);
  const minimumCents = Math.round(basePay * 100);
  const breakdown = [];
  for (let nop = nopFrom; nop <= nopTo; nop++) {
    const index = nop - nopFrom;
    const baseCents = flexibleShares ? Math.floor(paidCents / count) + (index < paidCents % count ? 1 : 0) : minimumCents;
    const matches = tiers.filter((tier) => tier.role === role && nop >= tier.fromMonth && nop <= tier.toMonth);
    if (matches.length !== 1) throw new Error(`Configure exactly one ${role} incentive tier for NOP ${nop}.`);
    const tier = matches[0];
    if (!Number.isFinite(tier.markUp) || tier.markUp < 0 || tier.markUp > basePay || !Number.isFinite(tier.incentiveAmount) || tier.incentiveAmount < 0 || !["fixed", "percentage"].includes(tier.incentiveType) || (tier.incentiveType === "percentage" && tier.incentiveAmount > 100)) throw new Error(`Invalid incentive configuration for NOP ${nop}.`);
    const markUpCents = Math.round(tier.markUp * 100);
    const incentiveBase = baseCents - markUpCents;
    // Remittance = ((base pay - mark-up) - incentive) + mark-up. The incentive is what the MAS/Collector keeps for
    // this NOP: a fixed amount, or a percentage of (base pay - mark-up). The mark-up always goes to the company.
    const incentiveCents = tier.incentiveType === "percentage" ? Math.round(incentiveBase * tier.incentiveAmount / 100) : Math.round(tier.incentiveAmount * 100);
    if (incentiveCents > incentiveBase) throw new Error(`The incentive for NOP ${nop} is more than the installment less mark-up.`);
    const remittanceCents = (incentiveBase - incentiveCents) + markUpCents;
    breakdown.push({ nop, tierId: tier.id ?? "", role, basePay: baseCents / 100, markUp: markUpCents / 100,
      incentiveType: tier.incentiveType, incentiveAmount: tier.incentiveAmount, incentive: incentiveCents / 100, remittance: remittanceCents / 100 });
  }
  const grossCents = breakdown.reduce((sum, item) => sum + Math.round(item.basePay * 100), 0);
  const collectedCents = amountCollected === undefined ? grossCents : Math.round(amountCollected * 100);
  if (!Number.isFinite(collectedCents) || collectedCents < 0) throw new Error("Enter a valid amount collected.");
  const excessCents = Math.max(0, collectedCents - grossCents);
  const standardRemittanceCents = breakdown.reduce((sum, item) => sum + Math.round(item.remittance * 100), 0);
  return { gross: grossCents / 100, excess: excessCents / 100, remittance: (standardRemittanceCents + excessCents) / 100, breakdown };
}
