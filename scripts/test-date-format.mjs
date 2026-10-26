// One date format on every screen (owner, October 27, 2026): Oct 27, 2026 · Oct 27, 2026 3:05 PM · Oct 2026.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, formatDateTime, formatMonth, formatRange } from "../lib/date-format.ts";

test("dates show as Oct 27, 2026, whatever way they are stored", () => {
  assert.equal(formatDate("2026-10-27"), "Oct 27, 2026");
  assert.equal(formatDate("2026-01-05"), "Jan 5, 2026", "no leading zero on the day");
  assert.equal(formatDate("2026-10-26T16:30:00.000Z"), "Oct 27, 2026", "a stored time counts on its Manila date");
  assert.equal(formatDate("2026-10-26 16:30:00+00"), "Oct 27, 2026", "database time");
  assert.equal(formatDate(new Date("2026-10-26T16:30:00Z")), "Oct 27, 2026");
});

test("times show as Oct 27, 2026 3:05 PM in Manila", () => {
  assert.equal(formatDateTime("2026-10-27T07:05:00Z"), "Oct 27, 2026 3:05 PM");
  assert.equal(formatDateTime("2026-10-26 16:30:00+00"), "Oct 27, 2026 12:30 AM");
  assert.equal(formatDateTime("2026-10-27 15:05"), "Oct 27, 2026 3:05 PM", "already Manila (deadlines, slips)");
  assert.equal(formatDateTime("2026-10-27 00:00"), "Oct 27, 2026 12:00 AM");
  assert.equal(formatDateTime("2026-10-27"), "Oct 27, 2026", "a plain date has no time");
});

test("months, ranges and things that are not dates", () => {
  assert.equal(formatMonth("2026-10"), "Oct 2026");
  assert.equal(formatRange("2026-10-04", "2026-10-10"), "Oct 4, 2026 – Oct 10, 2026");
  assert.equal(formatRange("2026-10-04", "2026-10-04"), "Oct 4, 2026");
  for (const value of ["", "—", "Not recorded", "Unremitted"]) assert.equal(formatDate(value), value, "labels pass through unchanged");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("2026-13-01"), "2026-13-01", "not a real month: shown as it is");
});
