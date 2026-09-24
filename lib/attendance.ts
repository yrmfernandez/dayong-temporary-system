export const ATTENDANCE_TIME_ZONE =
  "Asia/Manila";

export const SCHEDULED_TIME_IN = "08:00";

export const SCHEDULED_TIME_OUT = "17:00";

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
  | "AWOL";

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
