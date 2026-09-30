import assert from "node:assert/strict";
import test from "node:test";
import { canAccessPath } from "../lib/access-control.ts";

const permissions = { manageUsers: false, manageAttendance: false, viewAttendanceReports: false };
const access = (roleNames, pathname, overrides = {}) => canAccessPath({ roleNames, permissions: { ...permissions, ...overrides } }, pathname);

test("configured role pages replace that role's defaults, but never restrict Administrator", () => {
  const context = (roleNames, rolePages) => ({ roleNames, permissions, rolePages });
  const finance = context(["Finance"], { finance: ["/remittances"] });
  assert.equal(canAccessPath(finance, "/remittances"), true);
  assert.equal(canAccessPath(finance, "/expenses"), false);
  assert.equal(canAccessPath(finance, "/"), true);
  assert.equal(canAccessPath(finance, "/settings"), true);
  assert.equal(canAccessPath(context(["Entry Clerk"], { "entry clerk": ["/expenses"] }), "/expenses"), true);
  assert.equal(canAccessPath(context(["Administrator"], { administrator: [] }), "/roles"), true);
  // Unconfigured roles keep defaults alongside configured ones.
  assert.equal(canAccessPath(context(["Finance", "Entry Clerk"], { finance: ["/remittances"] }), "/new-sales"), true);
});

test("Administrator can open every implemented workspace", () => {
  assert.equal(access(["Administrator"], "/expenses"), true);
  assert.equal(access(["Administrator"], "/user-accounts"), true);
  assert.equal(access(["Administrator"], "/reports/yearly"), true);
});

test("Entry Clerk sees encoding pages but not finance or system administration", () => {
  assert.equal(access(["Entry Clerk"], "/new-sales"), true);
  assert.equal(access(["Entry Clerk"], "/collections"), true);
  assert.equal(access(["Entry Clerk"], "/reports"), true);
  assert.equal(access(["Entry Clerk"], "/reports/daily"), true);
  assert.equal(access(["Entry Clerk"], "/remittances"), true);
  assert.equal(access(["MAS"], "/fidelity"), true);
  assert.equal(access(["MAS"], "/master-data"), true);
  assert.equal(access(["Finance"], "/fidelity"), true);
  assert.equal(access(["Entry Clerk"], "/fidelity"), true);
  assert.equal(access(["Entry Clerk"], "/programs"), true);
  assert.equal(access(["Entry Clerk"], "/branches"), true);
  assert.equal(access(["Entry Clerk"], "/settings"), true);
  assert.equal(access(["Entry Clerk"], "/expenses"), false);
  assert.equal(access(["Entry Clerk"], "/user-accounts"), false);
});

test("HR and Finance receive separate workspaces", () => {
  assert.equal(access(["HR Officer"], "/employees"), true);
  assert.equal(access(["HR Officer"], "/cash-transactions"), false);
  assert.equal(access(["Finance"], "/cash-transactions"), true);
  assert.equal(access(["Finance"], "/attendance-reviews"), false);
  assert.equal(access(["Finance"], "/attendance-tracking"), true);
  assert.equal(access(["HR Officer"], "/attendance-tracking"), true);
});

test("CEO and President only open the dashboard and attendance pages", () => {
  for (const role of ["CEO", "President"]) {
    assert.equal(access([role], "/"), true);
    assert.equal(access([role], "/attendance"), true);
    assert.equal(access([role], "/attendance-tracking"), true);
    assert.equal(access([role], "/settings"), true);
    for (const path of ["/reports", "/remittances", "/members", "/mam", "/programs", "/fidelity", "/leave-requests", "/payroll"]) assert.equal(access([role], path), false, `${role} ${path}`);
  }
});

test("specific action flags supplement role navigation", () => {
  assert.equal(access(["Entry Clerk"], "/user-accounts", { manageUsers: true }), true);
  assert.equal(access(["MAS"], "/attendance-reviews", { viewAttendanceReports: true }), true);
  assert.equal(access(["MAS"], "/attendance-tracking", { viewAttendanceReports: true }), true);
});

test("sessions without role names receive only the safe dashboard fallback", () => {
  assert.equal(access([], "/"), true);
  assert.equal(access([], "/programs"), false);
  assert.equal(access([], "/branches"), false);
  assert.equal(access([], "/collections"), false);
});

