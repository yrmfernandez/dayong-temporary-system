// Exceptions: Fix opens what the issue needs (owner, November 6, 2026).
import assert from "node:assert/strict";
import { test } from "node:test";
import { exceptionFix } from "../lib/exception-fix.ts";

test("an amount issue opens the full editor with the amount and months paid", () => {
  const fix = exceptionFix("amounts", "Collection", true);
  assert.equal(fix.fullEdit, true, "the quick form locks the amount of a remitted entry");
  assert.ok(fix.fields.includes("amount") && fix.fields.includes("months"));
  assert.ok(!fix.fields.includes("orNumber"), "nothing that is not about the issue");
});

test("dates out of order can reach the Date Remitted", () => {
  const fix = exceptionFix("sequence", "New Sale", true);
  assert.equal(fix.fullEdit, true);
  assert.deepEqual(fix.fields, ["orDate", "dateRemitted"]);
});

test("number and date issues stay on the quick form, so old records can still be corrected", () => {
  for (const category of ["dates", "backdated", "receipts", "incomplete", "duplicates", "shared"]) assert.equal(exceptionFix(category, "Collection", true).fullEdit, false, category);
});

test("a number issue shows the number it is about", () => {
  assert.deepEqual(exceptionFix("duplicates", "Collection", true).fields, ["orNumber"]);
  assert.deepEqual(exceptionFix("duplicates", "New Sale", true).fields, ["applicationNumber"]);
  assert.deepEqual(exceptionFix("shared", "New Sale", true).fields, ["applicationNumber"]);
  assert.deepEqual(exceptionFix("incomplete", "New Sale", true).fields, ["applicationNumber"]);
  assert.deepEqual(exceptionFix("receipts", "Collection", true).fields, ["orNumber"]);
});

test("without Edit / Corrections everything opens in the quick form", () => {
  assert.equal(exceptionFix("amounts", "Collection", false).fullEdit, false);
  assert.equal(exceptionFix("sequence", "Collection", false).fullEdit, false);
  assert.ok(exceptionFix("amounts", "Collection", false).fields.includes("amount"));
});

test("an issue with no entry rule shows every field", () => {
  assert.equal(exceptionFix("members", "Collection", true).fields, undefined);
});
