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

test("CEO and President open the dashboard, User Report Review, MAM, Members, and attendance pages", () => {
  for (const role of ["CEO", "President"]) {
    for (const path of ["/", "/admin-reports", "/mam", "/members", "/attendance", "/attendance-tracking", "/settings"]) assert.equal(access([role], path), true, `${role} ${path}`);
    for (const path of ["/reports", "/remittances", "/programs", "/fidelity", "/leave-requests", "/payroll"]) assert.equal(access([role], path), false, `${role} ${path}`);
  }
});

test("IT runs accounts and configuration; HR manages employees; neither approves money", async () => {
  const { canManageAccountsFor, canManageEmployeesFor, canManageConfigurationFor } = await import("../lib/access-control.ts");
  const context = (roleNames, overrides = {}) => ({ roleNames, permissions: { ...permissions, ...overrides } });
  assert.equal(canManageAccountsFor(context(["IT Clerk"])), true);
  assert.equal(canManageConfigurationFor(context(["IT Clerk"])), true);
  assert.equal(canManageEmployeesFor(context(["IT Clerk"])), true);
  assert.equal(canManageEmployeesFor(context(["HR Officer"])), true);
  assert.equal(canManageAccountsFor(context(["HR Officer"])), false);
  assert.equal(canManageAccountsFor(context(["Finance"])), false);
  assert.equal(canManageAccountsFor(context(["Administrator"])), true);
  assert.equal(canManageAccountsFor(context(["MAS"], { manageUsers: true })), true);
  for (const path of ["/user-accounts", "/roles", "/employees", "/branches", "/programs", "/master-data", "/history"]) assert.equal(access(["IT Clerk"], path), true, path);
  for (const path of ["/remittances", "/expenses", "/payroll", "/cash-transactions"]) assert.equal(access(["IT Clerk"], path), false, path);
});

test("the dashboard follows the chosen workspace only when the user holds that role", async () => {
  const { dashboardKind } = await import("../lib/access-control.ts");
  const user = (roleNames) => ({ roleNames, permissions, rolePages: {}, roles: [], userId: "U", employeeId: "E", name: "N" });
  assert.equal(dashboardKind(user(["Administrator", "Entry Clerk"])), "admin");
  assert.equal(dashboardKind(user(["Administrator", "Entry Clerk"]), "Entry Clerk"), "entry");
  assert.equal(dashboardKind(user(["Entry Clerk"]), "Administrator"), "entry", "a forged cookie cannot unlock another dashboard");
  assert.equal(dashboardKind(user(["Finance"]), "MAS"), "mas");
  assert.equal(dashboardKind(user(["CEO"]), "MAS"), "executive", "executive-only users have no MAS workspace");
  assert.equal(dashboardKind(user(["IT Clerk"])), "it");
  assert.equal(dashboardKind(user(["Collector"])), "collector");
  assert.equal(dashboardKind(user(["HR Officer", "Finance"]), "HR Officer"), "hr");
});

test("New Sales, Collections and Reports belong to the Entry Clerk's daily operations", () => {
  const encoding = ["/new-sales", "/collections", "/reports", "/reports/daily", "/reports/weekly", "/reports/monthly", "/reports/yearly"];
  for (const path of encoding) assert.equal(access(["Entry Clerk"], path), true, `Entry Clerk ${path}`);
  for (const role of ["Finance", "MAS", "Collector", "HR Officer", "IT Clerk", "CEO", "President"]) {
    for (const path of encoding) assert.equal(access([role], path), false, `${role} ${path}`);
  }
  assert.equal(access(["Finance", "Entry Clerk"], "/collections"), true, "a person holding both roles keeps the encoding pages");
  assert.equal(access(["Administrator"], "/collections"), true, "Administrator keeps every page");
});

test("Statement of Account is an Administrator page unless granted", () => {
  assert.equal(access(["Administrator"], "/soa"), true);
  for (const role of ["Finance", "Entry Clerk", "MAS", "HR Officer", "IT Clerk", "CEO"]) assert.equal(access([role], "/soa"), false, role);
  assert.equal(canAccessPath({ roleNames: ["Finance"], permissions, rolePages: { finance: ["/soa"] } }, "/soa"), true, "an administrator can grant it in Roles");
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

test("attendance board: who is late, early, absent, AWOL, or on leave, and who may adjust late time", async () => {
  const { boardCategory, canAdjustLateness, canViewAttendanceTracking } = await import("../lib/attendance-board.ts");
  const record = (overrides) => ({ status: "Present", timeIn: "08:00", scheduledTimeIn: "08:00", lateMinutes: 0, ...overrides });
  assert.equal(boardCategory(record({ timeIn: "08:25", lateMinutes: 25 }), "2026-09-29", "2026-09-30"), "Late");
  assert.equal(boardCategory(record({ timeIn: "08:25", lateMinutes: 0 }), "2026-09-29", "2026-09-30"), "On time", "late adjusted to zero");
  assert.equal(boardCategory(record({ timeIn: "07:40" }), "2026-09-29", "2026-09-30"), "Early");
  assert.equal(boardCategory(record({}), "2026-09-29", "2026-09-30"), "On time");
  assert.equal(boardCategory(record({ status: "AWOL", timeIn: "" }), "2026-09-29", "2026-09-30"), "AWOL");
  assert.equal(boardCategory(record({ status: "Leave", timeIn: "" }), "2026-09-29", "2026-09-30"), "On leave");
  assert.equal(boardCategory(null, "2026-09-29", "2026-09-30"), "Absent", "no record on a past day");
  assert.equal(boardCategory(null, "2026-09-30", "2026-09-30"), "Not clocked in", "no record yet today");
  const user = (roleNames, overrides = {}) => ({ roleNames, permissions: { ...permissions, ...overrides } });
  for (const role of ["CEO", "President", "Administrator", "HR Officer"]) assert.equal(canAdjustLateness(user([role])), true, role);
  assert.equal(canViewAttendanceTracking(user(["Finance"])), true);
  assert.equal(canAdjustLateness(user(["Finance"])), false, "Finance views but does not adjust");
  assert.equal(canAdjustLateness(user(["MAS"])), false);
});
