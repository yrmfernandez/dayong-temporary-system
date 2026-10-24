import { getSessionUser } from "@/lib/auth-server";
import { getPhilippineDate } from "@/lib/attendance";
import { canAdjustLateness } from "@/lib/attendance-board";
import { getAttendanceForEmployeeDate, updateAttendanceRecord } from "@/lib/attendance-data";
import { getClockInCheck, saveClockInReview } from "@/lib/clock-in-checks";
import { clockInLabel, needsReview } from "@/lib/clock-in-location";
import { withEncoder } from "@/lib/encoder-context";

/**
 * HR's decision on a clock-in flagged by the location check: { employeeId, attendanceDate, decision, note }.
 * Accepted keeps the day Present (and puts it back to Present if it was marked Absent here); Absent changes the
 * attendance record to Absent, keeping the clock times, so payroll counts the absence. Who decided and why are kept
 * on the check and in the attendance notes. A reason is required for Absent.
 */
export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAdjustLateness(user)) return Response.json({ success: false, message: "Only HR and administrators review clock-in locations." }, { status: 403 });
  try {
    const body = await request.json();
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    const attendanceDate = typeof body.attendanceDate === "string" ? body.attendanceDate.trim() : "";
    const decision = body.decision === "Absent" ? "Absent" : body.decision === "Accepted" ? "Accepted" : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
    if (!employeeId || !attendanceDate || !decision) throw new Error("Choose the clock-in and Accept or Absent.");
    if (decision === "Absent" && note.length < 3) throw new Error("Give the reason for marking the day Absent.");

    const { record, rowNumber } = await getAttendanceForEmployeeDate(employeeId, attendanceDate);
    if (!record || !rowNumber || !record.timeIn) throw new Error("This employee has no clock-in on that day.");
    const check = await getClockInCheck(record.id);
    if (!check || !needsReview(check.result)) throw new Error("This clock-in was not flagged by the location check.");
    if (record.status !== "Present" && record.status !== "Absent") throw new Error(`The day is ${record.status}; change it in Attendance Review first.`);
    if (record.status === "Absent" && check.reviewStatus !== "Absent") throw new Error("The day was marked Absent another way; it cannot be changed here.");

    const today = getPhilippineDate();
    const line = decision === "Absent"
      ? `${clockInLabel(check)}: marked Absent by ${user.name} on ${today}: ${note}`
      : `${clockInLabel(check)}: clock-in accepted by ${user.name} on ${today}${note ? `: ${note}` : ""}`;
    const status = decision === "Absent" ? "Absent" : "Present";
    if (status !== record.status || decision !== check.reviewStatus) {
      await updateAttendanceRecord(rowNumber, { ...record, status, notes: [record.notes, line].filter(Boolean).join(" | "), updatedAt: new Date().toISOString() });
    }
    await saveClockInReview(record.id, decision, note, user.name);
    return Response.json({ success: true, message: decision === "Absent" ? "Marked Absent. Payroll counts the day as an absence." : "Clock-in accepted. The day stays Present." });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the review." }, { status: 400 });
  }
});
