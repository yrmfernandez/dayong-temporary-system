import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRemittance } from "../lib/remittance.ts";
const tier = { id: "T1", role: "MAS", fromMonth: 1, toMonth: 6, incentiveType: "percentage", markUp: 50, incentiveAmount: 50 };

test("user example gives 200 remittance on 350 gross", () => {
  const result = calculateRemittance(350, [tier], "MAS", 1, 1);
  assert.equal(result.gross, 350);
  assert.equal(result.remittance, 200);
});
test("30 percent follows total - total1 + markup, not the complement", () => {
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 30 }], "MAS", 1, 1).remittance, 140);
});
test("multi-month tier crossing and Collector rules are independent", () => {
  const tiers = [tier, { ...tier, id: "T2", fromMonth: 7, toMonth: 12, incentiveAmount: 30 }, { ...tier, role: "Collector", incentiveAmount: 10 }];
  assert.equal(calculateRemittance(350, tiers, "MAS", 6, 7).remittance, 340);
  assert.equal(calculateRemittance(350, tiers, "Collector", 1, 1).remittance, 80);
});
test("fixed incentives, zero percent, and fractional cents are deterministic", () => {
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveType: "fixed", incentiveAmount: 100 }], "MAS", 1, 1).remittance, 150);
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 0 }], "MAS", 1, 1).remittance, 50);
  assert.equal(calculateRemittance(350, [{ ...tier, incentiveAmount: 33.33 }], "MAS", 1, 3).remittance, 449.97);
});
test("missing, overlapping, and invalid tiers block saving instead of guessing", () => {
  assert.throws(() => calculateRemittance(350, [], "MAS", 1, 1), /exactly one/);
  assert.throws(() => calculateRemittance(350, [tier, tier], "MAS", 1, 1), /exactly one/);
  assert.throws(() => calculateRemittance(350, [{ ...tier, markUp: 400 }], "MAS", 1, 1), /Invalid/);
});
