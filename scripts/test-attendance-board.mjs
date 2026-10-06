import assert from "node:assert/strict";
import test from "node:test";
import { boardCategory } from "../lib/attendance-board.ts";

test("recorded days off stay separate from absences on past and current days", () => {
  const record = { status: "Day Off", timeIn: "", lateMinutes: 0 };
  assert.equal(boardCategory(record, "2026-10-05", "2026-10-06"), "Day Off");
  assert.equal(boardCategory(record, "2026-10-06", "2026-10-06"), "Day Off");
});

test("missing attendance keeps the existing past-day and current-day categories", () => {
  assert.equal(boardCategory(null, "2026-10-05", "2026-10-06"), "Absent");
  assert.equal(boardCategory(null, "2026-10-06", "2026-10-06"), "Not clocked in");
  assert.equal(boardCategory({ status: "Leave" }, "2026-10-06", "2026-10-06"), "On leave");
});
