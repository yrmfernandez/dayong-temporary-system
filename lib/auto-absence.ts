import { sql } from "drizzle-orm";

import { closureCovers, employeeAttendanceBranches, getClosures, type Closure } from "@/lib/attendance-calendar";
import { addAttendanceRecords, getAllAttendanceForRange, type AttendanceRecord } from "@/lib/attendance-data";
import { carriedNotRequired, carriedNotRequiredNote, getPhilippineDate, SCHEDULED_TIME_IN, SCHEDULED_TIME_OUT } from "@/lib/attendance";
import { getDb } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { withWriteLock } from "@/lib/google-sheets";
import { getActiveAttendanceEmployees } from "@/lib/google-sheets-data";
import { getSetting, saveSetting } from "@/lib/system-settings";

/**
 * End-of-day absences. Once a working day is over (after 11:59 PM, Manila), every active employee with no attendance
 * record for it (no clock-in, no approved leave, not marked Absent or AWOL by management) is recorded Absent by the
 * system, so payroll and reports count it. The record says so in its notes and is encoded by "System"; management can
 * still change it to AWOL or Absent in Attendance Review, which replaces the note.
 *
 * There is no scheduler, so the days are closed the first time an attendance page or payroll is opened afterwards.
 * Sundays and declared non-working days (for the employee's branch) are skipped. Someone whose last day was marked
 * No attendance needed is not recorded Absent: the mark is carried over to the day instead (lib/attendance.ts
 * carriedNotRequired). Days before this rule started
 * (System Settings `auto_absent_from`, set on first run) are never touched, so old history is not rewritten.
 */
export const SYSTEM_ABSENCE_NOTE = "Absent by system: no clock-in by 11:59 PM and not marked by management.";
export const isSystemAbsence = (record: Pick<AttendanceRecord, "status" | "notes"> | null | undefined) =>
  record?.status === "Absent" && record.notes.startsWith("Absent by system");

const START_KEY = "auto_absent_from";
const CLOSED_KEY = "auto_absent_closed_through";
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const MAX_DAYS_PER_RUN = 62;

/**
 * Who is absent on each day from `from` to `to`: active employees with no record that day, skipping Sundays and
 * non-working days declared for their branch. An employee whose latest earlier day is No attendance needed gets that
 * mark carried over instead of an absence; `records` should reach back a week before `from` so the mark is seen.
 */
export function systemAbsences({ from, to, employees, branches, records, closures, timestamp }: {
  from: string; to: string; employees: Array<{ employeeId: string }>; branches: Map<string, string>;
  records: Array<Pick<AttendanceRecord, "employeeId" | "attendanceDate" | "status" | "notes">>; closures: Closure[]; timestamp: string;
}) {
  const recorded = new Set(records.map((record) => `${record.employeeId}|${record.attendanceDate}`));
  const absences: AttendanceRecord[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
    const closure = closures.find((item) => item.date === date);
    // Records made earlier in this run count too, so a mark carries over day after day.
    const carried = carriedNotRequired([...records, ...absences], date);
    for (const employee of employees) {
      if (recorded.has(`${employee.employeeId}|${date}`)) continue;
      if (closure && closureCovers(closure, branches.get(employee.employeeId) ?? "")) continue;
      const markedOn = carried.get(employee.employeeId);
      absences.push({
        id: `ATT-${date.replaceAll("-", "")}-${employee.employeeId}`, employeeId: employee.employeeId, attendanceDate: date,
        branch: branches.get(employee.employeeId) ?? "", scheduledTimeIn: SCHEDULED_TIME_IN, scheduledTimeOut: SCHEDULED_TIME_OUT,
        timeIn: "", timeOut: "", workedHours: 0, overtimeHours: 0, status: markedOn ? "Not Required" : "Absent", lateMinutes: 0, undertimeMinutes: 0,
        leaveType: "", leaveApprovalStatus: "", notes: markedOn ? carriedNotRequiredNote(markedOn) : SYSTEM_ABSENCE_NOTE, createdAt: timestamp, updatedAt: timestamp,
      });
    }
  }
  return absences;
}

/** Records the system absences (and carried-over marks) for every finished day not closed yet. Returns how many were recorded. */
export function closeFinishedAttendanceDays() {
  return withWriteLock("auto-absence", () => runAsSystem(async () => {
    const today = getPhilippineDate();
    const yesterday = addDays(today, -1);
    const start = await getSetting(START_KEY);
    if (!start) { await saveSetting(START_KEY, today, "System"); return 0; }
    const closedThrough = await getSetting(CLOSED_KEY);
    const from = closedThrough && closedThrough >= start ? addDays(closedThrough, 1) : start;
    if (from > yesterday) return 0;
    // A long gap is closed in parts so one page load never waits on months of work.
    const to = addDays(from, MAX_DAYS_PER_RUN - 1) < yesterday ? addDays(from, MAX_DAYS_PER_RUN - 1) : yesterday;
    const [employees, branches, records, closures] = await Promise.all([getActiveAttendanceEmployees(), employeeAttendanceBranches(), getAllAttendanceForRange(addDays(from, -7), to), getClosures(from, to)]);
    const absences = systemAbsences({ from, to, employees, branches, records, closures, timestamp: new Date().toISOString() });
    await addAttendanceRecords(absences);
    await saveSetting(CLOSED_KEY, to, "System");
    return absences.length;
  }));
}

/** Closes finished days without ever failing the page that asked; a problem is logged and retried on the next load. */
export async function closeFinishedAttendanceDaysQuietly() {
  try { await closeFinishedAttendanceDays(); }
  catch (error) { console.error("Auto absence: could not close finished days.", error); }
}

/** How far back Attendance Review asks management to look at system absences (the sidebar number counts these). */
export const SYSTEM_ABSENCE_REVIEW_DAYS = 7;

/**
 * Days of the last week with system absences nobody has marked yet, newest first (owner, October 13, 2026). Only the
 * employees Attendance Review lists count (active ones; someone who has left cannot be marked there), once per person
 * and day, and not when another record that day (a manager's mark) replaces the system absence.
 */
export async function systemAbsencesWaiting(today = getPhilippineDate()): Promise<Array<{ date: string; count: number }>> {
  const since = addDays(today, -SYSTEM_ABSENCE_REVIEW_DAYS);
  const [active, result] = await Promise.all([
    getActiveAttendanceEmployees(),
    getDb().execute(sql`select distinct a.employee_id, a.attendance_date::text as day from attendance a
      where a.attendance_status = 'Absent' and coalesce(a.notes, '') like 'Absent by system%' and a.attendance_date >= ${since}::date and a.attendance_date <= ${today}::date
        and not exists (select 1 from attendance b where b.employee_id = a.employee_id and b.attendance_date = a.attendance_date and coalesce(b.notes, '') not like 'Absent by system%')`),
  ]);
  const listed = new Set(active.map((employee) => employee.employeeId));
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ employee_id: string; day: string }>;
  const byDay = new Map<string, number>();
  for (const row of rows) if (listed.has(row.employee_id)) byDay.set(row.day, (byDay.get(row.day) ?? 0) + 1);
  return [...byDay].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date));
}
