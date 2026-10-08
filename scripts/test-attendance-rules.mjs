import assert from "node:assert/strict";
import test from "node:test";
import { clockOutFigures, dayTotals, lateMinutesFor, withDayTotals, workingMinutesBetween } from "../lib/attendance.ts";

test("late starts after the 20-minute grace period and counts from 08:20", () => {
  assert.equal(lateMinutesFor("07:45"), 0);
  assert.equal(lateMinutesFor("08:00"), 0);
  assert.equal(lateMinutesFor("08:20"), 0);
  assert.equal(lateMinutesFor("08:21"), 1);
  assert.equal(lateMinutesFor("08:25"), 5);
  assert.equal(lateMinutesFor("09:30"), 70);
});

test("the 12:00 to 13:00 lunch break is never counted as late", () => {
  assert.equal(lateMinutesFor("12:30"), 220);
  assert.equal(lateMinutesFor("13:00"), 220);
  assert.equal(lateMinutesFor("13:15"), 235);
});

test("worked hours leave out the lunch break; overtime and undertime follow the 17:00 end", () => {
  assert.deepEqual(clockOutFigures("08:00", "17:00"), { workedHours: 8, overtimeHours: 0, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("08:10", "18:30"), { workedHours: 9.33, overtimeHours: 1.5, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("08:00", "12:30"), { workedHours: 4, overtimeHours: 0, undertimeMinutes: 240 });
  assert.deepEqual(clockOutFigures("08:00", "16:00"), { workedHours: 7, overtimeHours: 0, undertimeMinutes: 60 });
  assert.deepEqual(clockOutFigures("13:00", "17:00"), { workedHours: 4, overtimeHours: 0, undertimeMinutes: 0 });
  assert.deepEqual(clockOutFigures("12:15", "12:45"), { workedHours: 0, overtimeHours: 0, undertimeMinutes: 240 });
});

test("regular hours stop at 17:00, total hours run to clock-out; neither counts the lunch break", () => {
  assert.deepEqual(dayTotals("08:00", "17:00"), { regularHours: 8, totalHours: 8 });
  assert.deepEqual(dayTotals("08:00", "19:00"), { regularHours: 8, totalHours: 10 });
  assert.deepEqual(dayTotals("07:30", "12:30"), { regularHours: 4.5, totalHours: 4.5 });
  assert.deepEqual(dayTotals("12:10", "18:00"), { regularHours: 4, totalHours: 5 });
  assert.deepEqual(dayTotals("08:00", ""), { regularHours: 0, totalHours: 0 });
});

test("working minutes are zero for an empty or reversed span", () => {
  assert.equal(workingMinutesBetween(600, 600), 0);
  assert.equal(workingMinutesBetween(700, 600), 0);
});

test("history periods: Monday-to-Sunday weeks, calendar months and years", async () => {
  const { periodRange } = await import("../lib/attendance-board.ts");
  assert.deepEqual(periodRange("week", "2026-10-07"), { from: "2026-10-05", to: "2026-10-11", previous: "2026-09-28", next: "2026-10-12", label: "Oct 5 – 11, 2026" });
  assert.equal(periodRange("week", "2026-10-11").from, "2026-10-05");
  assert.equal(periodRange("week", "2026-09-30").label, "Sep 28 – Oct 4, 2026");
  assert.deepEqual(periodRange("month", "2026-02-14"), { from: "2026-02-01", to: "2026-02-28", previous: "2026-01-01", next: "2026-03-01", label: "Feb 2026" });
  assert.deepEqual(periodRange("year", "2026-10-07"), { from: "2026-01-01", to: "2026-12-31", previous: "2025-01-01", next: "2027-01-01", label: "2026" });
});

test("history totals count each day once by category and group a year by month", async () => {
  const { summarizeHistory } = await import("../lib/attendance-board.ts");
  const day = (attendanceDate, fields) => ({ id: attendanceDate, attendanceDate, scheduledTimeIn: "08:00", timeIn: "", timeOut: "", workedHours: 0, overtimeHours: 0, lateMinutes: 0, undertimeMinutes: 0, notes: "", status: "Present", ...fields });
  const result = summarizeHistory("year", [
    day("2026-09-01", { timeIn: "07:55", timeOut: "17:00", workedHours: 8 }),
    day("2026-09-02", { timeIn: "08:10", timeOut: "17:30", workedHours: 8.5, overtimeHours: 0.5 }),
    day("2026-10-01", { timeIn: "08:35", timeOut: "17:00", workedHours: 7.42, lateMinutes: 15 }),
    day("2026-10-02", { status: "Absent" }),
    day("2026-10-03", { status: "Non-working Day" }),
  ].map(withDayTotals), "2026-10-07");
  assert.deepEqual([result.totals.early, result.totals.onTime, result.totals.late, result.totals.absent], [1, 1, 1, 1]);
  // Hours come from the clock times (a day saved with the break counted is corrected): 8.08 + 8.33 + 7.42.
  assert.equal(result.totals.workedHours, 23.83);
  assert.equal(result.totals.regularHours, 23.33);
  assert.equal(result.totals.lateMinutes, 15);
  assert.equal(result.punctuality, 67);
  assert.deepEqual(result.breakdown.map((group) => [group.label, group.totals.early + group.totals.onTime + group.totals.late]), [["Sep", 2], ["Oct", 1]]);
  assert.equal(result.days[0].attendanceDate, "2026-10-03");
});
