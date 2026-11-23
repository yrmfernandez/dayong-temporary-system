import assert from "node:assert/strict";
import { test } from "node:test";
import { manilaDateOf, manilaToday } from "../lib/manila-date.ts";

test("a time saved after midnight in Manila belongs to the Manila date (upgrade #7)", () => {
  // 00:30 on October 1 in Manila is 16:30 on September 30 in UTC.
  assert.equal(manilaDateOf("2026-09-30T16:30:00.000Z"), "2026-10-01", "UTC ISO time");
  assert.equal(manilaDateOf("2026-09-30 16:30:00+00"), "2026-10-01", "database time");
  assert.equal(manilaDateOf("2026-09-30 16:30:00.123456+00:00"), "2026-10-01", "database time with fractions");
  assert.equal(manilaDateOf("2026-10-01T00:30:00+08:00"), "2026-10-01", "Manila time with its zone");
  assert.equal(manilaDateOf(new Date("2026-09-30T16:30:00Z")), "2026-10-01", "a Date");
  assert.equal(manilaDateOf("2026-09-30T15:59:59Z"), "2026-09-30", "a second before Manila midnight");
});

test("plain dates and times without a zone are already Manila and are only cut", () => {
  assert.equal(manilaDateOf("2026-09-30"), "2026-09-30");
  assert.equal(manilaDateOf("2026-09-30 23:30"), "2026-09-30");
  assert.equal(manilaDateOf("2026-09-30T23:30:00"), "2026-09-30");
  assert.equal(manilaDateOf(""), "");
  assert.equal(manilaDateOf(null), "");
});

test("today is the Manila date", () => {
  assert.equal(manilaToday(new Date("2026-10-23T16:05:00Z")), "2026-10-24");
  assert.equal(manilaToday(new Date("2026-10-23T15:55:00Z")), "2026-10-23");
});

test("validDate takes real calendar dates only and never throws (the one copy, November 23, 2026)", async () => {
  const { validDate, addDays } = await import("../lib/manila-date.ts");
  for (const good of ["2026-11-23", "2028-02-29", "2026-12-31"]) assert.equal(validDate(good), true, good);
  for (const bad of ["2026-02-31", "2026-04-31", "2027-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "", "Nov 23, 2026"]) assert.equal(validDate(bad), false, bad);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
