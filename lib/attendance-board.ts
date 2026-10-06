import type { SessionUser } from "@/lib/auth";
import type { AttendanceRecord } from "@/lib/attendance-data";

/** Where an employee stands on one day. Present covers On time, Late, and Early. */
export type BoardCategory = "On time" | "Late" | "Early" | "Absent" | "AWOL" | "On leave" | "Day Off" | "Not clocked in" | "Non-working day";

const roleNames = (user: Pick<SessionUser, "roleNames">) => user.roleNames.map((role) => role.trim().toLowerCase());

export function canViewAttendanceTracking(user: Pick<SessionUser, "roleNames" | "permissions">) {
  return roleNames(user).some((role) => ["administrator", "admin", "hr officer", "hr", "finance", "ceo", "president"].includes(role))
    || Boolean(user.permissions.manageAttendance || user.permissions.viewAttendanceReports);
}

/** Late time may be corrected by management and HR (it flows into payroll deductions); Finance only views it. */
export function canAdjustLateness(user: Pick<SessionUser, "roleNames" | "permissions">) {
  return roleNames(user).some((role) => ["administrator", "admin", "hr officer", "hr", "ceo", "president"].includes(role))
    || Boolean(user.permissions.manageAttendance);
}

/**
 * A missing record is Absent once the day has passed; today it is only "Not clocked in" yet.
 * A clocked-in employee is Late when late minutes remain, Early when they clocked in before the schedule.
 */
export function boardCategory(record: AttendanceRecord | null, date: string, today: string): BoardCategory {
  if (record?.status === "Day Off") return "Day Off";
  if (record?.status === "Leave") return "On leave";
  if (record?.status === "AWOL") return "AWOL";
  if (record?.status === "Absent") return "Absent";
  if (!record?.timeIn) return date < today ? "Absent" : "Not clocked in";
  if (record.lateMinutes > 0) return "Late";
  if (record.scheduledTimeIn && record.timeIn < record.scheduledTimeIn) return "Early";
  return "On time";
}

/** Minutes between two HH:MM times; positive when `later` is after `earlier`. */
export function minutesBetween(earlier: string, later: string) {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return toMinutes(later) - toMinutes(earlier);
}
