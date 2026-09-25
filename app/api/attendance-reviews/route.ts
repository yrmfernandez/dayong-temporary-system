import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import {
  addAttendanceRecord,
  getAttendanceForEmployeeDate,
  getAttendanceRecordsForDate,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import {
  getPhilippineDate,
  SCHEDULED_TIME_IN,
  SCHEDULED_TIME_OUT,
} from "@/lib/attendance";
import { canManageAttendance } from "@/lib/auth-server";
import { getActiveAttendanceEmployees } from "@/lib/google-sheets-data";

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

    const [employees, records] = await Promise.all([
      getActiveAttendanceEmployees(),
      getAttendanceRecordsForDate(attendanceDate),
    ]);
    const recordsByEmployee = new Map(
      records.map((record) => [record.employeeId, record]),
    );

    return NextResponse.json({
      success: true,
      attendanceDate,
      employees: employees.map((employee) => ({
        ...employee,
        record: recordsByEmployee.get(employee.employeeId) ?? null,
      })),
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
    const status =
      body.status === "AWOL"
        ? "AWOL"
        : body.status === "Absent"
          ? "Absent"
          : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim() : "";

    if (!employeeId || !isWorkingDate(attendanceDate) || !status) {
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
      notes,
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
      message: `Attendance marked as ${status}.`,
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
