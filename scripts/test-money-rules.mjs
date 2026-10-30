// Money rules (upgrade #9, October 26, 2026): the rules that decide pesos, tested on their own so a change to one of
// them cannot move an amount unnoticed. Basic cases live in test-remittance.mjs and test-account-rules.mjs; this file
// adds the invariants (every centavo accounted for), rounding, short months, multi-month and flexible splits, and the
// Fidelity base. Deadline minutes and declared days are in test-encoder-tracking.cjs (the deadline module uses @/ paths).
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRemittance, calculateSaleIncentive, withoutIncentive } from "../lib/remittance.ts";
import { accountState, allocations } from "../lib/account-rules.ts";
import { FIDELITY_CAP, baseWithdrawalAmount, fidelityStanding } from "../lib/fidelity-cap.ts";

const cents = (value) => Math.round(value * 100);
const tier = (overrides = {}) => ({ id: "T", role: "MAS", fromMonth: 1, toMonth: 999, incentiveType: "percentage", markUp: 0, incentiveAmount: 30, ...overrides });

test("every centavo is accounted for: company share + incentives = amount collected, for every tier, role, NOP range and amount", () => {
  let checked = 0;
  for (const basePay of [180, 250, 320, 333.33, 350, 1000]) {
    for (const markUp of [0, 50]) {
      for (const setting of [{ incentiveType: "percentage", incentiveAmount: 0 }, { incentiveType: "percentage", incentiveAmount: 15 }, { incentiveType: "percentage", incentiveAmount: 33.3 }, { incentiveType: "percentage", incentiveAmount: 100 }, { incentiveType: "fixed", incentiveAmount: 40 }, { incentiveType: "fixed", incentiveAmount: 75.55 }]) {
        if (setting.incentiveType === "fixed" && setting.incentiveAmount > basePay - markUp) continue;
        const tiers = [tier({ markUp, ...setting }), tier({ id: "C", role: "Collector", markUp, ...setting })];
        for (const role of ["MAS", "Collector", "DTO"]) {
          for (const [nopFrom, nopTo] of [[1, 1], [2, 4], [7, 18]]) {
            const dues = cents(basePay) * (nopTo - nopFrom + 1);
            for (const extra of [0, 1, 12345]) {
              const collected = (dues + extra) / 100;
              const quote = calculateRemittance(basePay, tiers, role, nopFrom, nopTo, collected);
              const incentives = quote.breakdown.reduce((sum, item) => sum + cents(item.incentive), 0);
              assert.equal(cents(quote.remittance) + incentives, cents(collected), `${basePay} ${role} NOP ${nopFrom}-${nopTo} +${extra}`);
              assert.equal(cents(quote.excess), extra, "anything above the dues is remitted, with no incentive on it");
              for (const item of quote.breakdown) {
                assert.ok(item.incentive >= 0, "an incentive is never negative");
                assert.ok(cents(item.remittance) >= cents(item.markUp), "the mark-up always goes to the company");
                assert.ok(cents(item.incentive) <= cents(item.basePay) - cents(item.markUp), "an incentive never exceeds the installment less mark-up");
                if (role === "DTO") assert.equal(item.incentive, 0, "Direct to Office earns nothing");
              }
              checked++;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 1000, `checked ${checked} cases`);
});

test("percentages round to the centavo the same way every time", () => {
  // 33.3% of 333.33 = 110.99889 → 111.00; 15% of 175 = 26.25; 30% of (350 - 50) = 90.
  assert.equal(calculateRemittance(333.33, [tier({ incentiveAmount: 33.3 })], "MAS", 1, 1).breakdown[0].incentive, 111);
  assert.equal(calculateRemittance(175, [tier({ incentiveAmount: 15 })], "MAS", 1, 1).remittance, 148.75);
  const marked = calculateRemittance(350, [tier({ markUp: 50 })], "MAS", 1, 1);
  assert.deepEqual([marked.breakdown[0].incentive, marked.remittance], [90, 260], "30% of the 300 after mark-up; the 50 mark-up is remitted");
});

test("ORC: the Collector gets half of the MAS incentive, rounded down; the odd centavo stays with the company", () => {
  const tiers = [tier({ incentiveType: "fixed", incentiveAmount: 75.25 }), tier({ id: "C", role: "Collector", incentiveType: "fixed", incentiveAmount: 20 })];
  const quote = calculateRemittance(350, tiers, "Collector", 1, 1, 350, false, null, { orc: true });
  assert.equal(quote.breakdown[0].incentive, 37.62, "half of 75.25 is 37.625, rounded down");
  assert.equal(quote.remittance, 312.38);
});

test("reactivation earns 10% of (base pay - mark-up) per NOP, whatever the tier says", () => {
  const quote = calculateRemittance(350, [tier({ incentiveAmount: 50, markUp: 50 })], "MAS", 1, 3, 1050, false, null, { reactivation: true });
  assert.deepEqual(quote.breakdown.map((item) => item.incentive), [30, 30, 30]);
  assert.equal(quote.remittance, 960);
});

test("a flexible payment splits to the centavo across its months: shares add up exactly and differ by at most one centavo", () => {
  const quote = calculateRemittance(150, [tier({ incentiveAmount: 15 })], "MAS", 1, 3, 1000.01, true, null);
  const shares = quote.breakdown.map((item) => cents(item.basePay));
  assert.deepEqual(shares, [33334, 33334, 33333]);
  assert.equal(cents(quote.remittance) + quote.breakdown.reduce((sum, item) => sum + cents(item.incentive), 0), 100001);
  // The account history credits the same shares to each month.
  const credited = allocations([{ id: "C1", enrollmentId: "E1", orDate: "2026-03-05", orNumber: "1", monthFrom: "2026-03", monthTo: "2026-05", nopFrom: 2, nopTo: 4, amount: 1000.01, dateRemitted: "", mas: "" }], 150, true);
  assert.deepEqual([...credited.values()].map((item) => cents(item.amount)), [33334, 33334, 33333]);
  assert.throws(() => calculateRemittance(150, [tier()], "MAS", 1, 3, 449.99, true, null), /at least the minimum/, "less than the minimum for 3 months is refused");
});

test("a fixed program credits whole months: a 3-month payment covers 3 months at the rate; less is refused; overlapping months are refused", () => {
  const payment = (overrides) => ({ id: "C1", enrollmentId: "E1", orDate: "2026-03-05", orNumber: "1", monthFrom: "2026-03", monthTo: "2026-05", nopFrom: 2, nopTo: 4, amount: 1050, dateRemitted: "", mas: "", ...overrides });
  assert.deepEqual([...allocations([payment()], 350).entries()].map(([month, item]) => [month, item.nop, item.amount]), [["2026-03", 2, 350], ["2026-04", 3, 350], ["2026-05", 4, 350]]);
  assert.throws(() => allocations([payment({ amount: 1049.99 })], 350), /full monthly installments/);
  assert.throws(() => allocations([payment(), payment({ id: "C2", monthFrom: "2026-05", monthTo: "2026-05", nopFrom: 5, nopTo: 5, amount: 350 })], 350), /overlaps/);
});

test("New Sale incentive: a fixed one never exceeds what was paid; less than a month earns nothing; no setting earns nothing", () => {
  const withFee = (type, amount) => ({ basePay: 350, registrationFeeRequired: true, saleIncentiveType: type, saleIncentiveAmount: amount, incentiveTiers: [] });
  assert.deepEqual(calculateSaleIncentive(withFee("fixed", 150), 100), { incentive: 100, remittance: 0, rule: "Fixed New Sale incentive" }, "capped at the amount paid");
  assert.equal(calculateSaleIncentive(withFee("percentage", 12.5), 333).incentive, 41.63, "12.5% of 333 = 41.625, rounded");
  assert.equal(calculateSaleIncentive(withFee("", 0), 500).remittance, 500, "no New Sale incentive set: all remitted");
  const noFee = { basePay: 350, registrationFeeRequired: false, saleIncentiveType: "", saleIncentiveAmount: 0, incentiveTiers: [tier()] };
  assert.equal(calculateSaleIncentive(noFee, 349.99).incentive, 0, "less than one month's base pay");
  const sale = calculateSaleIncentive(noFee, 400);
  assert.deepEqual([sale.incentive, sale.remittance], [105, 295], "month-1 tier on the base pay; the 50 above it is remitted");
});

test("No incentive and forfeited incentives: the whole amount is the company's and the lost incentive is kept to the centavo", () => {
  assert.deepEqual(withoutIncentive(350, 245), { remittance: 350, forfeited: 105 });
  assert.deepEqual(withoutIncentive(333.33, 222.22), { remittance: 333.33, forfeited: 111.11 });
  assert.deepEqual(withoutIncentive(350, 350), { remittance: 350, forfeited: 0 }, "nothing to forfeit (DTO, non-commissionable)");
});

test("short months: a payment on the 31st is due on the last day of shorter months and missed the day after (October 28, 2026)", () => {
  const account = { id: "E1", memberId: "M1", memberNumber: "PH1", programId: "P1", doi: "2025-12-31", branch: "B1", mas: "MAS1", basePay: 350, payBalanceTotal: 0, storedStatus: "" };
  const paid = [{ id: "C1", enrollmentId: "E1", orDate: "2026-01-31", orNumber: "1", monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 2, nopTo: 2, amount: 350, dateRemitted: "", mas: "" }];
  const on = (today) => accountState(account, paid, today);
  assert.equal(on("2026-02-01").paidThrough, "2026-01-31");
  assert.equal(on("2026-02-28").unpaidMonths, 0, "February due on February 28");
  assert.equal(on("2026-03-01").unpaidMonths, 1, "February missed the day after");
  assert.equal(on("2026-03-31").status, "U", "March due today, not yet missed");
  assert.equal(on("2026-04-01").status, "60D", "two months missed the day after March 31");
  assert.equal(on("2026-04-01").suspendedAt, "2026-04-01");
  assert.equal(on("2026-07-31").forfeitedAt, "2026-08-01", "the day after six missed months");
  assert.equal(on("2026-07-31").status, "150D");
  assert.equal(on("2026-08-01").status, "Forfeited");
  assert.equal(on("2026-08-01").balance, null, "a forfeited account has no amount due");
  assert.equal(on("2026-04-01").balance, 700, "60D owes the two missed months");
});

test("Fidelity: nothing is locked; the base (first ₱10,000) by percent or fixed amount, the excess on its own", () => {
  assert.equal(FIDELITY_CAP, 10000);
  assert.deepEqual(fidelityStanding(0), { base: 0, excess: 0, remaining: 10000 });
  assert.deepEqual(fidelityStanding(9999.99), { base: 9999.99, excess: 0, remaining: 0.01 });
  assert.deepEqual(fidelityStanding(10000), { base: 10000, excess: 0, remaining: 0 });
  assert.deepEqual(fidelityStanding(12500.5), { base: 10000, excess: 2500.5, remaining: 0 });
  assert.equal(baseWithdrawalAmount(10000, "percent", 50), 5000, "50% of the base");
  assert.equal(baseWithdrawalAmount(8000, "percent", 25), 2000, "a percentage of the base held, not of ₱10,000");
  assert.equal(baseWithdrawalAmount(10000, "percent", 100), 10000);
  assert.equal(baseWithdrawalAmount(10000, "percent", 101), null, "over 100%");
  assert.equal(baseWithdrawalAmount(10000, "fixed", 3000), 3000);
  assert.equal(baseWithdrawalAmount(10000, "fixed", 10000.01), null, "more than the base");
  assert.equal(baseWithdrawalAmount(10000, "fixed", 0), null);
  assert.equal(baseWithdrawalAmount(0, "percent", 50), null, "no base");
  assert.equal(baseWithdrawalAmount(10000, "", 50), null, "a mode is required");
});
