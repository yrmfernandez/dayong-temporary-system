import assert from "node:assert/strict";
import { test } from "node:test";
import { accountState, validatePayment, allocations, addMonths } from "../lib/account-rules.ts";

const account = { id: "E1", memberId: "M1", memberNumber: "PH1", programId: "P1", doi: "2026-01-15", branch: "B1", mas: "MAS1", basePay: 350, storedStatus: "" };
const payment = (overrides = {}) => ({ id: "C1", enrollmentId: "E1", orDate: "2026-01-15", orNumber: "OR1", monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 1, nopTo: 1, amount: 350, dateRemitted: "2026-02-01", mas: "MAS1", ...overrides });
const input = (overrides = {}) => ({ monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 1, nopTo: 1, amount: 350, orDate: "2026-01-20", orNumber: "OR2", waiver: "", collectedByRole: "MAS", originalMas: "", ...overrides });

test("NS excludes New Sales; first payment can cover multiple months with editable NOP", () => {
  assert.equal(accountState(account, [], "2026-01-20").nop, 0);
  assert.equal(accountState(account, [], "2026-01-20").status, "NS");
  validatePayment(account, [], input({ monthTo: "2026-03", nopFrom: 7, nopTo: 9, amount: 1050 }), "2026-01-20");
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
test("collector needs original MAS, independent of encoder or reactivation", () => {
  assert.throws(() => validatePayment(account, [], input({ collectedByRole: "Collector" }), "2026-01-20"), /Original MAS/);
  validatePayment(account, [], input({ collectedByRole: "Collector", originalMas: "Original officer" }), "2026-01-20");
});
test("programs are isolated and missing-month statuses stop at 150D", () => {
  assert.equal(accountState(account, [payment({ enrollmentId: "OTHER" })], "2026-01-20").nop, 0);
  assert.equal(accountState(account, [payment()], "2026-02-20").status, "60D");
  assert.equal(accountState(account, [payment()], "2026-03-20").status, "90D");
  assert.equal(accountState(account, [payment()], "2026-05-20").status, "150D");
  assert.equal(accountState(account, [payment()], "2026-06-20").status, "150D");
});
