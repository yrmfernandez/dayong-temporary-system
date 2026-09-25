import { appendEncodedRows, updateEncodedRow } from "@/lib/encoder-sheets";
import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

import type {
  AttendanceStatus,
} from "@/lib/attendance";
import {
  SCHEDULED_TIME_IN,
  SCHEDULED_TIME_OUT,
} from "@/lib/attendance";

const ATTENDANCE_SHEET = "Attendance";

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  attendanceDate: string;
  branch: string;
  scheduledTimeIn: string;
  scheduledTimeOut: string;
  timeIn: string;
  timeOut: string;
  workedHours: number;
  overtimeHours: number;
  status: AttendanceStatus;
  lateMinutes: number;
  undertimeMinutes: number;
  leaveType: string;
  leaveApprovalStatus: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export async function getAttendanceForEmployeeDate(
  employeeId: string,
  attendanceDate: string,
): Promise<{
  record: AttendanceRecord | null;
  rowNumber: number | null;
}> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ATTENDANCE_SHEET}!A:R`,
    });

  const rows = response.data.values ?? [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];

    if (
      String(row[1] ?? "").trim() === employeeId &&
      String(row[2] ?? "").trim() === attendanceDate
    ) {
      return {
        rowNumber: index + 1,
        record: {
          id: String(row[0] ?? "").trim(),
          employeeId: String(row[1] ?? "").trim(),
          attendanceDate: String(row[2] ?? "").trim(),
          branch: String(row[3] ?? "").trim(),
          scheduledTimeIn: String(row[4] ?? "").trim(),
          scheduledTimeOut: String(row[5] ?? "").trim(),
          timeIn: String(row[6] ?? "").trim(),
          timeOut: String(row[7] ?? "").trim(),
          workedHours: Number(row[8] ?? 0) || 0,
          overtimeHours: Number(row[9] ?? 0) || 0,
          status:
            String(row[10] ?? "").trim() === "Leave"
              ? "Leave"
              : String(row[10] ?? "").trim() === "Absent"
                ? "Absent"
                : String(row[10] ?? "").trim() === "AWOL"
                  ? "AWOL"
                  : "Present",
          lateMinutes: Number(row[11] ?? 0) || 0,
          undertimeMinutes: Number(row[12] ?? 0) || 0,
          leaveType: String(row[13] ?? "").trim(),
          leaveApprovalStatus: String(row[14] ?? "").trim(),
          notes: String(row[15] ?? "").trim(),
          createdAt: String(row[16] ?? "").trim(),
          updatedAt: String(row[17] ?? "").trim(),
        },
      };
    }
  }

  return {
    record: null,
    rowNumber: null,
  };
}

export async function addAttendanceRecord(
  record: AttendanceRecord,
) {
  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${ATTENDANCE_SHEET}!A:R`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        record.id,
        record.employeeId,
        record.attendanceDate,
        record.branch,
        record.scheduledTimeIn,
        record.scheduledTimeOut,
        record.timeIn,
        record.timeOut,
        record.workedHours,
        record.overtimeHours,
        record.status,
        record.lateMinutes,
        record.undertimeMinutes,
        record.leaveType,
        record.leaveApprovalStatus,
        record.notes,
        record.createdAt,
        record.updatedAt,
      ]],
    },
  });
}

export async function updateAttendanceRecord(
  rowNumber: number,
  record: AttendanceRecord,
) {
  await updateEncodedRow({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${ATTENDANCE_SHEET}!A${rowNumber}:R${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        record.id,
        record.employeeId,
        record.attendanceDate,
        record.branch,
        record.scheduledTimeIn,
        record.scheduledTimeOut,
        record.timeIn,
        record.timeOut,
        record.workedHours,
        record.overtimeHours,
        record.status,
        record.lateMinutes,
        record.undertimeMinutes,
        record.leaveType,
        record.leaveApprovalStatus,
        record.notes,
        record.createdAt,
        record.updatedAt,
      ]],
    },
  });
}

export async function getAttendanceRecordsForDate(
  attendanceDate: string,
): Promise<AttendanceRecord[]> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ATTENDANCE_SHEET}!A:R`,
    });

  return (response.data.values ?? [])
    .slice(1)
    .filter(
      (row) =>
        String(row[2] ?? "").trim() === attendanceDate,
    )
    .map((row) => ({
      id: String(row[0] ?? "").trim(),
      employeeId: String(row[1] ?? "").trim(),
      attendanceDate: String(row[2] ?? "").trim(),
      branch: String(row[3] ?? "").trim(),
      scheduledTimeIn: String(row[4] ?? "").trim(),
      scheduledTimeOut: String(row[5] ?? "").trim(),
      timeIn: String(row[6] ?? "").trim(),
      timeOut: String(row[7] ?? "").trim(),
      workedHours: Number(row[8] ?? 0) || 0,
      overtimeHours: Number(row[9] ?? 0) || 0,
      status:
        String(row[10] ?? "").trim() === "Leave"
          ? "Leave"
          : String(row[10] ?? "").trim() === "Absent"
            ? "Absent"
            : String(row[10] ?? "").trim() === "AWOL"
              ? "AWOL"
              : "Present",
      lateMinutes: Number(row[11] ?? 0) || 0,
      undertimeMinutes: Number(row[12] ?? 0) || 0,
      leaveType: String(row[13] ?? "").trim(),
      leaveApprovalStatus: String(row[14] ?? "").trim(),
      notes: String(row[15] ?? "").trim(),
      createdAt: String(row[16] ?? "").trim(),
      updatedAt: String(row[17] ?? "").trim(),
    }));
}

function getWorkingDatesInRange(
  startDate: string,
  endDate: string,
) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    throw new Error("The leave date range is invalid.");
  }

  const dates: string[] = [];
  const current = new Date(start);

  while (current <= end) {
    if (current.getUTCDay() !== 0) {
      dates.push(current.toISOString().slice(0, 10));
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export async function recordApprovedLeaveAttendance({
  employeeId,
  leaveType,
  startDate,
  endDate,
  reason,
}: {
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}) {
  const timestamp = new Date().toISOString();

  for (const attendanceDate of getWorkingDatesInRange(
    startDate,
    endDate,
  )) {
    const { record, rowNumber } =
      await getAttendanceForEmployeeDate(
        employeeId,
        attendanceDate,
      );

    // Never replace a day where the employee has already clocked in or out.
    if (record?.timeIn || record?.timeOut) {
      continue;
    }

    const leaveRecord: AttendanceRecord = {
      id:
        record?.id ||
        `ATT-${employeeId}-${attendanceDate}`,
      employeeId,
      attendanceDate,
      branch: record?.branch || "",
      scheduledTimeIn: SCHEDULED_TIME_IN,
      scheduledTimeOut: SCHEDULED_TIME_OUT,
      timeIn: "",
      timeOut: "",
      workedHours: 0,
      overtimeHours: 0,
      status: "Leave",
      lateMinutes: 0,
      undertimeMinutes: 0,
      leaveType,
      leaveApprovalStatus: "Approved",
      notes: reason,
      createdAt: record?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    if (rowNumber) {
      await updateAttendanceRecord(rowNumber, leaveRecord);
    } else {
      await addAttendanceRecord(leaveRecord);
    }
  }
}
