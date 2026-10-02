import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRemittance, calculateSaleIncentive, normalizeSaleIncentive, tiersForBranch } from "../lib/remittance.ts";
// Remittance = ((base pay - mark-up) - incentive) + mark-up; incentive = fixed amount or % of (base pay - mark-up).
const tier = { id: "T1", role: "MAS", fromMonth: 1, toMonth: 6, incentiveType: "percentage", markUp: 50, incentiveAmount: 50 };

test("350 base, 50 mark-up, 50% incentive: MAS keeps 150, remits 200", () => {
  const result = calculateRemittance(350, [tier], "MAS", 1, 1);
  assert.equal(result.gross, 350);
  assert.equal(result.remittance, 200);
  assert.equal(result.breakdown[0].incentive, 150);
});
test("the percentage is the MAS/Collector incentive, so a smaller share means a larger remittance", () => {
  // (350 - 50) = 300; 30% incentive = 90; remittance = (300 - 90) + 50 = 260.
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 30 }], "MAS", 1, 1).remittance, 260);
});
test("DS-320 as configured: fixed incentives with no mark-up", () => {
  const tiers = [
    { role: "MAS", fromMonth: 1, toMonth: 12, incentiveType: "fixed", markUp: 0, incentiveAmount: 50 },
    { role: "Collector", fromMonth: 1, toMonth: 12, incentiveType: "fixed", markUp: 0, incentiveAmount: 50 },
    { role: "MAS", fromMonth: 13, toMonth: 60, incentiveType: "fixed", markUp: 0, incentiveAmount: 0 },
    { role: "Collector", fromMonth: 13, toMonth: 60, incentiveType: "fixed", markUp: 0, incentiveAmount: 40 },
  ];
  assert.equal(calculateRemittance(320, tiers, "MAS", 1, 1).remittance, 270);
  assert.equal(calculateRemittance(320, tiers, "Collector", 1, 1).remittance, 270);
  assert.equal(calculateRemittance(320, tiers, "MAS", 13, 13).remittance, 320);
  assert.equal(calculateRemittance(320, tiers, "Collector", 13, 13).remittance, 280);
  assert.equal(calculateRemittance(320, tiers, "MAS", 12, 13).remittance, 590, "a range crossing tiers adds each NOP");
});
test("an amount above covered dues is added to remittance without adding incentive", () => {
  const result = calculateRemittance(350, [tier], "MAS", 1, 1, 500);
  assert.equal(result.gross, 350);
  assert.equal(result.excess, 150);
  assert.equal(result.remittance, 350);
});
test("multi-month tier crossing and Collector rules are independent", () => {
  const tiers = [tier, { ...tier, id: "T2", fromMonth: 7, toMonth: 12, incentiveAmount: 30 }, { ...tier, role: "Collector", incentiveAmount: 10 }];
  assert.equal(calculateRemittance(350, tiers, "MAS", 6, 7).remittance, 460);
  assert.equal(calculateRemittance(350, tiers, "Collector", 1, 1).remittance, 320);
});
test("fixed incentives, zero percent, and fractional cents are deterministic", () => {
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveType: "fixed", incentiveAmount: 100 }], "MAS", 1, 1).remittance, 250);
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 0 }], "MAS", 1, 1).remittance, 350);
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 33.33 }], "MAS", 1, 3).remittance, 750.03);
});
test("missing, overlapping, and invalid tiers block saving instead of guessing", () => {
  assert.throws(() => calculateRemittance(350, [], "MAS", 1, 1), /exactly one/);
  assert.throws(() => calculateRemittance(350, [tier, tier], "MAS", 1, 1), /exactly one/);
  assert.throws(() => calculateRemittance(350, [{ ...tier, markUp: 400 }], "MAS", 1, 1), /Invalid/);
  assert.throws(() => calculateRemittance(350, [{ ...tier, incentiveType: "fixed", incentiveAmount: 301 }], "MAS", 1, 1), /more than the installment less mark-up/);
});

test("New Sale with a registration fee uses the program's own incentive", () => {
  const program = { basePay: 350, registrationFeeRequired: true, incentiveTiers: [tier], saleIncentiveType: "percentage", saleIncentiveAmount: 20 };
  assert.deepEqual(calculateSaleIncentive(program, 500).incentive, 100);
  assert.equal(calculateSaleIncentive(program, 500).remittance, 400);
  assert.equal(calculateSaleIncentive({ ...program, saleIncentiveType: "fixed", saleIncentiveAmount: 150 }, 500).incentive, 150);
  assert.equal(calculateSaleIncentive({ ...program, saleIncentiveType: "fixed", saleIncentiveAmount: 150 }, 100).incentive, 100, "a fixed incentive never exceeds what was paid");
  assert.equal(calculateSaleIncentive({ ...program, saleIncentiveType: "", saleIncentiveAmount: 0 }, 500).remittance, 500, "no incentive set: everything is remitted");
});

test("New Sale without a registration fee uses the month-1 tier on the base pay", () => {
  const program = { basePay: 350, registrationFeeRequired: false, incentiveTiers: [tier], saleIncentiveType: "", saleIncentiveAmount: 0 };
  assert.deepEqual([calculateSaleIncentive(program, 350).incentive, calculateSaleIncentive(program, 350).remittance], [150, 200]);
  assert.deepEqual([calculateSaleIncentive(program, 400).incentive, calculateSaleIncentive(program, 400).remittance], [150, 250], "above one month is remitted in full");
  assert.equal(calculateSaleIncentive(program, 200).incentive, 0, "less than one month earns no incentive");
  assert.throws(() => calculateSaleIncentive({ ...program, incentiveTiers: [] }, 350), /NOP 1/);
});

test("New Sale incentive settings are validated", () => {
  assert.deepEqual(normalizeSaleIncentive({ registrationFeeRequired: false, saleIncentiveType: "fixed", saleIncentiveAmount: 50 }), { saleIncentiveType: "", saleIncentiveAmount: 0 });
  assert.deepEqual(normalizeSaleIncentive({ registrationFeeRequired: true, registrationAmount: 500, saleIncentiveType: "percentage", saleIncentiveAmount: "25" }), { saleIncentiveType: "percentage", saleIncentiveAmount: 25 });
  assert.throws(() => normalizeSaleIncentive({ registrationFeeRequired: true, registrationAmount: 500, saleIncentiveType: "percentage", saleIncentiveAmount: 120 }), /100%/);
  assert.throws(() => normalizeSaleIncentive({ registrationFeeRequired: true, registrationAmount: 100, saleIncentiveType: "fixed", saleIncentiveAmount: 150 }), /registration amount/);
});

test("a branch's own tiers replace the base tiers for that role only", () => {
  const base = [{ role: "MAS", fromMonth: 1, toMonth: 60, branchId: "" }, { role: "Collector", fromMonth: 1, toMonth: 60, branchId: "" }];
  const tagum = [{ role: "MAS", fromMonth: 1, toMonth: 60, branchId: "BR-7" }];
  const tiers = [...base, ...tagum];
  assert.deepEqual(tiersForBranch(tiers, "BR-7"), [tagum[0], base[1]], "own MAS rates, base Collector rates");
  assert.deepEqual(tiersForBranch(tiers, "BR-1"), base, "other branches use the base rates");
  assert.deepEqual(tiersForBranch(tiers, ""), base, "no branch means base rates");
});
