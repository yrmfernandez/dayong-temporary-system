import assert from "node:assert/strict";
import test from "node:test";
import { clockOutFigures, lateMinutesFor, workingMinutesBetween } from "../lib/attendance.ts";

test("clocking in within 20 minutes of 08:00 is not late; after that, late counts from 08:00", () => {
  assert.equal(lateMinutesFor("07:45"), 0);
  assert.equal(lateMinutesFor("08:00"), 0);
  assert.equal(lateMinutesFor("08:20"), 0);
  assert.equal(lateMinutesFor("08:21"), 21);
  assert.equal(lateMinutesFor("09:30"), 90);
});

test("the 12:00 to 13:00 lunch break is never counted as late", () => {
  assert.equal(lateMinutesFor("12:30"), 240);
  assert.equal(lateMinutesFor("13:00"), 240);
  assert.equal(lateMinutesFor("13:15"), 255);
});

test("worked hours leave out the lunch break; overtime and undertime follow the 17:00 end", () => {
  assert.deepEqual(clockOutFigures("08:00", "17:00"), { workedHours: 8, overtimeHours: 0, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("08:10", "18:30"), { workedHours: 9.33, overtimeHours: 1.5, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("08:00", "12:30"), { workedHours: 4, overtimeHours: 0, undertimeMinutes: 240 });
  assert.deepEqual(clockOutFigures("08:00", "16:00"), { workedHours: 7, overtimeHours: 0, undertimeMinutes: 60 });
  assert.deepEqual(clockOutFigures("13:00", "17:00"), { workedHours: 4, overtimeHours: 0, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("12:15", "12:45"), { workedHours: 0, overtimeHours: 0, undertimeMinutes: 240 });
});

test("working minutes are zero for an empty or reversed span", () => {
  assert.equal(workingMinutesBetween(600, 600), 0);
  assert.equal(workingMinutesBetween(700, 600), 0);
});
