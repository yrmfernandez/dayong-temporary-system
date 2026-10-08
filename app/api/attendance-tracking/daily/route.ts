import { getSessionUser } from "@/lib/auth-server";
import { closeFinishedAttendanceDaysQuietly, isSystemAbsence } from "@/lib/auto-absence";
import { withEncoder } from "@/lib/encoder-context";
import { closureCovers, closureLabel, getClosures } from "@/lib/attendance-calendar";
import { getAttendanceForEmployeeDate, getAttendanceRecordsForDate, updateAttendanceRecord } from "@/lib/attendance-data";
import { clockOutFigures, getPhilippineDate, SCHEDULED_TIME_OUT } from "@/lib/attendance";
import { boardCategory, canAdjustLateness, canViewAttendanceTracking, minutesBetween } from "@/lib/attendance-board";
import { getEmployees } from "@/lib/employees";
import { getActiveAttendanceEmployees, getBranches } from "@/lib/google-sheets-data";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const MAX_LATE_MINUTES = 24 * 60;
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** One day's board: every active employee with their record and whether they were on time, late, early, absent, AWOL, or on leave. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canViewAttendanceTracking(user)) return Response.json({ success: false, message: "Attendance tracking access is required." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  const today = getPhilippineDate();
  if (!validDate(date) || date > today) return Response.json({ success: false, message: "Choose a valid date, today or earlier." }, { status: 400 });
  try {
    await closeFinishedAttendanceDaysQuietly();
    const [active, employees, branches, records, closures] = await Promise.all([getActiveAttendanceEmployees(), getEmployees(), getBranches(), getAttendanceRecordsForDate(date), getClosures(date, date)]);
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
    const details = new Map(employees.map((employee) => [employee.id, employee]));
    const byEmployee = new Map(records.map((record) => [record.employeeId, record]));
    const nonWorkingDay = closures[0] ?? null;
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    const rows = active.map((employee) => {
      const record = byEmployee.get(employee.employeeId) ?? null;
      const detail = details.get(employee.employeeId);
      // Clock-ins cancelled by the closure keep their branch; otherwise the branch they would clock in at.
      const attendanceBranch = record?.branch || detail?.branch || branchNames.get(detail?.branchIds[0] ?? "") || "";
      const closed = Boolean(nonWorkingDay && closureCovers(nonWorkingDay, attendanceBranch)) && !record?.timeIn;
      return {
        employeeId: employee.employeeId, name: employee.fullName, roles: detail?.roles ?? [],
        branches: (detail?.branchIds ?? []).map((id) => branchNames.get(id) ?? id),
        category: closed && record?.status !== "Day Off" ? "Non-working day" as const : boardCategory(record, date, today),
        systemAbsent: isSystemAbsence(record),
        earlyMinutes: record?.timeIn && record.scheduledTimeIn ? Math.max(0, minutesBetween(record.timeIn, record.scheduledTimeIn)) : 0,
        record,
      };
    });
    return Response.json({
      success: true, date, today, canAdjustLate: canAdjustLateness(user), canSetClockOut: canAdjustLateness(user),
      closedDay: nonWorkingDay ? `Non-working day (${closureLabel(nonWorkingDay)}): ${nonWorkingDay.reason}` : sunday ? "Sunday is not a working day." : "",
      rows,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the attendance board." }, { status: 500 });
  }
}

/**
 * Corrects a clocked-in employee's day: late minutes, (action "clockOut") the time out for someone who forgot to clock
 * out or clocked out at the wrong time, or (action "resume") voiding today's clock-out made by mistake so the session
 * continues. Worked hours, overtime and undertime are recalculated exactly as at clock-out (cleared on resume, until the
 * employee clocks out again). Every change and its reason are kept in the record's notes.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAdjustLateness(user)) return Response.json({ success: false, message: "You are not allowed to correct attendance." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === "clockOut") return Response.json(await setClockOut(body, user.name));
    if (body.action === "resume") return Response.json(await resumeClock(body, user.name));
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const date = typeof body.attendanceDate === "string" ? body.attendanceDate.trim() : "";
    const lateMinutes = Number(body.lateMinutes);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!employeeId || !validDate(date)) throw new Error("Choose the employee and date to adjust.");
    if (!Number.isInteger(lateMinutes) || lateMinutes < 0 || lateMinutes > MAX_LATE_MINUTES) throw new Error("Late time must be whole minutes from 0 to 24 hours.");
    if (reason.length < 3) throw new Error("Enter the reason for the adjustment.");
    const { record, rowNumber } = await getAttendanceForEmployeeDate(employeeId, date);
    if (!record || !rowNumber || !record.timeIn || record.status !== "Present") throw new Error("Only a clocked-in attendance record can have its late time adjusted.");
    if (record.lateMinutes === lateMinutes) throw new Error("The late time is already that amount.");
    const timestamp = new Date().toISOString();
    const note = `Late adjusted from ${record.lateMinutes} to ${lateMinutes} min by ${user.name} on ${getPhilippineDate()}: ${reason}`;
    const updated = { ...record, lateMinutes, notes: [record.notes, note].filter(Boolean).join(" | "), updatedAt: timestamp };
    await updateAttendanceRecord(rowNumber, updated);
    return Response.json({ success: true, message: `Late time for ${employeeId} set to ${lateMinutes} minutes.`, record: updated });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to adjust late time." }, { status: 400 });
  }
});

/** Voids today's clock-out (clicked by mistake): the session runs on from the time in, and the employee clocks out again later. */
async function resumeClock(body: Record<string, unknown>, by: string) {
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const date = typeof body.attendanceDate === "string" ? body.attendanceDate.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!employeeId || !validDate(date)) throw new Error("Choose the employee and date to resume.");
  if (reason.length < 3) throw new Error("Enter the reason for resuming the clock.");
  const today = getPhilippineDate();
  if (date !== today) throw new Error("Only today's clock-out can be voided. For an earlier day, use Fix clock-out to set the right time.");
  const { record, rowNumber } = await getAttendanceForEmployeeDate(employeeId, date);
  if (!record || !rowNumber || !record.timeIn || record.status !== "Present") throw new Error("Only a clocked-in attendance record can be resumed.");
  if (!record.timeOut) throw new Error("This employee has not clocked out; the clock is still running.");
  const note = `Clock-out at ${record.timeOut} voided by ${by} on ${today}, clock resumed: ${reason}`;
  const updated = {
    ...record, timeOut: "", workedHours: 0, overtimeHours: 0, undertimeMinutes: 0,
    notes: [record.notes, note].filter(Boolean).join(" | "), updatedAt: new Date().toISOString(),
  };
  await updateAttendanceRecord(rowNumber, updated);
  return { success: true, message: `Clock-out at ${record.timeOut} voided for ${employeeId}. Their clock continues from ${record.timeIn} until they clock out again.`, record: updated };
}

