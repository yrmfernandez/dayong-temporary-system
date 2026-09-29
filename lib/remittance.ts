export type IncentiveTier = {
  id?: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType: "fixed" | "percentage";
  markUp: number;
  incentiveAmount: number;
};

export function calculateRemittance(basePay: number, tiers: IncentiveTier[], role: string, nopFrom: number, nopTo: number, amountCollected?: number) {
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
    // Remittance = ((base pay - mark-up) - incentive) + mark-up. The incentive is what the MAS/Collector keeps for
    // this NOP: a fixed amount, or a percentage of (base pay - mark-up). The mark-up always goes to the company.
    const incentiveCents = tier.incentiveType === "percentage" ? Math.round(incentiveBase * tier.incentiveAmount / 100) : Math.round(tier.incentiveAmount * 100);
    if (incentiveCents > incentiveBase) throw new Error(`The incentive for NOP ${nop} is more than the installment less mark-up.`);
    const remittanceCents = (incentiveBase - incentiveCents) + markUpCents;
    breakdown.push({ nop, tierId: tier.id ?? "", role, basePay: baseCents / 100, markUp: markUpCents / 100,
      incentiveType: tier.incentiveType, incentiveAmount: tier.incentiveAmount, incentive: incentiveCents / 100, remittance: remittanceCents / 100 });
  }
  const grossCents = baseCents * breakdown.length;
  const collectedCents = amountCollected === undefined ? grossCents : Math.round(amountCollected * 100);
  if (!Number.isFinite(collectedCents) || collectedCents < 0) throw new Error("Enter a valid amount collected.");
  const excessCents = Math.max(0, collectedCents - grossCents);
  const standardRemittanceCents = breakdown.reduce((sum, item) => sum + Math.round(item.remittance * 100), 0);
  return { gross: grossCents / 100, excess: excessCents / 100, remittance: (standardRemittanceCents + excessCents) / 100, breakdown };
}
