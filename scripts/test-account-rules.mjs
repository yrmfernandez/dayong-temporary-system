import assert from "node:assert/strict";
import { test } from "node:test";
import { accountState, validatePayment, allocations, addMonths, forfeitMonthsFor, monthIndex, monthName } from "../lib/account-rules.ts";

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
  // Day to day (owner, October 17, 2026): the New Sale covers January to the DOI day (the 15th); February missed on
  // February 15, March on March 15, so suspended from March 15.
  assert.equal(accountState(account, [], "2026-03-14").temporarilySuspended, false);
  assert.equal(accountState(account, [], "2026-03-15").temporarilySuspended, true);
  assert.notEqual(accountState(account, [], "2026-07-15").status, "Forfeited");
  assert.equal(accountState(account, [], "2026-07-16").status, "Forfeited");
  assert.equal(accountState(account, [payment()], "2026-03-15").anchor, "2026-01-15");
});
test("advance coverage counts from its last covered month on the OR day (October 24, 2026)", () => {
  const a = { ...account, doi: "2026-09-15" };
  const p = payment({ orDate: "2026-09-20", monthFrom: "2026-09", monthTo: "2026-11", nopTo: 3, amount: 1050 });
  const state = accountState(a, [p], "2026-11-20");
  assert.equal(state.anchor, "2026-11-15");
  assert.equal(state.paidThrough, "2026-11-20", "covered through November, on the payment day (the 20th)");
  assert.equal(state.suspendedAt, "2027-01-20", "December missed on December 20, January on January 20");
  assert.equal(state.forfeitedAt, "2027-05-21", "the day after six missed months on the OR day");
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
  assert.equal(accountState(payoffAccount, [payment({ amount: 1000 })], "2026-01-20").status, "Fully Paid");
  assert.throws(() => validatePayment(payoffAccount, [], input({ amount: 900 }), "2026-01-20"), /exactly pay/);
  assert.throws(() => validatePayment({ ...account, payBalanceTotal: 0 }, [], input({ amount: 700 }), "2026-01-20"), /exactly pay/);
});
test("non-NS NOP cannot be spoofed; duplicate receipt and overlapping history fail", () => {
  assert.throws(() => validatePayment(account, [payment()], input({ nopFrom: 9, nopTo: 9 }), "2026-01-20"), /NOP must start/);
  assert.throws(() => validatePayment(account, [payment()], input({ orNumber: "OR1" }), "2026-01-20"), /already recorded/);
  assert.throws(() => allocations([payment(), payment({ id: "C2" })]), /overlaps/);
});
test("waiver required for suspension; forfeiture cannot be bypassed by waiver or backdated OR", () => {
  assert.throws(() => validatePayment(account, [], input({ orDate: "2026-04-01" }), "2026-04-01"), /Waiver/);
  assert.throws(() => validatePayment(account, [], input({ orDate: "2026-02-01", waiver: "Waiver" }), "2026-07-16"), /forfeited/);
  assert.throws(() => validatePayment({ ...account, storedStatus: "Forfeited", forfeitHeld: true }, [], input({ waiver: "Waiver" }), "2026-01-20"), /forfeited/);
});
test("collector batches need no separate original MAS: the batch MAS is used", () => {
  validatePayment(account, [], input({ collectedByRole: "Collector" }), "2026-01-20");
  assert.throws(() => validatePayment(account, [], input({ collectedByRole: "Courier" }), "2026-01-20"), /MAS, Collector, or DTO/);
});
test("programs are isolated and missing-month statuses stop at 150D", () => {
  // Another program's payment is ignored: this account is still NS at NOP 1 (its New Sale).
  const isolated = accountState(account, [payment({ enrollmentId: "OTHER" })], "2026-01-20");
  assert.deepEqual([isolated.status, isolated.nop, isolated.nextNop], ["NS", 1, 2]);
  // Paid January 15 for January: each later month is missed on the 15th (owner, October 17, 2026); 60D is two.
  assert.equal(accountState(account, [payment()], "2026-02-14").status, "U");
  assert.equal(accountState(account, [payment()], "2026-03-14").status, "U", "only February is missed");
  assert.equal(accountState(account, [payment()], "2026-03-15").status, "60D");
  assert.equal(accountState(account, [payment()], "2026-04-15").status, "90D");
  assert.equal(accountState(account, [payment()], "2026-05-15").status, "120D");
  assert.equal(accountState(account, [payment()], "2026-06-15").status, "150D");
  assert.equal(accountState(account, [payment()], "2026-07-10").status, "150D");
  assert.equal(accountState(account, [payment()], "2026-01-20").balance, 350, "nothing missed: the next month is due");
  assert.equal(accountState(account, [payment()], "2026-03-15").balance, 700, "60D: two months due");
});
test("paid October 10 for October: 60D and suspended on December 10, 90D on January 10 (owner, October 17, 2026)", () => {
  const a = { ...account, doi: "2026-01-15" };
  const history = [payment({ id: "A", orDate: "2026-02-10", monthFrom: "2026-02", monthTo: "2026-09", nopFrom: 2, nopTo: 9, amount: 2800 }), payment({ id: "B", orDate: "2026-10-10", monthFrom: "2026-10", monthTo: "2026-10", nopFrom: 10, nopTo: 10, amount: 350 })];
  assert.equal(accountState(a, history, "2026-10-20").paidThrough, "2026-10-10");
  for (const [day, status, suspended] of [["2026-11-09", "U", false], ["2026-11-10", "U", false], ["2026-12-09", "U", false], ["2026-12-10", "60D", true], ["2027-01-10", "90D", true]]) {
    const state = accountState(a, history, day);
    assert.deepEqual([state.status, state.temporarilySuspended], [status, suspended], day);
  }
});
test("a forfeited account takes payments only on the owner's chosen days (October 13, 2026)", () => {
  // DOI 2025-01-15, nothing paid: forfeited long before October 2026.
  const old = { ...account, doi: "2025-01-15" };
  const late = input({ monthFrom: "2025-02", monthTo: "2025-02", orDate: "2026-10-13" });
  assert.equal(accountState(old, [], "2026-10-13").status, "Forfeited");
  assert.throws(() => validatePayment(old, [], { ...late, orDate: "2026-10-12" }, "2026-10-12"), /forfeited/, "the day before: blocked");
  validatePayment(old, [], late, "2026-10-13");
  assert.throws(() => validatePayment(old, [], { ...late, orDate: "2026-10-14" }, "2026-10-14"), /forfeited/, "the day after: blocked again");
});
test("the Waiver is judged on the OR date, not the day it is encoded (October 14, 2026)", () => {
  const a = { ...account, doi: "2026-01-15" };
  const history = [payment({ id: "A", orDate: "2026-02-10", monthFrom: "2026-02", monthTo: "2026-07", nopFrom: 2, nopTo: 7, amount: 2100 })];
  // Paid through July 10 (Month of July on the OR day, October 24, 2026): August missed on August 10, September on September 10.
  const august = (orDate, waiver = "") => input({ monthFrom: "2026-08", monthTo: "2026-08", nopFrom: 8, nopTo: 8, orDate, orNumber: "OR-AUG", waiver });
  assert.equal(accountState(a, history, "2026-10-14").temporarilySuspended, true);
  validatePayment(a, history, august("2026-09-09"), "2026-10-14");
  assert.throws(() => validatePayment(a, history, august("2026-09-10"), "2026-10-14"), /Waiver/, "paid on September 10: two months missed, suspended then");
  validatePayment(a, history, august("2026-10-02", "Waiver"), "2026-10-14");
});

