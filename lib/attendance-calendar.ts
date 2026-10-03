import {
  addAttendanceRecord,
  cancelClockInsForNonWorkingDay,
  getAttendanceForEmployeeDate,
  getNonWorkingDayRecords,
  sheetDateText,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { encoderHeaders } from "@/lib/encoder-schema";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getBranches } from "@/lib/google-sheets-data";
import { HOLIDAY_TYPES, philippineHolidays, type HolidayType } from "@/lib/philippine-holidays";
import { createReadableId } from "@/lib/readable-id";
import { deleteRowsById } from "@/lib/sheet-rows";

const SHEET = "Holidays";
const RANGE = `'${SHEET}'!A:E`;
const text = (value: unknown) => String(value ?? "").trim();

/** The Attendance branch value of a closure that covers every branch; otherwise it holds branch IDs joined by ", ". */
export const ALL_BRANCHES = "All branches";

// Holidays!A:E business columns: holiday_id, holiday_date, name, holiday_type, notes. F:I encoder identity.
// A holiday is information only; attendance closes only when an administrator declares a non-working day.
export type Holiday = { id: string; date: string; name: string; type: HolidayType; notes: string };

export type Closure = {
  date: string; reason: string; allBranches: boolean; branchIds: string[]; branchNames: string[]; updatedAt: string;
};

export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

async function sheetExists() {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  return Boolean(metadata.data.sheets?.some((sheet) => sheet.properties?.title === SHEET));
}

async function ensureSheet() {
  if (await sheetExists()) return;
  getEncoder();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: SHEET, gridProperties: { frozenRowCount: 1 } } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A1:I1`, valueInputOption: "RAW", requestBody: { values: [["holiday_id", "holiday_date", "name", "holiday_type", "notes", ...encoderHeaders.map((header) => header.toLowerCase().replace(/ /g, "_"))]] } });
}

async function holidayRows() {
  if (!(await sheetExists())) return [];
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE, valueRenderOption: "UNFORMATTED_VALUE" })).data.values ?? [];
}

const holidayType = (value: unknown): HolidayType => HOLIDAY_TYPES.find((type) => type === text(value)) ?? "Special non-working day";
const readHoliday = (row: unknown[]): Holiday => ({ id: text(row[0]), date: sheetDateText(row[1]), name: text(row[2]), type: holidayType(row[3]), notes: text(row[4]) });

/** Holidays dated within the range, oldest first. A missing sheet means none have been added yet. */
export async function getHolidays(dateFrom: string, dateTo: string) {
  return (await holidayRows()).slice(1).map(readHoliday)
    .filter((holiday) => holiday.id && holiday.date >= dateFrom && holiday.date <= dateTo)
    .sort((first, second) => first.date.localeCompare(second.date) || first.name.localeCompare(second.name));
}

function readHolidayInput(input: Record<string, unknown>) {
  const date = text(input.date), name = text(input.name).slice(0, 120), notes = text(input.notes).slice(0, 300);
  const type = HOLIDAY_TYPES.find((option) => option === text(input.type));
  if (!validDate(date)) throw new Error("Choose a valid holiday date.");
  if (name.length < 2) throw new Error("Enter the holiday name.");
  if (!type) throw new Error("Choose the holiday type.");
  return { date, name, type, notes };
}

// A leading apostrophe keeps the date as the exact text written, as in Attendance.
const holidayValues = (holiday: Omit<Holiday, "id"> & { id: string }) => [holiday.id, `'${holiday.date}`, holiday.name, holiday.type, holiday.notes];

