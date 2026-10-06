import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMonthlyMaximum, validateMonthlyMaximum } from "../lib/program-payment-limit.mjs";
import { validatePayment, accountState } from "../lib/account-rules.ts";
import { calculateRemittance, calculateSaleIncentive } from "../lib/remittance.ts";

const account = { id: "E1", doi: "2026-01-15", basePay: 150, payBalanceTotal: 25200, flexible: true, maxMonthlyPayment: 300, storedStatus: "" };
const payment = { monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 2, nopTo: 2, amount: 300, orDate: "2026-01-20", orNumber: "OR2", waiver: "", collectedByRole: "MAS", originalMas: "" };
const tier = { role: "MAS", fromMonth: 1, toMonth: 12, incentiveType: "percentage", markUp: 0, incentiveAmount: 30 };

test("monthly maximum is optional, inclusive, and unused on fixed programs", () => {
  assert.equal(normalizeMonthlyMaximum({ flexible: true, basePay: 150 }), null);
  assert.equal(normalizeMonthlyMaximum({ flexible: true, basePay: 150, maxMonthlyPayment: null }), null);
  assert.equal(normalizeMonthlyMaximum({ flexible: false, basePay: 150, maxMonthlyPayment: 300 }), null);
  assert.equal(normalizeMonthlyMaximum({ flexible: true, basePay: 150, maxMonthlyPayment: "150.00" }), 150);
  for (const maximum of [0, -1, 149.99, "invalid", Infinity, 300.001]) {
    assert.throws(() => normalizeMonthlyMaximum({ flexible: true, basePay: 150, maxMonthlyPayment: maximum }), /Maximum monthly payment/);
  }
  validateMonthlyMaximum(99999, 1, true, null);
});

test("collection limits apply per covered month and retain the minimum and payoff limit", () => {
  validatePayment(account, [], payment, "2026-01-20");
  assert.throws(() => validatePayment(account, [], { ...payment, amount: 300.01 }, "2026-01-20"), /maximum/);
  validatePayment(account, [], { ...payment, monthTo: "2026-03", nopTo: 3, amount: 600 }, "2026-01-20");
  assert.throws(() => validatePayment(account, [], { ...payment, monthTo: "2026-03", nopTo: 3, amount: 600.01 }, "2026-01-20"), /maximum/);
  assert.throws(() => validatePayment(account, [], { ...payment, amount: 149.99 }, "2026-01-20"), /minimum/);
  validatePayment({ ...account, maxMonthlyPayment: null }, [], { ...payment, amount: 1000 }, "2026-01-20");
  assert.throws(() => validatePayment({ ...account, payBalanceTotal: 250 }, [], payment, "2026-01-20"), /remaining program balance/);
});

test("payment history above a newly configured maximum remains readable", () => {
  const history = [{ ...payment, id: "C1", enrollmentId: "E1", amount: 500 }];
  assert.equal(accountState(account, history, "2026-01-20").nop, 2);
});

test("remittance and first-month sale previews reject payments above the monthly maximum", () => {
  assert.equal(calculateRemittance(150, [tier], "MAS", 2, 3, 600, true, 300).gross, 600);
  assert.throws(() => calculateRemittance(150, [tier], "MAS", 2, 3, 600.01, true, 300), /maximum/);
  const program = { ...account, registrationFeeRequired: false, saleIncentiveType: "", saleIncentiveAmount: 0, incentiveTiers: [tier] };
  assert.equal(calculateSaleIncentive(program, 300).remittance, 210);
  assert.throws(() => calculateSaleIncentive(program, 300.01), /maximum/);
  assert.equal(calculateSaleIncentive({ ...program, maxMonthlyPayment: null }, 1000).remittance, 700);
  assert.equal(calculateSaleIncentive({ ...program, registrationFeeRequired: true }, 1000).remittance, 1000);
});