test("paid October 10 for July: counted from Month of on the OR day, so paid through July 10 (owner, October 24, 2026)", () => {
  const a = { ...account, doi: "2026-01-15" };
  const history = [payment({ id: "A", orDate: "2026-02-10", monthFrom: "2026-02", monthTo: "2026-06", nopFrom: 2, nopTo: 6, amount: 1750 }), payment({ id: "B", orDate: "2026-10-10", monthFrom: "2026-07", monthTo: "2026-07", nopFrom: 7, nopTo: 7, amount: 350, orNumber: "OR-JUL" })];
  const state = accountState(a, history, "2026-10-10");
  assert.deepEqual([state.paidThrough, state.suspendedAt, state.temporarilySuspended, state.status, state.forfeitedAt], ["2026-07-10", "2026-09-10", true, "90D", "2027-01-11"]);
  for (const [day, status, suspended] of [["2026-11-09", "90D", true], ["2026-11-10", "120D", true], ["2026-12-10", "150D", true], ["2027-01-10", "150D", true], ["2027-01-11", "Forfeited", false]]) {
    const later = accountState(a, history, day);
    assert.deepEqual([later.status, later.temporarilySuspended], [status, suspended], `${day}: 60D and the Waiver on the same day, Forfeited after six missed months`);
  }
  // The July payment itself, on October 10, needed a Waiver: before it the account was paid through June 10.
  assert.throws(() => validatePayment(a, [history[0]], input({ monthFrom: "2026-07", monthTo: "2026-07", nopFrom: 7, nopTo: 7, orDate: "2026-10-10", orNumber: "OR-JUL" }), "2026-10-10"), /Waiver/);
  validatePayment(a, [history[0]], input({ monthFrom: "2026-07", monthTo: "2026-07", nopFrom: 7, nopTo: 7, orDate: "2026-10-10", orNumber: "OR-JUL", waiver: "Waiver" }), "2026-10-10");
});

