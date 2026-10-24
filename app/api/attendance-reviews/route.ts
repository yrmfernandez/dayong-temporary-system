import { dayOffEntriesNote } from "@/lib/day-off";
import { withEncoder } from "@/lib/encoder-context";
import { closeFinishedAttendanceDaysQuietly, isSystemAbsence, systemAbsencesWaiting } from "@/lib/auto-absence";
import { NextResponse } from "next/server";
import { getEmployees } from "@/lib/employees";

import {
  addAttendanceRecord,
  getAttendanceForEmployeeDate,
  getAttendanceRecordsForDate,
  getAttendanceRecordsForRange,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import {
  carriedNotRequired,
  getPhilippineDate,
  SCHEDULED_TIME_IN,
  SCHEDULED_TIME_OUT,
} from "@/lib/attendance";
import { closureCovers, employeeAttendanceBranches, getClosures } from "@/lib/attendance-calendar";
import { canManageAttendance } from "@/lib/auth-server";
import { isMarkStatus } from "@/lib/attendance-board";
import { getActiveAttendanceEmployees } from "@/lib/google-sheets-data";
import { getClockInChecks } from "@/lib/clock-in-checks";

function isWorkingDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);

  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    date <= getPhilippineDate() &&
    parsed.getUTCDay() !== 0
  );
}

function getRequestedDate(request: Request) {
  return new URL(request.url).searchParams.get("date")?.trim() || "";
}

export async function GET(request: Request) {
  try {
    if (!(await canManageAttendance())) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to review attendance.",
        },
        { status: 403 },
      );
    }

    const attendanceDate = getRequestedDate(request);

    if (!isWorkingDate(attendanceDate)) {
      return NextResponse.json(
        {
          success: false,
          message: "Choose a valid Monday to Saturday date.",
        },
        { status: 400 },
      );
    }

    await closeFinishedAttendanceDaysQuietly();
    const weekBefore = new Date(Date.parse(`${attendanceDate}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const [employees, records, closures, branches, register, waiting, earlier] = await Promise.all([
      getActiveAttendanceEmployees(),
      getAttendanceRecordsForDate(attendanceDate),
      getClosures(attendanceDate, attendanceDate),
      employeeAttendanceBranches(),
      getEmployees(),
      // Days of the last week with system absences still unmarked (the sidebar number), to jump to.
      systemAbsencesWaiting(),
      // The week before, to show whose No attendance needed carries over to this date (lib/attendance.ts).
      getAttendanceRecordsForRange(weekBefore, attendanceDate),
    ]);
    const carried = carriedNotRequired(earlier, attendanceDate);
    // Operational roles, for the review's role filter.
    const rolesOf = new Map(register.map((employee) => [employee.id, employee.roles]));
    const closure = closures[0] ?? null;
    const recordsByEmployee = new Map(
      records.map((record) => [record.employeeId, record]),
    );
    // Where each clock-in was made, against the branch's saved location (lib/clock-in-checks.ts).
    const checks = await getClockInChecks(records.filter((record) => record.timeIn).map((record) => record.id));

    return NextResponse.json({
      success: true,
      attendanceDate,
      nonWorkingDay: closure,
      waiting,
      employees: employees.map((employee) => {
        const branch = branches.get(employee.employeeId) ?? "";
        return {
          ...employee,
          branch,
          roles: rolesOf.get(employee.employeeId) ?? [],
          closed: Boolean(closure && closureCovers(closure, branch)),
          // Recorded Absent by the system at the end of the day because nobody marked the employee.
          systemAbsent: isSystemAbsence(recordsByEmployee.get(employee.employeeId)),
          carriesNotRequired: recordsByEmployee.has(employee.employeeId) ? null : carried.get(employee.employeeId) ?? null,
          record: recordsByEmployee.get(employee.employeeId) ?? null,
          locationCheck: checks.get(recordsByEmployee.get(employee.employeeId)?.id ?? "") ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Load attendance review error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to load attendance review.",
      },
      { status: 500 },
    );
  }
}

export const POST = withEncoder(async function POST(request: Request) {
  try {
    if (!(await canManageAttendance())) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to review attendance.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const employeeId =
      typeof body.employeeId === "string"
        ? body.employeeId.trim()
        : "";
    const attendanceDate =
      typeof body.attendanceDate === "string"
        ? body.attendanceDate.trim()
        : "";
    // Day Off: an administrator gives the employee the day off; Not Required: the employee need not clock in that day
    // (e.g. MAS in the field). Neither is counted as absent in payroll.
    const status = isMarkStatus(body.status) ? body.status : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim() : "";

    if (!isWorkingDate(attendanceDate) || !employeeId || !status) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Employee, a Monday to Saturday date, and a valid status are required.",
        },
        { status: 400 },
      );
    }

    const employees = await getActiveAttendanceEmployees();

    if (!employees.some((employee) => employee.employeeId === employeeId)) {
      return NextResponse.json(
        {
          success: false,
          message: "Employee was not found or is inactive.",
        },
        { status: 404 },
      );
    }

    const [closure] = await getClosures(attendanceDate, attendanceDate);
    if (closure && closureCovers(closure, (await employeeAttendanceBranches()).get(employeeId) ?? "")) {
      return NextResponse.json(
        {
          success: false,
          message: "This employee's branch is closed on that date (non-working day).",
        },
        { status: 409 },
      );
    }

    const { record, rowNumber } = await getAttendanceForEmployeeDate(
      employeeId,
      attendanceDate,
    );

    if (record?.timeIn || record?.timeOut || record?.status === "Leave") {
      return NextResponse.json(
        {
          success: false,
          message:
            "A clocked attendance or approved leave record cannot be replaced.",
        },
        { status: 409 },
      );
    }

    const timestamp = new Date().toISOString();
    const updatedRecord: AttendanceRecord = {
      id: record?.id || `ATT-${attendanceDate.replaceAll("-", "")}-${employeeId}`,
      employeeId,
      attendanceDate,
      branch: "",
      scheduledTimeIn: SCHEDULED_TIME_IN,
      scheduledTimeOut: SCHEDULED_TIME_OUT,
      timeIn: "",
      timeOut: "",
      workedHours: 0,
      overtimeHours: 0,
      status,
      lateMinutes: 0,
      undertimeMinutes: 0,
      leaveType: "",
      leaveApprovalStatus: "",
      // A Day Off mark says how many entries the employee had already encoded that day (they stay; lib/day-off.ts).
      notes: status === "Day Off" ? `${notes}${await dayOffEntriesNote(employeeId, attendanceDate)}`.trim() : notes,
      createdAt: record?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    if (rowNumber) {
      await updateAttendanceRecord(rowNumber, updatedRecord);
    } else {
      await addAttendanceRecord(updatedRecord);
    }

    return NextResponse.json({
      success: true,
      message: `Attendance marked as ${status === "Not Required" ? "No attendance needed" : status}.`,
      record: updatedRecord,
    });
  } catch (error) {
    console.error("Update attendance review error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to update attendance.",
      },
      { status: 500 },
    );
  }
});
