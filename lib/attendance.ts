export const ATTENDANCE_TIME_ZONE =
  "Asia/Manila";

export const SCHEDULED_TIME_IN = "08:00";

export const SCHEDULED_TIME_OUT = "17:00";

/** Clocking in up to 20 minutes after the scheduled time-in (08:20) is not late. From 08:21, late counts from 08:00. */
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

/** Late minutes for a time-in: 0 within the grace period, otherwise the working time missed since the scheduled time-in. */
export function lateMinutesFor(timeIn: string, scheduledTimeIn = SCHEDULED_TIME_IN) {
  const start = timeToMinutes(scheduledTimeIn), arrived = timeToMinutes(timeIn);
  return arrived - start <= LATE_GRACE_MINUTES ? 0 : workingMinutesBetween(start, arrived);
}

/** Worked hours, overtime hours and undertime minutes for a day, with the lunch break left out of worked and undertime. */
export function clockOutFigures(timeIn: string, timeOut: string, scheduledTimeOut = SCHEDULED_TIME_OUT) {
  const start = timeToMinutes(timeIn), end = timeToMinutes(timeOut), scheduledEnd = timeToMinutes(scheduledTimeOut);
  return {
    workedHours: roundHours(workingMinutesBetween(start, end)),
    overtimeHours: roundHours(Math.max(0, end - scheduledEnd)),
    undertimeMinutes: workingMinutesBetween(end, scheduledEnd),
  };
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
