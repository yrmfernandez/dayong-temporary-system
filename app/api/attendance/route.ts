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
import { recordClockInCheck, readDevicePosition } from "@/lib/clock-in-checks";
import { clockInLabel, hasLocation } from "@/lib/clock-in-location";

// Attendance uses the branch on the employee's record (primary branch, else the first assignment); nobody picks one.
// All assigned branches are returned too, primary first, so the page can show them.
async function employeeBranches(employeeId: string) {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return { primary: "", all: [] as string[], locationSet: false };
  const assigned = employee.branchIds.map((id) => branches.find((branch) => branch.id === id)?.name).filter((name): name is string => Boolean(name));
  const primary = employee.branch || assigned[0] || "";
  // The clock-in page asks the phone for its location only when the branch's location is saved.
  const primaryBranch = branches.find((branch) => branch.name.trim().toLowerCase() === primary.trim().toLowerCase());
  return { primary, all: primary ? [primary, ...assigned.filter((name) => name !== primary)] : assigned, locationSet: Boolean(primaryBranch && hasLocation({ latitude: primaryBranch.latitude, longitude: primaryBranch.longitude, radiusM: primaryBranch.locationRadiusM })) };
}

async function assignedBranch(employeeId: string) {
  return (await employeeBranches(employeeId)).primary;
}
import {
  clockOutFigures,
  getPhilippineDate,
  getPhilippineTime,
  isWorkingDay,
  lateMinutesFor,
  SCHEDULED_TIME_IN,
  SCHEDULED_TIME_OUT,
} from "@/lib/attendance";
import { getSessionUser } from "@/lib/auth-server";

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
      branchLocationSet: branches.locationSet,
      nonWorkingDay,
      // The page's clock and shift progress follow the server's time, not the device's (a slow phone clock kept
      // the progress short of 100% at 5 PM).
      serverTime: Date.now(),
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

      // Marked "no attendance needed" by management: clocking in anyway replaces the mark with a normal clock-in.
      const replacesMark = record?.status === "Not Required" && !record.timeIn;
      if (record && !replacesMark) {
        return NextResponse.json(
          {
            success: false,
            message:
              "You have already clocked in today.",
          },
          { status: 409 },
        );
      }

      // 20-minute grace period; the lunch break is not counted as late (lib/attendance.ts).
      const lateMinutes = lateMinutesFor(currentTime);

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
        createdAt: record?.createdAt || timestamp,
        updatedAt: timestamp,
      };

      if (replacesMark && rowNumber) await updateAttendanceRecord(rowNumber, newRecord);
      else await addAttendanceRecord(newRecord);

      // Where the clock-in was made, against the branch's saved location. The clock-in stands even if this fails.
      const check = await recordClockInCheck({ attendanceId: newRecord.id, employeeId: user.employeeId, attendanceDate, branchName: branch, position: readDevicePosition(body.location) })
        .catch((error) => { console.error("Clock-in location check error:", error); return null; });
      const flagged = check?.result === "Outside" || check?.result === "No location";

      return NextResponse.json(
        {
          success: true,
          message: flagged ? `Clocked in. ${clockInLabel(check)}: HR will review this clock-in.` : "Clocked in successfully.",
          record: newRecord,
          locationCheck: check,
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

    // The 12:00–13:00 lunch break is not counted as worked or undertime.
    const updatedRecord: AttendanceRecord = {
      ...record,
      timeOut: currentTime,
      ...clockOutFigures(record.timeIn, currentTime, record.scheduledTimeOut || SCHEDULED_TIME_OUT),
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