test("program age restriction validates input and checks member age", async () => {
  const { normalizeAgeRestriction, ageRestrictionError, ageOn, readAgeRestriction } = await import("../lib/program-age.ts");
  assert.deepEqual(normalizeAgeRestriction({ ageRestricted: false, minAge: "18" }), { ageRestricted: false, minAge: null, maxAge: null });
  assert.deepEqual(normalizeAgeRestriction({ ageRestricted: true, minAge: "18", maxAge: "" }), { ageRestricted: true, minAge: 18, maxAge: null });
  assert.throws(() => normalizeAgeRestriction({ ageRestricted: true, minAge: "" }), /minimum age/);
  assert.throws(() => normalizeAgeRestriction({ ageRestricted: true, minAge: "60", maxAge: "40" }), /maximum age/);
  const range = { ageRestricted: true, minAge: 18, maxAge: 65 };
  assert.equal(ageOn("2000-09-29", "2026-09-28"), 25);
  assert.equal(ageOn("9/28/2000", "2026-09-28"), 26);
  assert.equal(ageRestrictionError(range, "2010-01-01", "2026-09-28") !== null, true);
  assert.equal(ageRestrictionError(range, "1990-01-01", "2026-09-28"), null);
  assert.equal(ageRestrictionError({ ageRestricted: true, minAge: 60, maxAge: null }, "1940-01-01", "2026-09-28"), null);
  assert.match(ageRestrictionError(range, "", "2026-09-28"), /birthdate/);
  assert.deepEqual(readAgeRestriction(Array(13).fill("").concat(["Yes", 21, ""])), { ageRestricted: true, minAge: 21, maxAge: null });
});

test("payroll: daily staff paid by attendance with overtime, late, and undertime toggles", async () => {
  const { computePayrollLine, lineTotals, defaultPayrollSettings } = await import("../lib/payroll-calc.ts");
  const profile = { employeeId: "E1", baseType: "daily", baseRate: 800, commissionEligible: false, hoursPerDay: 8, overtimeMultiplier: 1.25, status: "active", notes: "" };
  const day = (overrides = {}) => ({ status: "Present", overtimeHours: 0, lateMinutes: 0, undertimeMinutes: 0, leaveApprovalStatus: "", ...overrides });
  const attendance = [day({ overtimeHours: 2 }), day({ lateMinutes: 30 }), day({ undertimeMinutes: 60 }), day({ status: "Leave", leaveApprovalStatus: "Approved" }), day({ status: "Absent" })];
  const base = { employeeId: "E1", employeeName: "Staff", roles: "Entry Clerk", profile, attendance, commissions: [], earnedIncentive: 0, from: "2026-09-01", to: "2026-09-15" };
  const line = computePayrollLine({ ...base, settings: defaultPayrollSettings });
  assert.equal(line.daysPaid, 4); // 3 present + 1 approved leave
  assert.equal(line.basePay, 3200);
  assert.equal(line.overtimePay, 250); // 2h × 100/h × 1.25
  assert.equal(line.lateDeduction, 50); // 30 min × 100/h
  assert.equal(line.undertimeDeduction, 100);
  assert.equal(lineTotals(line, []).net, 3300);
  const plain = computePayrollLine({ ...base, settings: { ...defaultPayrollSettings, includeOvertime: false, deductLate: false, deductUndertime: false, payApprovedLeave: false } });
  assert.equal(plain.basePay, 2400);
  assert.equal(lineTotals(plain, []).net, 2400);
});

test("payroll: monthly salary on scheduled days deducts recorded absences; MAS commission-only with adjustments", async () => {
  const { computePayrollLine, lineTotals, defaultPayrollSettings, dailyRateOf, scheduledWorkingDays } = await import("../lib/payroll-calc.ts");
  assert.equal(scheduledWorkingDays("2026-09-01", "2026-09-15"), 13); // two Sundays excluded
  assert.equal(dailyRateOf({ baseType: "monthly", baseRate: 15650 }), 600);
  const monthly = { employeeId: "E2", baseType: "monthly", baseRate: 15650, commissionEligible: false, hoursPerDay: 8, overtimeMultiplier: 1.25, status: "active", notes: "" };
  const line = computePayrollLine({ employeeId: "E2", employeeName: "Clerk", roles: "HR Officer", profile: monthly, attendance: [{ status: "Absent", overtimeHours: 0, lateMinutes: 0, undertimeMinutes: 0, leaveApprovalStatus: "" }], commissions: [], earnedIncentive: 0, settings: { ...defaultPayrollSettings, baseMethod: "scheduled" }, from: "2026-09-01", to: "2026-09-15" });
  assert.equal(line.basePay, 7800);
  assert.equal(line.absenceDeduction, 600);
  const mas = { employeeId: "M1", baseType: "none", baseRate: 0, commissionEligible: true, hoursPerDay: 8, overtimeMultiplier: 1.25, status: "active", notes: "" };
  const masLine = computePayrollLine({ employeeId: "M1", employeeName: "MAS", roles: "MAS", profile: mas, attendance: [], commissions: [{ id: "COM-1", netCommission: 4500 }], earnedIncentive: 5000, settings: defaultPayrollSettings, from: "2026-09-01", to: "2026-09-15" });
  assert.equal(masLine.basePay, 0);
  assert.deepEqual(masLine.commissionIds, ["COM-1"]);
  const totals = lineTotals(masLine, [{ id: "A1", employeeId: "M1", kind: "Addition", category: "Management discretion", amount: 1000, reason: "Owner-approved" }, { id: "A2", employeeId: "M1", kind: "Deduction", category: "Cash advance", amount: 700, reason: "Advance" }]);
  assert.equal(totals.gross, 5500);
  assert.equal(totals.net, 4800);
});
