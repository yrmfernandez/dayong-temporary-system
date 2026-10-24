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
