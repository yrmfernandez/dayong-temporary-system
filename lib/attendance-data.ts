import { and, asc, between, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
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

/**
 * Google Sheets turns "2026-09-29" and "13:45" typed into a cell into a date serial (46294) and a day fraction
 * (0.5729...). Reads normalize both forms, plus day-first text such as "29/09/2026", back to YYYY-MM-DD and HH:MM,
 * so lookups by date keep working for old and new rows.
 */
export function sheetDateText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(text)) return sheetDateText(Number(text));
  return text.slice(0, 10);
}

export function sheetTimeText(value: unknown) {
  const numeric = typeof value === "number" ? value : /^\d*\.\d+$|^0$/.test(String(value ?? "").trim()) ? Number(value) : NaN;
  if (Number.isFinite(numeric)) {
    const minutes = Math.round((numeric % 1) * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

const statusOf = (value: unknown): AttendanceStatus => {
  const status = String(value ?? "").trim();
  return status === "Leave" || status === "Absent" || status === "AWOL" || status === "Non-working Day" || status === "Day Off" ? status : "Present";
};

function readAttendanceRow(row: unknown[]): AttendanceRecord {
  return {
    id: String(row[0] ?? "").trim(),
    employeeId: String(row[1] ?? "").trim(),
    attendanceDate: sheetDateText(row[2]),
    branch: String(row[3] ?? "").trim(),
    scheduledTimeIn: sheetTimeText(row[4]),
    scheduledTimeOut: sheetTimeText(row[5]),
    timeIn: sheetTimeText(row[6]),
    timeOut: sheetTimeText(row[7]),
    workedHours: Number(row[8] ?? 0) || 0,
    overtimeHours: Number(row[9] ?? 0) || 0,
    status: statusOf(row[10]),
    lateMinutes: Number(row[11] ?? 0) || 0,
    undertimeMinutes: Number(row[12] ?? 0) || 0,
    leaveType: String(row[13] ?? "").trim(),
    leaveApprovalStatus: String(row[14] ?? "").trim(),
    notes: String(row[15] ?? "").trim(),
    createdAt: String(row[16] ?? "").trim(),
    updatedAt: String(row[17] ?? "").trim(),
  };
}

async function attendanceRows() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${ATTENDANCE_SHEET}!A:R`, valueRenderOption: "UNFORMATTED_VALUE" });
  return response.data.values ?? [];
}

// A leading apostrophe makes Sheets keep dates and times as the exact text written.
const asText = (value: string) => (value ? `'${value}` : "");

function attendanceValues(record: AttendanceRecord) {
  return [
    record.id, record.employeeId, asText(record.attendanceDate), record.branch,
    asText(record.scheduledTimeIn), asText(record.scheduledTimeOut), asText(record.timeIn), asText(record.timeOut),
    record.workedHours, record.overtimeHours, record.status, record.lateMinutes, record.undertimeMinutes,
    record.leaveType, record.leaveApprovalStatus, record.notes, record.createdAt, record.updatedAt,
  ];
}

export async function getAttendanceForEmployeeDate(
  employeeId: string,
  attendanceDate: string,
): Promise<{
  record: AttendanceRecord | null;
  rowNumber: number | null;
}> {
  const rows = await attendanceRows();
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (String(row[1] ?? "").trim() === employeeId && sheetDateText(row[2]) === attendanceDate) {
      return { rowNumber: index + 1, record: readAttendanceRow(row) };
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
      values: [attendanceValues(record)],
    },
  });
}

/** Appends several records in one request (the system's end-of-day absences). */
export async function addAttendanceRecords(records: AttendanceRecord[]) {
  if (!records.length) return;
  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${ATTENDANCE_SHEET}!A:R`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: records.map(attendanceValues) },
  });
}

/** Every record dated within the range, SYSTEM rows included. */
export async function getAllAttendanceForRange(dateFrom: string, dateTo: string) {
  return (await attendanceRows()).slice(1).map(readAttendanceRow).filter((record) => record.attendanceDate >= dateFrom && record.attendanceDate <= dateTo);
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
      values: [attendanceValues(record)],
    },
  });
}

export async function getAttendanceRecordsForDate(
  attendanceDate: string,
): Promise<AttendanceRecord[]> {
  return (await attendanceRows()).slice(1).map(readAttendanceRow).filter((record) => record.attendanceDate === attendanceDate);
}

/** The administrator's non-working day declarations (SYSTEM control rows) dated within the range, oldest first. */
export async function getNonWorkingDayRecords(dateFrom: string, dateTo: string): Promise<AttendanceRecord[]> {
  return (await attendanceRows()).slice(1).map(readAttendanceRow)
    .filter((record) => record.employeeId === "SYSTEM" && record.status === "Non-working Day" && record.attendanceDate >= dateFrom && record.attendanceDate <= dateTo)
    .sort((first, second) => first.attendanceDate.localeCompare(second.attendanceDate));
}

/**
 * Cancels every clock-in already recorded on a day the administrator declares non-working: the record becomes a
 * Non-working Day with no hours, and the original times are kept in its notes. `branches` limits it to clock-ins
 * recorded at those branch names; null covers every branch. Returns how many were cancelled.
 */
export async function cancelClockInsForNonWorkingDay(attendanceDate: string, reason: string, by: string, branches: Set<string> | null = null) {
  const rows = await attendanceRows();
  const timestamp = new Date().toISOString();
  let cancelled = 0;
  for (let index = 1; index < rows.length; index++) {
    const record = readAttendanceRow(rows[index]);
    if (record.employeeId === "SYSTEM" || record.attendanceDate !== attendanceDate || record.status !== "Present" || !record.timeIn) continue;
    if (branches && !branches.has(record.branch)) continue;
    const note = `Clock-in ${record.timeIn}${record.timeOut ? `-${record.timeOut}` : ""} cancelled by ${by}: non-working day (${reason})`;
    await updateAttendanceRecord(index + 1, {
      ...record, timeIn: "", timeOut: "", workedHours: 0, overtimeHours: 0, status: "Non-working Day", lateMinutes: 0, undertimeMinutes: 0,
      notes: [record.notes, note].filter(Boolean).join(" | "), updatedAt: timestamp,
    });
    cancelled++;
  }
  return cancelled;
}

export async function getAttendanceRecordsForRange(
  dateFrom: string,
  dateTo: string,
): Promise<AttendanceRecord[]> {
  // One record per employee per day: if two servers ever closed the same day at once, a repeated system absence must
  // not be counted twice. A record anyone else wrote wins over a system absence.
  const byDay = new Map<string, AttendanceRecord>();
  for (const record of (await attendanceRows()).slice(1).map(readAttendanceRow)) {
    if (!record.employeeId || record.employeeId === "SYSTEM" || record.attendanceDate < dateFrom || record.attendanceDate > dateTo) continue;
    const key = `${record.employeeId}|${record.attendanceDate}`, kept = byDay.get(key);
    if (!kept || (kept.notes.startsWith("Absent by system") && !record.notes.startsWith("Absent by system"))) byDay.set(key, record);
  }
  return [...byDay.values()].sort((first, second) => second.attendanceDate.localeCompare(first.attendanceDate));
}

/**
 * One employee's records in a date range, read straight from the database with the employee/date index (a year is
 * one small query, not a read of the whole Attendance table). Same one-record-per-day rule as getAttendanceRecordsForRange.
 */
export async function getEmployeeAttendance(employeeId: string, dateFrom: string, dateTo: string): Promise<AttendanceRecord[]> {
  const a = schema.attendance;
  const rows = await getDb().select().from(a).where(and(eq(a.employee_id, employeeId), between(a.attendance_date, dateFrom, dateTo))).orderBy(asc(a.row_seq));
  const byDay = new Map<string, AttendanceRecord>();
  for (const row of rows) {
    const record = readAttendanceRow([row.attendance_id, row.employee_id, row.attendance_date, row.branch, row.scheduled_time_in, row.scheduled_time_out, row.time_in, row.time_out,
      row.worked_hours, row.overtime_hours, row.attendance_status, row.late_minutes, row.undertime_minutes, row.leave_type, row.leave_approval_status, row.notes, row.created_at, row.updated_at]);
    const kept = byDay.get(record.attendanceDate);
    if (!kept || (kept.notes.startsWith("Absent by system") && !record.notes.startsWith("Absent by system"))) byDay.set(record.attendanceDate, record);
  }
  return [...byDay.values()];
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