test("only a Forfeited carried from the old system holds; one the app worked out follows corrected receipts (PH-73684484)", () => {
  // The nightly job stored Forfeited while the receipts covered old months; the months were then corrected to recent ones.
  const corrected = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((month) => payment({ id: `C${month}`, orDate: `2026-${String(month).padStart(2, "0")}-26`, monthFrom: `2026-${String(month).padStart(2, "0")}`, monthTo: `2026-${String(month).padStart(2, "0")}`, nopFrom: month + 1, nopTo: month + 1, amount: 350 }));
  assert.equal(accountState({ ...account, doi: "2025-12-26", storedStatus: "Forfeited" }, corrected, "2026-10-26").status, "U", "the stored status alone never holds");
  assert.equal(accountState({ ...account, doi: "2025-12-26", storedStatus: "Forfeited", forfeitHeld: true }, corrected, "2026-10-26").status, "Forfeited", "an old-system forfeit holds");
});

test("forfeiture: Pay the Balance programs after more than 12 months, other programs after more than 6 (owner, October 16, 2026)", () => {
  assert.equal(forfeitMonthsFor("CAT-PAY-THE-BALANCE"), 12);
  assert.equal(forfeitMonthsFor("CAT-OTHER", "Pay the Balance"), 12, "by the category name too");
  assert.equal(forfeitMonthsFor("CAT-FUNERAL-SERVICES"), 6);
  assert.equal(forfeitMonthsFor(""), 6);
  // February paid on February 15, 2026: paid through February 15, months missed on the 15th.
  const paid = [payment({ orDate: "2026-02-15", nopFrom: 2, nopTo: 2, monthFrom: "2026-02", monthTo: "2026-02" })];
  const other = (today) => accountState(account, paid, today).status;
  const balance = (today) => accountState({ ...account, forfeitMonths: 12 }, paid, today).status;
  assert.notEqual(other("2026-08-15"), "Forfeited", "6 months: still not forfeited");
  assert.equal(other("2026-08-16"), "Forfeited", "after 6 months");
  assert.notEqual(balance("2026-08-16"), "Forfeited", "Pay the Balance: not after 6 months");
  assert.notEqual(balance("2027-02-15"), "Forfeited", "12 months: still not forfeited");
  assert.equal(balance("2027-02-16"), "Forfeited", "after 12 months");
  assert.equal(accountState({ ...account, forfeitMonths: 12 }, paid, "2026-12-01").forfeitedAt, "2027-02-16");
  // An old-system Forfeited does not hold on Pay the Balance programs; it still holds on others.
  assert.equal(accountState({ ...account, forfeitMonths: 12, storedStatus: "Forfeited", forfeitHeld: true }, paid, "2026-09-01").status, "150D", "within 12 months: overdue, not forfeited");
  assert.equal(accountState({ ...account, storedStatus: "Forfeited", forfeitHeld: true }, paid, "2026-03-01").status, "Forfeited", "other programs keep an old-system Forfeited");
});

