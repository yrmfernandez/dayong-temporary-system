import { NextResponse } from "next/server";

import {
  addAttendanceRecord,
  getAttendanceForEmployeeDate,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import {
  getPhilippineDate,
  getPhilippineTime,
  isWorkingDay,
  SCHEDULED_TIME_IN,
  SCHEDULED_TIME_OUT,
} from "@/lib/attendance";
import { getSessionUser } from "@/lib/auth-server";

function timeToMinutes(time: string) {
  const [hours, minutes] = time
    .split(":")
    .map(Number);

  return hours * 60 + minutes;
}

function roundHours(minutes: number) {
  return Number((minutes / 60).toFixed(2));
}

export async function GET() {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Not signed in.",
        },
        { status: 401 },
      );
    }

    const attendanceDate = getPhilippineDate();

    const { record } =
      await getAttendanceForEmployeeDate(
        user.employeeId,
        attendanceDate,
      );

    return NextResponse.json({
      success: true,
      attendanceDate,
      record,
    });
  } catch (error) {
    console.error("Load attendance error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to load attendance.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Not signed in.",
        },
        { status: 401 },
      );
    }

    if (!isWorkingDay()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Attendance clocking is not available on Sundays.",
        },
        { status: 400 },
      );
    }

    const body = await request.json();

    const action =
      body.action === "time-out"
        ? "time-out"
        : "time-in";

    const branch =
      typeof body.branch === "string"
        ? body.branch.trim()
        : "";

    const attendanceDate = getPhilippineDate();
    const currentTime = getPhilippineTime();
    const timestamp = new Date().toISOString();

    const { record, rowNumber } =
      await getAttendanceForEmployeeDate(
        user.employeeId,
        attendanceDate,
      );

    if (action === "time-in") {
      if (!branch) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Select your branch before clocking in.",
          },
          { status: 400 },
        );
      }

      if (record) {
        return NextResponse.json(
          {
            success: false,
            message:
              "You have already clocked in today.",
          },
          { status: 409 },
        );
      }

      const lateMinutes = Math.max(
        0,
        timeToMinutes(currentTime) -
          timeToMinutes(SCHEDULED_TIME_IN),
      );

      const newRecord: AttendanceRecord = {
        id: `ATT-${attendanceDate.replaceAll(
          "-",
          "",
        )}-${user.employeeId}`,
        employeeId: user.employeeId,
        attendanceDate,
        branch,
        scheduledTimeIn: SCHEDULED_TIME_IN,
        scheduledTimeOut: SCHEDULED_TIME_OUT,
        timeIn: currentTime,
        timeOut: "",
        workedHours: 0,
        overtimeHours: 0,
        status: "Present",
        lateMinutes,
        undertimeMinutes: 0,
        leaveType: "",
        leaveApprovalStatus: "",
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await addAttendanceRecord(newRecord);

      return NextResponse.json(
        {
          success: true,
          message: "Clocked in successfully.",
          record: newRecord,
        },
        { status: 201 },
      );
    }

    if (!record || !rowNumber) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You must clock in before clocking out.",
        },
        { status: 400 },
      );
    }

    if (record.timeOut) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You have already clocked out today.",
        },
        { status: 409 },
      );
    }

    const timeInMinutes = timeToMinutes(record.timeIn);
    const timeOutMinutes = timeToMinutes(currentTime);
    const scheduledTimeOutMinutes =
      timeToMinutes(SCHEDULED_TIME_OUT);

    const updatedRecord: AttendanceRecord = {
      ...record,
      timeOut: currentTime,
      workedHours: roundHours(
        Math.max(0, timeOutMinutes - timeInMinutes),
      ),
      overtimeHours: roundHours(
        Math.max(
          0,
          timeOutMinutes - scheduledTimeOutMinutes,
        ),
      ),
      undertimeMinutes: Math.max(
        0,
        scheduledTimeOutMinutes - timeOutMinutes,
      ),
      updatedAt: timestamp,
    };

    await updateAttendanceRecord(
      rowNumber,
      updatedRecord,
    );

    return NextResponse.json({
      success: true,
      message: "Clocked out successfully.",
      record: updatedRecord,
    });
  } catch (error) {
    console.error("Attendance clocking error:", error);

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
}