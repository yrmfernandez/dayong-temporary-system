import assert from "node:assert/strict";
import { test } from "node:test";
import { accountState, validatePayment, allocations, addMonths } from "../lib/account-rules.ts";

const account = { id: "E1", memberId: "M1", memberNumber: "PH1", programId: "P1", doi: "2026-01-15", branch: "B1", mas: "MAS1", basePay: 350, storedStatus: "" };
const payment = (overrides = {}) => ({ id: "C1", enrollmentId: "E1", orDate: "2026-01-15", orNumber: "OR1", monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 1, nopTo: 1, amount: 350, dateRemitted: "2026-02-01", mas: "MAS1", ...overrides });
// The New Sale is NOP 1 (the DOI month, January), so an NS account's first Collection is NOP 2 for February.
const input = (overrides = {}) => ({ monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 2, nopTo: 2, amount: 350, orDate: "2026-01-20", orNumber: "OR2", waiver: "", collectedByRole: "MAS", originalMas: "", ...overrides });

test("NS counts the New Sale as NOP 1; the first collection is NOP 2 the month after DOI and NOP cannot be typed", () => {
  const state = accountState(account, [], "2026-01-20");
  assert.equal(state.status, "NS");
  assert.equal(state.nop, 1);
  assert.equal(state.nextNop, 2);
  assert.equal(state.nextMonth, "2026-02");
  validatePayment(account, [], input({ monthTo: "2026-04", nopTo: 4, amount: 1050 }), "2026-01-20");
  assert.throws(() => validatePayment(account, [], input({ monthTo: "2026-04", nopFrom: 7, nopTo: 9, amount: 1050 }), "2026-01-20"), /NOP must start at 2/);
  assert.throws(() => validatePayment(account, [], input({ monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 2, nopTo: 2 }), "2026-01-20"), /begin with 2026-02/);
  const afterFirst = accountState(account, [payment({ monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 2, nopTo: 2, orDate: "2026-01-20" })], "2026-01-20");
  assert.deepEqual([afterFirst.nextNop, afterFirst.nextMonth], [3, "2026-03"]);
  assert.deepEqual([...allocations([payment({ monthTo: "2026-03", nopTo: 3, amount: 1050 })]).values()].map((v) => v.nop), [1, 2, 3]);
});
test("OR Date and DOI establish exact suspension and forfeiture boundaries", () => {
  assert.equal(accountState(account, [], "2026-03-14").temporarilySuspended, false);
  assert.equal(accountState(account, [], "2026-03-15").temporarilySuspended, true);
  assert.notEqual(accountState(account, [], "2026-07-15").status, "Forfeited");
  assert.equal(accountState(account, [], "2026-07-16").status, "Forfeited");
  assert.equal(accountState(account, [payment()], "2026-03-15").anchor, "2026-01-15");
});
test("advance coverage anchors to DOI day of the last covered month", () => {
  const a = { ...account, doi: "2026-09-15" };
  const p = payment({ orDate: "2026-09-20", monthFrom: "2026-09", monthTo: "2026-11", nopTo: 3, amount: 1050 });
  const state = accountState(a, [p], "2026-11-20");
  assert.equal(state.anchor, "2026-11-15");
  assert.equal(state.suspendedAt, "2027-01-15");
  assert.equal(state.forfeitedAt, "2027-05-16");
  assert.equal(state.status, "U");
  assert.equal(accountState(a, [p], "2026-09-20").status, "ADV");
});
test("calendar math clamps DOI to actual month end including leap years", () => {
  assert.equal(addMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(addMonths("2023-12-31", 2), "2024-02-29");
});
test("whole installments only, allow paying one month of arrears, forbid skipped coverage", () => {
  assert.throws(() => validatePayment(account, [], input({ amount: 100 }), "2026-01-20"), /full monthly/);
  validatePayment(account, [payment()], input({ monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 2, nopTo: 2, orDate: "2026-03-20", waiver: "Waiver" }), "2026-03-20");
  assert.throws(() => validatePayment(account, [payment()], input({ monthFrom: "2026-04", monthTo: "2026-04", nopFrom: 2, nopTo: 2, orDate: "2026-03-20", waiver: "Waiver" }), "2026-03-20"), /do not skip/);
});
test("an edited amount may exceed monthly dues only when it exactly pays the configured balance", () => {
  const payoffAccount = { ...account, payBalanceTotal: 1000 };
  validatePayment(payoffAccount, [], input({ amount: 1000 }), "2026-01-20");
  assert.equal(accountState(payoffAccount, [payment({ amount: 1000 })], "2026-01-20").status, "Paid");
  assert.throws(() => validatePayment(payoffAccount, [], input({ amount: 900 }), "2026-01-20"), /exactly pay/);
  assert.throws(() => validatePayment({ ...account, payBalanceTotal: 0 }, [], input({ amount: 700 }), "2026-01-20"), /exactly pay/);
});
test("non-NS NOP cannot be spoofed; duplicate receipt and overlapping history fail", () => {
  assert.throws(() => validatePayment(account, [payment()], input({ nopFrom: 9, nopTo: 9 }), "2026-01-20"), /NOP must start/);
  assert.throws(() => validatePayment(account, [payment()], input({ orNumber: "OR1" }), "2026-01-20"), /already recorded/);
  assert.throws(() => allocations([payment(), payment({ id: "C2" })]), /overlaps/);
});
test("waiver required for suspension; forfeiture cannot be bypassed by waiver or backdated OR", () => {
  assert.throws(() => validatePayment(account, [], input({ orDate: "2026-03-15" }), "2026-03-15"), /Waiver/);
  assert.throws(() => validatePayment(account, [], input({ orDate: "2026-02-01", waiver: "Waiver" }), "2026-07-16"), /forfeited/);
  assert.throws(() => validatePayment({ ...account, storedStatus: "Forfeited" }, [], input({ waiver: "Waiver" }), "2026-01-20"), /forfeited/);
});
test("collector batches need no separate original MAS: the batch MAS is used", () => {
  validatePayment(account, [], input({ collectedByRole: "Collector" }), "2026-01-20");
  assert.throws(() => validatePayment(account, [], input({ collectedByRole: "Courier" }), "2026-01-20"), /MAS, Collector, or DTO/);
});
test("programs are isolated and missing-month statuses stop at 150D", () => {
  // Another program's payment is ignored: this account is still NS at NOP 1 (its New Sale).
  const isolated = accountState(account, [payment({ enrollmentId: "OTHER" })], "2026-01-20");
  assert.deepEqual([isolated.status, isolated.nop, isolated.nextNop], ["NS", 1, 2]);
  assert.equal(accountState(account, [payment()], "2026-02-20").status, "60D");
  assert.equal(accountState(account, [payment()], "2026-03-20").status, "90D");
  assert.equal(accountState(account, [payment()], "2026-05-20").status, "150D");
  assert.equal(accountState(account, [payment()], "2026-06-20").status, "150D");
});