test("a program with a registration fee: the New Sale is no NOP, so the first collection is NOP 1 for the month after DOI (owner, October 21, 2026)", async () => {
  const withFee = { ...account, registrationFee: true };
  const state = accountState(withFee, [], "2026-01-20");
  assert.deepEqual([state.status, state.nop, state.nextNop, state.nextMonth], ["NS", 0, 1, "2026-02"]);
  validatePayment(withFee, [], input({ nopFrom: 1, nopTo: 1 }), "2026-01-20");
  assert.throws(() => validatePayment(withFee, [], input(), "2026-01-20"), /NOP must start at 1/);
  const afterFirst = accountState(withFee, [payment({ monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 1, nopTo: 1, orDate: "2026-01-20" })], "2026-01-20");
  assert.deepEqual([afterFirst.nop, afterFirst.nextNop, afterFirst.nextMonth, afterFirst.tmd], [1, 2, "2026-03", 350]);
});

test("Fully Paid: a term program completes at its last month, a recorded full payment holds, and no more payments are taken (October 27, 2026)", () => {
  // D-420: ₱420 a month for 60 months (Pay Balance Total 25,200); the New Sale is NOP 1, collections NOP 2–60.
  const d420 = { ...account, doi: "2021-01-10", basePay: 420, payBalanceTotal: 25200 };
  const upTo = (lastNop) => [payment({ id: "C", orDate: "2026-01-10", monthFrom: "2021-02", monthTo: monthName(monthIndex("2021-02") + lastNop - 2), nopFrom: 2, nopTo: lastNop, amount: 420 * (lastNop - 1) })];
  assert.notEqual(accountState(d420, upTo(59), "2026-01-15").status, "Fully Paid", "NOP 59 of 60: not yet");
  const done = accountState(d420, upTo(60), "2026-01-15");
  assert.deepEqual([done.status, done.balance], ["Fully Paid", 0], "NOP 60: Fully Paid, nothing due");
  assert.equal(accountState(d420, upTo(60), "2027-12-31").status, "Fully Paid", "never falls behind or forfeits afterwards");
  assert.throws(() => validatePayment(d420, upTo(60), input({ monthFrom: "2026-01", monthTo: "2026-01", nopFrom: 61, nopTo: 61, amount: 420, orDate: "2026-01-15", orNumber: "X" }), "2026-01-15"), /fully paid/);
  // Recorded from a certificate (old receipts not in the system): Fully Paid from that day, even with few receipts.
  const recorded = { ...d420, fullyPaidOn: "2025-12-20" };
  assert.equal(accountState(recorded, [], "2025-12-19").status, "Forfeited", "before the recorded date the receipts decide");
  assert.equal(accountState(recorded, [], "2026-03-01").status, "Fully Paid");
  // Flexible: the New Sale counts toward the total.
  const flexible = { ...account, basePay: 150, payBalanceTotal: 600, flexible: true, saleCredit: 300 };
  assert.equal(accountState(flexible, [payment({ monthFrom: "2026-02", monthTo: "2026-02", nopFrom: 2, nopTo: 2, amount: 300 })], "2026-02-20").status, "Fully Paid", "300 New Sale + 300 collected = 600");
});
