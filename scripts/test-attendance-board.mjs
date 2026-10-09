import assert from "node:assert/strict";
import test from "node:test";
import { boardCategory } from "../lib/attendance-board.ts";

test("recorded days off stay separate from absences on past and current days", () => {
  const record = { status: "Day Off", timeIn: "", lateMinutes: 0 };
  assert.equal(boardCategory(record, "2026-10-05", "2026-10-06"), "Day Off");
  assert.equal(boardCategory(record, "2026-10-06", "2026-10-06"), "Day Off");
});

test("no attendance needed is its own category, never absent", () => {
  const record = { status: "Not Required", timeIn: "", lateMinutes: 0 };
  assert.equal(boardCategory(record, "2026-10-05", "2026-10-06"), "Not required");
  assert.equal(boardCategory(record, "2026-10-06", "2026-10-06"), "Not required");
});

test("missing attendance keeps the existing past-day and current-day categories", () => {
  assert.equal(boardCategory(null, "2026-10-05", "2026-10-06"), "Absent");
  assert.equal(boardCategory(null, "2026-10-06", "2026-10-06"), "Not clocked in");
  assert.equal(boardCategory({ status: "Leave" }, "2026-10-06", "2026-10-06"), "On leave");
});

test("08:00 or earlier is Early, up to 08:20 is On time, and late minutes make it Late", () => {
  const day = (timeIn, lateMinutes = 0) => ({ status: "Present", timeIn, scheduledTimeIn: "08:00", lateMinutes });
  assert.equal(boardCategory(day("07:50"), "2026-10-07", "2026-10-07"), "Early");
  assert.equal(boardCategory(day("08:00"), "2026-10-07", "2026-10-07"), "Early");
  assert.equal(boardCategory(day("08:01"), "2026-10-07", "2026-10-07"), "On time");
  assert.equal(boardCategory(day("08:20"), "2026-10-07", "2026-10-07"), "On time");
  assert.equal(boardCategory(day("08:25", 5), "2026-10-07", "2026-10-07"), "Late");
});
