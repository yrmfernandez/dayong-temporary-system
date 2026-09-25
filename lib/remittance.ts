export type IncentiveTier = {
  id?: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType: "fixed" | "percentage";
  markUp: number;
  incentiveAmount: number;
};

export function calculateRemittance(basePay: number, tiers: IncentiveTier[], role: string, nopFrom: number, nopTo: number) {
  if (!Number.isFinite(basePay) || basePay <= 0 || !Number.isInteger(nopFrom) || !Number.isInteger(nopTo) || nopFrom < 1 || nopTo < nopFrom || nopTo - nopFrom > 1199) throw new Error("Select a valid program and NOP range to calculate remittance.");
  if (role !== "MAS" && role !== "Collector") throw new Error("Select the collection role.");
  const baseCents = Math.round(basePay * 100);
  const breakdown = [];
  for (let nop = nopFrom; nop <= nopTo; nop++) {
    const matches = tiers.filter((tier) => tier.role === role && nop >= tier.fromMonth && nop <= tier.toMonth);
    if (matches.length !== 1) throw new Error(`Configure exactly one ${role} incentive tier for NOP ${nop}.`);
    const tier = matches[0];
    if (!Number.isFinite(tier.markUp) || tier.markUp < 0 || tier.markUp > basePay || !Number.isFinite(tier.incentiveAmount) || tier.incentiveAmount < 0 || !["fixed", "percentage"].includes(tier.incentiveType) || (tier.incentiveType === "percentage" && tier.incentiveAmount > 100)) throw new Error(`Invalid incentive configuration for NOP ${nop}.`);
    const markUpCents = Math.round(tier.markUp * 100);
    const incentiveBase = baseCents - markUpCents;
    // User-defined remittance: total = base - markup; total1 = total - percentage;
    // remittance = total - total1 + markup. Fixed tiers use their fixed amount.
    const percentageOrFixed = tier.incentiveType === "percentage" ? Math.round(incentiveBase * tier.incentiveAmount / 100) : Math.round(tier.incentiveAmount * 100);
    const remittanceCents = percentageOrFixed + markUpCents;
    if (remittanceCents > baseCents) throw new Error(`Remittance exceeds the installment for NOP ${nop}.`);
    breakdown.push({ nop, tierId: tier.id ?? "", role, basePay: baseCents / 100, markUp: markUpCents / 100,
      incentiveType: tier.incentiveType, incentiveAmount: tier.incentiveAmount, remittance: remittanceCents / 100 });
  }
  return { gross: baseCents * breakdown.length / 100, remittance: breakdown.reduce((sum, item) => sum + Math.round(item.remittance * 100), 0) / 100, breakdown };
}
