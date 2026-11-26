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

test("CEO and President open Statements of Account by default", () => {
  assert.equal(access(["CEO"], "/soa"), true);
  assert.equal(access(["President"], "/soa"), true);
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

test("Company Reports is for administrators, CEO and President by default, not Entry Clerks", () => {
  assert.equal(access(["Administrator"], "/company-reports"), true);
  assert.equal(access(["CEO"], "/company-reports"), true);
  assert.equal(access(["Entry Clerk"], "/company-reports"), false);
  assert.equal(access(["Entry Clerk"], "/reports"), true, "their own report stays on Reports");
});

test("every role opens My Notices, even when its page access was configured without it", () => {
  for (const role of ["MAS", "Entry Clerk", "Finance", "HR Officer", "IT Clerk", "CEO", "President"]) assert.equal(access([role], "/my-notices"), true, role);
  // System Updates (November 12, 2026): every role reads them.
  for (const role of ["MAS", "Collector", "Entry Clerk", "Finance", "HR Officer", "IT Clerk", "CEO", "President"]) assert.equal(access([role], "/updates"), true, role);
  assert.equal(canAccessPath({ roleNames: ["MAS"], permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false }, rolePages: { mas: ["/mas-sales"] } }, "/my-notices"), true);
});

test("CEO and President open the dashboard, User Report Review, MAM, Members, and attendance pages", () => {
  for (const role of ["CEO", "President"]) {
    for (const path of ["/", "/company-reports", "/admin-reports", "/mam", "/members", "/attendance", "/attendance-tracking", "/settings"]) assert.equal(access([role], path), true, `${role} ${path}`);
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

test("Entry Corrections is for IT and Administrators, not Entry Clerks or Finance", async () => {
  const { canCorrectEntriesFor } = await import("../lib/access-control.ts");
  const context = (roleNames) => ({ roleNames, permissions });
  for (const roles of [["IT Clerk"], ["Administrator"]]) {
    assert.equal(canCorrectEntriesFor(context(roles)), true, roles[0]);
    assert.equal(access(roles, "/entry-corrections"), true, roles[0]);
  }
  for (const roles of [["Entry Clerk"], ["Finance"], ["HR Officer"], ["MAS"]]) {
    assert.equal(canCorrectEntriesFor(context(roles)), false, roles[0]);
    assert.equal(access(roles, "/entry-corrections"), false, roles[0]);
  }
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

test("Statement of Account belongs to Administrator and the executives unless granted", () => {
  assert.equal(access(["Administrator"], "/soa"), true);
  for (const role of ["Finance", "Entry Clerk", "MAS", "HR Officer", "IT Clerk"]) assert.equal(access([role], "/soa"), false, role);
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
  assert.equal(computePayrollLine({ ...base, settings: defaultPayrollSettings }).daysPaid, 3, "leave is not paid unless ticked");
  const line = computePayrollLine({ ...base, settings: { ...defaultPayrollSettings, payApprovedLeave: true } });
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
  assert.equal(boardCategory(record({}), "2026-09-29", "2026-09-30"), "Early", "exactly 08:00 counts as early");
  assert.equal(boardCategory(record({ timeIn: "08:15" }), "2026-09-29", "2026-09-30"), "On time", "within the 20-minute grace");
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

test("Finance-Auditor reads Attendance Tracking; Finance-named roles are recognised", async () => {
  const { dashboardKind, pageTicked, isFinanceFamilyRole } = await import("../lib/access-control.ts");
  const { canViewAttendanceTracking } = await import("../lib/attendance-board.ts");
  const auditor = { roleNames: ["Finance-Auditor"], permissions, rolePages: { "finance-auditor": ["/history", "/payroll"] } };
  assert.equal(isFinanceFamilyRole("Finance-Auditor"), true);
  assert.equal(isFinanceFamilyRole("Financial Planner"), false);
  assert.equal(dashboardKind(auditor, "Finance-Auditor"), "finance");
  assert.equal(pageTicked(auditor, "/history"), true);
  assert.equal(pageTicked(auditor, "/expenses"), false);
  assert.equal(pageTicked({ roleNames: ["MAS"], permissions }, "/fidelity"), false, "a default page is not a tick");
  assert.equal(canViewAttendanceTracking(auditor), true, "Finance-named role");
  assert.equal(canViewAttendanceTracking({ roleNames: ["Auditor"], permissions, rolePages: { auditor: ["/attendance-tracking"] } }), true, "ticked in Roles");
  assert.equal(canViewAttendanceTracking({ roleNames: ["Auditor"], permissions, rolePages: { auditor: ["/history"] } }), false);
});

test("MAS-Officer has the MAS pages plus MAS Report, for the branches where they are officer (November 16, 2026)", async () => {
  const { dashboardKind, isMasFamilyRole, isMasOfficerRole, masReportSeesEveryBranch } = await import("../lib/access-control.ts");
  const { masReportRows } = await import("../lib/mas-report-rows.ts");
  for (const name of ["MAS-Officer", "MAS Officer", "mas-officer"]) {
    assert.equal(isMasOfficerRole(name), true, name);
    assert.equal(isMasFamilyRole(name), true, name);
    assert.equal(access([name], "/mas-report"), true, name);
    for (const path of ["/mas-sales", "/mas-collections", "/members", "/mam", "/attendance"]) assert.equal(access([name], path), true, `${name} ${path}`);
    for (const path of ["/new-sales", "/collections", "/reports", "/payroll"]) assert.equal(access([name], path), false, `${name} ${path}`);
    assert.equal(dashboardKind({ roleNames: [name], permissions }), "mas");
  }
  assert.equal(isMasOfficerRole("MAS"), false);
  for (const role of ["MAS", "Collector", "Entry Clerk", "HR Officer"]) assert.equal(access([role], "/mas-report"), false, role);
  assert.equal(access(["Administrator"], "/mas-report"), true);
  // Branches: a MAS-Officer only their own; with a role that oversees every branch, all of them.
  assert.equal(masReportSeesEveryBranch(["MAS-Officer"]), false);
  assert.equal(masReportSeesEveryBranch(["MAS-Officer", "Entry Clerk"]), false, "Entry Clerk does not widen it");
  assert.equal(masReportSeesEveryBranch(["MAS-Officer", "Finance"]), true);
  assert.equal(masReportSeesEveryBranch(["Administrator"]), true);
  assert.equal(masReportSeesEveryBranch(["Auditor"]), true, "a role given the page in Roles");

  // The paper report's rows: every assigned MAS listed (empty cells when nothing), Net = Gross - Inc., totals.
  const staff = [{ employeeId: "E1", name: "Roldan, Emely" }, { employeeId: "E2", name: "Solon, Ana" }, { employeeId: "E3", name: "Garcia, Ben" }];
  const entries = [
    { kind: "New Sale", person: "Roldan, Emely", amount: 4000, incentive: 1400 },
    { kind: "New Sale", person: "ROLDAN,  EMELY", amount: 880, incentive: 300 },
    { kind: "Collection", person: "Roldan, Emely", amount: 4370, incentive: 1520 },
    { kind: "Collection", person: "Solon, Ana", amount: 940, incentive: 320 },
    { kind: "New Sale", person: "Garcia, Ben", amount: 320, incentive: 100 },
    { kind: "Collection", person: "DTO", amount: 500, incentive: 0 },
  ];
  const { rows, total } = masReportRows(entries, staff);
  assert.deepEqual(rows.map((row) => row.name), ["Garcia, Ben", "Roldan, Emely", "Solon, Ana", "DTO"], "the branch's MAS first, then others");
  const roldan = rows.find((row) => row.employeeId === "E1");
  assert.deepEqual(roldan.sales, { accounts: 2, gross: 4880, incentives: 1700, net: 3180 }, "names match ignoring spaces and capitals");
  assert.deepEqual(roldan.collections, { accounts: 1, gross: 4370, incentives: 1520, net: 2850 });
  assert.deepEqual(rows.find((row) => row.name === "Solon, Ana").sales, { accounts: 0, gross: 0, incentives: 0, net: 0 }, "listed with nothing sold");
  assert.equal(rows.find((row) => row.name === "DTO").assigned, false);
  assert.deepEqual(total.sales, { accounts: 3, gross: 5200, incentives: 1800, net: 3400 });
  assert.deepEqual(total.collections, { accounts: 3, gross: 5810, incentives: 1840, net: 3970 });
  assert.deepEqual(masReportRows([], []).rows, []);
});

test("MAS Report weeks: Monday to Sunday within the month, a lone first Sunday joins Week 1", async () => {
  const { masReportWeeks } = await import("../lib/mas-report-rows.ts");
  // November 2026 starts on a Sunday.
  assert.deepEqual(masReportWeeks("2026-11"), [
    { week: 1, from: "2026-11-01", to: "2026-11-08" },
    { week: 2, from: "2026-11-09", to: "2026-11-15" },
    { week: 3, from: "2026-11-16", to: "2026-11-22" },
    { week: 4, from: "2026-11-23", to: "2026-11-29" },
    { week: 5, from: "2026-11-30", to: "2026-11-30" },
  ]);
  // October 2026 starts on a Thursday: Week 1 is Thursday to Sunday.
  const october = masReportWeeks("2026-10");
  assert.deepEqual(october[0], { week: 1, from: "2026-10-01", to: "2026-10-04" });
  assert.deepEqual(october.at(-1), { week: 5, from: "2026-10-26", to: "2026-10-31" });
  // Every day of the month in exactly one week.
  for (const month of ["2026-02", "2027-02", "2026-12", "2028-02"]) {
    const weeks = masReportWeeks(month);
    assert.equal(weeks[0].from.slice(8), "01");
    for (let index = 1; index < weeks.length; index += 1) assert.equal(Date.parse(weeks[index].from) - Date.parse(weeks[index - 1].to), 86400000);
  }
});

test("MAS Report weekly range: the month most of its days fall in and that month's week", async () => {
  const { masWeekPlace } = await import("../lib/mas-report-rows.ts");
  assert.deepEqual(masWeekPlace("2026-11-09", "2026-11-14"), { month: "2026-11", week: 2 });
  assert.deepEqual(masWeekPlace("2026-09-28", "2026-10-04"), { month: "2026-10", week: 1 }, "most days in October");
  assert.deepEqual(masWeekPlace("2026-10-26", "2026-11-01"), { month: "2026-10", week: 5 }, "most days in October");
  assert.deepEqual(masWeekPlace("2026-11-01", "2026-11-07"), { month: "2026-11", week: 1 });
  assert.deepEqual(masWeekPlace("2026-11-30", "2026-11-30"), { month: "2026-11", week: 5 });
  assert.deepEqual(masWeekPlace("2026-12-30", "2027-01-02"), { month: "2027-01", week: 1 }, "a tie goes to the later month");
});

test("Inventory: Entry Clerks, Finance roles and Administrators always have it, even with pages configured before it; Administrators and Finance oversee (November 26, 2026)", async () => {
  const { canOverseeInventory } = await import("../lib/access-control.ts");
  const context = (roleNames, rolePages) => ({ roleNames, permissions, rolePages });
  assert.equal(access(["Entry Clerk"], "/inventory"), true);
  assert.equal(access(["Finance"], "/inventory"), true);
  assert.equal(access(["Finance-Auditor"], "/inventory"), true);
  assert.equal(access(["MAS"], "/inventory"), false);
  assert.equal(access(["HR Officer"], "/inventory"), false);
  assert.equal(canAccessPath(context(["Entry Clerk"], { "entry clerk": ["/new-sales"] }), "/inventory"), true, "configured before Inventory existed");
  assert.equal(canAccessPath(context(["HR Officer"], { "hr officer": ["/inventory"] }), "/inventory"), true, "granted in Roles");
  assert.deepEqual([["Administrator"], ["Finance"], ["Finance-Auditor"], ["Entry Clerk"]].map((roleNames) => canOverseeInventory({ roleNames })), [true, true, true, false]);
});
