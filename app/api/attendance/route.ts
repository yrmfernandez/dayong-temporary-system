import { withEncoder } from "@/lib/encoder-context";
import { closeFinishedAttendanceDaysQuietly } from "@/lib/auto-absence";
import { NextResponse } from "next/server";

import {
  addAttendanceRecord,
  getAttendanceForEmployeeDate,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import { closureForBranch } from "@/lib/attendance-calendar";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";

// Attendance uses the branch on the employee's record (primary branch, else the first assignment); nobody picks one.
// All assigned branches are returned too, primary first, so the page can show them.
async function employeeBranches(employeeId: string) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return { primary: "", all: [] as string[] };
  const assigned = employee.branchIds.map((id) => branches.find((branch) => branch.id === id)?.name).filter((name): name is string => Boolean(name));
  const primary = employee.branch || assigned[0] || "";
  return { primary, all: primary ? [primary, ...assigned.filter((name) => name !== primary)] : assigned };
}

async function assignedBranch(employeeId: string) {
  return (await employeeBranches(employeeId)).primary;
}
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
    // The first visit after midnight records the system absences for the day that just ended.
    await closeFinishedAttendanceDaysQuietly();

    const [{ record }, branches] = await Promise.all([
      getAttendanceForEmployeeDate(user.employeeId, attendanceDate),
      employeeBranches(user.employeeId),
    ]);
    // Closed when today is declared non-working for every branch or for the employee's branch.
    const nonWorkingDay = await closureForBranch(attendanceDate, branches.primary);

    return NextResponse.json({
      success: true,
      attendanceDate,
      record,
      assignedBranch: branches.primary,
      assignedBranches: branches.all,
      nonWorkingDay,
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

export const POST = withEncoder(async function POST(request: Request) {
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


    const attendanceDate = getPhilippineDate();
    const nonWorkingDay = await closureForBranch(attendanceDate, await assignedBranch(user.employeeId));
    if (nonWorkingDay) return NextResponse.json({ success: false, message: `Attendance is closed today: ${nonWorkingDay.reason}` }, { status: 400 });
    const currentTime = getPhilippineTime();
    const timestamp = new Date().toISOString();

    const { record, rowNumber } =
      await getAttendanceForEmployeeDate(
        user.employeeId,
        attendanceDate,
      );

    if (action === "time-in") {
      const branch = await assignedBranch(user.employeeId);
      if (!branch) {
        return NextResponse.json(
          {
            success: false,
            message:
              "No branch is assigned to you yet. Ask HR or an administrator to assign one in Employees.",
          },
          { status: 400 },
        );
      }

      if (record?.status === "Day Off") {
        return NextResponse.json({ success: false, message: "You have the day off today; an administrator marked it in Attendance Review." }, { status: 409 });
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
});