async function setClockOut(body: Record<string, unknown>, by: string) {
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const date = typeof body.attendanceDate === "string" ? body.attendanceDate.trim() : "";
  const timeOut = typeof body.timeOut === "string" ? body.timeOut.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!employeeId || !validDate(date)) throw new Error("Choose the employee and date to correct.");
  if (!validTime(timeOut)) throw new Error("Enter the time out as HH:MM.");
  if (reason.length < 3) throw new Error("Enter the reason for setting the clock-out.");
  const { record, rowNumber } = await getAttendanceForEmployeeDate(employeeId, date);
  if (!record || !rowNumber || !record.timeIn || record.status !== "Present") throw new Error("Only a clocked-in attendance record can have its clock-out set.");
  const today = getPhilippineDate();
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (date === today && timeOut > now) throw new Error("The clock-out cannot be later than the current time.");
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const timeIn = toMinutes(record.timeIn), out = toMinutes(timeOut);
  if (out <= timeIn) throw new Error(`The clock-out must be after the time in (${record.timeIn}).`);
  if (record.timeOut === timeOut) throw new Error("The clock-out is already that time.");
  const note = `Clock-out ${record.timeOut ? `changed from ${record.timeOut}` : "set"} to ${timeOut} by ${by} on ${today}: ${reason}`;
  const updated = {
    ...record, timeOut, ...clockOutFigures(record.timeIn, timeOut, record.scheduledTimeOut || SCHEDULED_TIME_OUT),
    notes: [record.notes, note].filter(Boolean).join(" | "), updatedAt: new Date().toISOString(),
  };
  await updateAttendanceRecord(rowNumber, updated);
  return { success: true, message: `Clock-out for ${employeeId} set to ${timeOut}. Worked ${updated.workedHours} hours.`, record: updated };
}