/** Adds a holiday, or edits the one with `input.id`. */
export async function saveHoliday(input: Record<string, unknown>) {
  const holiday = readHolidayInput(input);
  const id = text(input.id);
  await ensureSheet();
  if (!id) {
    const created = { id: createReadableId("HOL"), ...holiday };
    await appendEncodedRows({ range: RANGE, requestBody: { values: [holidayValues(created)] } });
    return created;
  }
  const rows = await holidayRows();
  const index = rows.findIndex((row, position) => position > 0 && text(row[0]) === id);
  if (index < 0) throw new Error("That holiday no longer exists. Reload the calendar.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEET}'!A${index + 1}:E${index + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [holidayValues({ id, ...holiday })] } });
  return { id, ...holiday };
}

export async function deleteHoliday(id: string) {
  if (!id || !(await deleteRowsById(SHEET, [id]))) throw new Error("That holiday no longer exists. Reload the calendar.");
}

/** Adds the usual Philippine holidays for a year, skipping any date that already has a holiday of the same name. */
export async function addPhilippineHolidays(year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Choose a valid year.");
  await ensureSheet();
  const existing = new Set((await getHolidays(`${year}-01-01`, `${year}-12-31`)).map((holiday) => `${holiday.date}|${holiday.name.toLowerCase()}`));
  const missing = philippineHolidays(year).filter((holiday) => !existing.has(`${holiday.date}|${holiday.name.toLowerCase()}`));
  if (missing.length) await appendEncodedRows({ range: RANGE, requestBody: { values: missing.map((holiday) => holidayValues({ id: createReadableId("HOL"), ...holiday })) } });
  return missing.length;
}

function closureBranchIds(record: AttendanceRecord) {
  const value = record.branch.trim();
  return !value || value === ALL_BRANCHES ? null : value.split(",").map((id) => id.trim()).filter(Boolean);
}

/** Non-working days within the range with their branch scope resolved to names. */
export async function getClosures(dateFrom: string, dateTo: string): Promise<Closure[]> {
  const [records, branches] = await Promise.all([getNonWorkingDayRecords(dateFrom, dateTo), getBranches()]);
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  return records.map((record) => {
    const ids = closureBranchIds(record);
    return {
      date: record.attendanceDate, reason: record.notes, allBranches: !ids, branchIds: ids ?? [],
      branchNames: (ids ?? []).map((id) => names.get(id) ?? id), updatedAt: record.updatedAt,
    };
  });
}

export const closureCovers = (closure: Closure, branchName: string) => closure.allBranches || closure.branchNames.includes(branchName);

export const closureLabel = (closure: Closure) => closure.allBranches ? ALL_BRANCHES : closure.branchNames.join(", ");

/** The non-working day that closes attendance for this branch on the date, if any. */
export async function closureForBranch(date: string, branchName: string) {
  return (await getClosures(date, date)).find((closure) => closureCovers(closure, branchName)) ?? null;
}

/** The branch an employee clocks in at: the primary branch, else the first assigned branch. */
export async function employeeAttendanceBranches() {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  return new Map(employees.map((employee) => [employee.id, employee.branch || names.get(employee.branchIds[0] ?? "") || ""]));
}

/**
 * Declares (or updates) a date as non-working for every branch or the chosen branches, then cancels the clock-ins
 * already recorded at those branches. Sundays are always closed, so they cannot be declared.
 */
export async function declareClosure(input: Record<string, unknown>, by: string) {
  const date = text(input.date), reason = text(input.reason).slice(0, 200);
  if (!validDate(date) || isSunday(date)) throw new Error("Choose a valid Monday to Saturday date.");
  if (!reason) throw new Error("Enter the reason for the non-working day.");
  const allBranches = input.allBranches === true;
  const branches = await getBranches();
  const requested = Array.isArray(input.branchIds) ? new Set(input.branchIds.map(text)) : new Set<string>();
  const chosen = branches.filter((branch) => requested.has(branch.id));
  if (!allBranches && !chosen.length) throw new Error("Choose the affected branches, or All branches.");
  const existing = await getAttendanceForEmployeeDate("SYSTEM", date);
  const timestamp = new Date().toISOString();
  const record: AttendanceRecord = {
    id: existing.record?.id || `NWD-${date.replaceAll("-", "")}`, employeeId: "SYSTEM", attendanceDate: date,
    branch: allBranches ? ALL_BRANCHES : chosen.map((branch) => branch.id).join(", "),
    scheduledTimeIn: "", scheduledTimeOut: "", timeIn: "", timeOut: "", workedHours: 0, overtimeHours: 0, status: "Non-working Day",
    lateMinutes: 0, undertimeMinutes: 0, leaveType: "", leaveApprovalStatus: "", notes: reason,
    createdAt: existing.record?.createdAt || timestamp, updatedAt: timestamp,
  };
  if (existing.rowNumber) await updateAttendanceRecord(existing.rowNumber, record); else await addAttendanceRecord(record);
  const cancelled = await cancelClockInsForNonWorkingDay(date, reason, by, allBranches ? null : new Set(chosen.map((branch) => branch.name)));
  return { cancelled, scope: allBranches ? ALL_BRANCHES : chosen.map((branch) => branch.name).join(", ") };
}

/** Reopens a date. Clock-ins cancelled when it was declared stay cancelled; their original times remain in the notes. */
export async function removeClosure(date: string) {
  if (!validDate(date)) throw new Error("Choose a valid date.");
  const { record } = await getAttendanceForEmployeeDate("SYSTEM", date);
  if (!record?.id || record.status !== "Non-working Day") throw new Error("That date is not a declared non-working day.");
  await deleteRowsById("Attendance", [record.id]);
}
