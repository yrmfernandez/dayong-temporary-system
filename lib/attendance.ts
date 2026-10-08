export const ATTENDANCE_TIME_ZONE =
  "Asia/Manila";

export const SCHEDULED_TIME_IN = "08:00";

export const SCHEDULED_TIME_OUT = "17:00";

/**
 * Clocking in up to 20 minutes after the scheduled time-in is not late, and late counts from the end of that grace
 * period: 08:20 is on time, 08:25 is 5 minutes late. At or before 08:00 is Early (lib/attendance-board.ts).
 */
export const LATE_GRACE_MINUTES = 20;

/** Unpaid lunch break: not counted as worked, late or undertime. 08:00–17:00 less the break is the 8-hour day. */
export const BREAK_START = "12:00";
export const BREAK_END = "13:00";

/** "08:05" or "08:05:30" → minutes after midnight. */
export const timeToMinutes = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };
const roundHours = (minutes: number) => Number((minutes / 60).toFixed(2));

/** Minutes from `from` to `to` (minutes after midnight), less the part that falls in the lunch break. */
export function workingMinutesBetween(from: number, to: number) {
  if (to <= from) return 0;
  const overlap = Math.max(0, Math.min(to, timeToMinutes(BREAK_END)) - Math.max(from, timeToMinutes(BREAK_START)));
  return to - from - overlap;
}

/** Late minutes for a time-in: the working time after the grace period (08:20) up to the time-in. */
export function lateMinutesFor(timeIn: string, scheduledTimeIn = SCHEDULED_TIME_IN) {
  return workingMinutesBetween(timeToMinutes(scheduledTimeIn) + LATE_GRACE_MINUTES, timeToMinutes(timeIn));
}

/** Worked (total) hours, overtime hours and undertime minutes for a day, with the lunch break left out of worked and undertime. */
export function clockOutFigures(timeIn: string, timeOut: string, scheduledTimeOut = SCHEDULED_TIME_OUT) {
  const start = timeToMinutes(timeIn), end = timeToMinutes(timeOut), scheduledEnd = timeToMinutes(scheduledTimeOut);
  return {
    workedHours: roundHours(workingMinutesBetween(start, end)),
    overtimeHours: roundHours(Math.max(0, end - scheduledEnd)),
    undertimeMinutes: workingMinutesBetween(end, scheduledEnd),
  };
}

/**
 * The day's two totals, both without the lunch break:
 *   Regular hours = working time from time-in to the scheduled end (17:00), or to time-out when it is earlier.
 *   Total hours   = working time from time-in to time-out, overtime included (the saved worked hours).
 */
export function dayTotals(timeIn: string, timeOut: string, scheduledTimeOut = SCHEDULED_TIME_OUT) {
  if (!timeIn || !timeOut) return { regularHours: 0, totalHours: 0 };
  const start = timeToMinutes(timeIn), end = timeToMinutes(timeOut), scheduledEnd = timeToMinutes(scheduledTimeOut || SCHEDULED_TIME_OUT);
  return {
    regularHours: roundHours(workingMinutesBetween(start, Math.min(end, scheduledEnd))),
    totalHours: roundHours(workingMinutesBetween(start, end)),
  };
}

/**
 * A record with its regular and total hours worked out from its clock times. Days saved before October 7, 2026 kept
 * the lunch break in their saved worked hours; this leaves it out for them too.
 */
export function withDayTotals<T extends { timeIn: string; timeOut: string; scheduledTimeOut?: string; workedHours: number }>(record: T): T & { regularHours: number } {
  if (!record.timeIn || !record.timeOut) return { ...record, regularHours: 0 };
  const { regularHours, totalHours } = dayTotals(record.timeIn, record.timeOut, record.scheduledTimeOut);
  return { ...record, regularHours, workedHours: totalHours };
}

/*
 * JavaScript weekday numbers:
 * 0 Sunday, 1 Monday, ... 6 Saturday
 */
export const WORKING_DAYS = [
  1, 2, 3, 4, 5, 6,
];

export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Leave"
  | "AWOL"
  | "Non-working Day"
  /** An administrator gave the employee the day off: neither worked nor absent. */
  | "Day Off";

export function getPhilippineDate(
  date = new Date(),
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIME_ZONE,
  }).format(date);
}

export function getPhilippineTime(
  date = new Date(),
) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function isWorkingDay(
  date = new Date(),
) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    weekday: "short",
  }).format(date);

  return ![
    "Sun",
  ].includes(
    weekday,
  );
}
