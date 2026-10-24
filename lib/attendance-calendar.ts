import {
  addAttendanceRecord,
  cancelClockInsForNonWorkingDay,
  getAttendanceForEmployeeDate,
  getNonWorkingDayRecords,
  sheetDateText,
  type AttendanceRecord,
  updateAttendanceRecord,
} from "@/lib/attendance-data";
import { and, asc, eq, sql } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { HOLIDAY_TYPES, philippineHolidays, type HolidayType } from "@/lib/philippine-holidays";
import { createReadableId } from "@/lib/readable-id";

const { holidays: holidaysTable } = schema;
const text = (value: unknown) => String(value ?? "").trim();

/** The Attendance branch value of a closure that covers every branch; otherwise it holds branch IDs joined by ", ". */
export const ALL_BRANCHES = "All branches";

// Holidays (table holidays, read and written by ID since October 24, 2026; upgrade #6 phase 4). A holiday is information
// only; attendance closes only when an administrator declares a non-working day.
export type Holiday = { id: string; date: string; name: string; type: HolidayType; notes: string };

export type Closure = {
  date: string; reason: string; allBranches: boolean; branchIds: string[]; branchNames: string[]; updatedAt: string;
};

export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

const holidayType = (value: unknown): HolidayType => HOLIDAY_TYPES.find((type) => type === text(value)) ?? "Special non-working day";
const readHoliday = (row: typeof holidaysTable.$inferSelect): Holiday => ({ id: row.holiday_id, date: sheetDateText(row.holiday_date), name: text(row.name), type: holidayType(row.holiday_type), notes: text(row.notes) });

/** Holidays dated within the range, oldest first. */
export async function getHolidays(dateFrom: string, dateTo: string) {
  const rows = await currentDb().select().from(holidaysTable)
    .where(sql`${holidaysTable.holiday_date} between ${dateFrom}::date and ${dateTo}::date`).orderBy(asc(holidaysTable.holiday_date), asc(holidaysTable.name));
  return rows.map(readHoliday).filter((holiday) => holiday.id);
}

function readHolidayInput(input: Record<string, unknown>) {
  const date = text(input.date), name = text(input.name).slice(0, 120), notes = text(input.notes).slice(0, 300);
  const type = HOLIDAY_TYPES.find((option) => option === text(input.type));
  if (!validDate(date)) throw new Error("Choose a valid holiday date.");
  if (name.length < 2) throw new Error("Enter the holiday name.");
  if (!type) throw new Error("Choose the holiday type.");
  return { date, name, type, notes };
}

/** Adds a holiday, or edits the one with `input.id`. */
export async function saveHoliday(input: Record<string, unknown>) {
  const holiday = readHolidayInput(input);
  const id = text(input.id);
  const values = { holiday_date: holiday.date, name: holiday.name, holiday_type: holiday.type, notes: holiday.notes || null };
  if (!id) {
    const created = { id: createReadableId("HOL"), ...holiday };
    await currentDb().insert(holidaysTable).values({ holiday_id: created.id, ...values, ...encodedBy() });
    return created;
  }
  const updated = await currentDb().update(holidaysTable).set(values).where(eq(holidaysTable.holiday_id, id)).returning({ id: holidaysTable.holiday_id });
  if (!updated.length) throw new Error("That holiday no longer exists. Reload the calendar.");
  return { id, ...holiday };
}

export async function deleteHoliday(id: string) {
  const removed = id ? await currentDb().delete(holidaysTable).where(eq(holidaysTable.holiday_id, text(id))).returning({ id: holidaysTable.holiday_id }) : [];
  if (!removed.length) throw new Error("That holiday no longer exists. Reload the calendar.");
}

/** Adds the usual Philippine holidays for a year, skipping any date that already has a holiday of the same name. */
export async function addPhilippineHolidays(year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Choose a valid year.");
  return inTransaction(async (tx) => {
    // Pressed twice at once, the second waits and then finds them all added.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`holidays:${year}`}))`);
    const existing = new Set((await tx.select().from(holidaysTable).where(sql`${holidaysTable.holiday_date} between ${`${year}-01-01`}::date and ${`${year}-12-31`}::date`))
      .map((row) => `${text(row.holiday_date)}|${text(row.name).toLowerCase()}`));
    const missing = philippineHolidays(year).filter((holiday) => !existing.has(`${holiday.date}|${holiday.name.toLowerCase()}`));
    if (missing.length) await tx.insert(holidaysTable).values(missing.map((holiday) => ({ holiday_id: createReadableId("HOL") + Math.random().toString(36).slice(2, 5).toUpperCase(), holiday_date: holiday.date, name: holiday.name, holiday_type: holiday.type, notes: holiday.notes || null, ...encodedBy() })));
    return missing.length;
  });
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
  // The declaration and every clock-in it cancels are saved together (upgrade #6 phase 4): one transaction.
  return inTransaction(async () => {
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
  });
}

/** Reopens a date. Clock-ins cancelled when it was declared stay cancelled; their original times remain in the notes. */
export async function removeClosure(date: string) {
  if (!validDate(date)) throw new Error("Choose a valid date.");
  const { record } = await getAttendanceForEmployeeDate("SYSTEM", date);
  if (!record?.id || record.status !== "Non-working Day") throw new Error("That date is not a declared non-working day.");
  await currentDb().delete(schema.attendance).where(and(eq(schema.attendance.attendance_id, record.id), eq(schema.attendance.attendance_status, "Non-working Day")));
}
