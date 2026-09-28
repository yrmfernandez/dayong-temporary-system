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
