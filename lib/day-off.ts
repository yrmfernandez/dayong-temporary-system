import { sql } from "drizzle-orm";

import { getPhilippineDate } from "@/lib/attendance";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/db";

/**
 * Day Off locks the day's entries (owner, October 16, 2026): an employee marked Day Off cannot encode, edit, void or
 * delete entries while the mark stands (today, Manila). Entries they saved before being marked stay as they are; the
 * Day Off mark notes how many there were (entriesEncodedOn), for an administrator to review.
 */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

export const DAY_OFF_MESSAGE = "You are marked Day Off today, so you cannot encode, edit, void or delete entries. If this is wrong, ask HR or an administrator to change today's attendance.";

/** Whether the employee is marked Day Off on `date` (a later record by anyone else than the system wins, as in payroll). */
export async function isOnDayOff(employeeId: string, date = getPhilippineDate()) {
  if (!employeeId) return false;
  const rows = rowsOf<{ status: string }>(await getDb().execute(sql`select coalesce(attendance_status, '') as status from attendance
    where employee_id = ${employeeId} and attendance_date = ${date}::date and coalesce(notes, '') not like 'Absent by system%' order by row_seq desc limit 1`));
  return rows[0]?.status === "Day Off";
}

/** For entry routes: a 403 response when the signed-in employee is on Day Off today, otherwise null. */
export async function refuseOnDayOff() {
  const user = await getSessionUser();
  if (!user || !(await isOnDayOff(user.employeeId))) return null;
  return Response.json({ success: false, message: DAY_OFF_MESSAGE, error: DAY_OFF_MESSAGE }, { status: 403 });
}

/** New Sales and Collections the employee encoded on `date` (Manila), for the note on a Day Off mark. */
export async function entriesEncodedOn(employeeId: string, date: string) {
  const [row] = rowsOf<{ sales: number; collections: number }>(await getDb().execute(sql`select
      (select count(*)::int from sales where encoded_by_employee_id = ${employeeId} and (encoded_at at time zone 'Asia/Manila')::date = ${date}::date) as sales,
      (select count(*)::int from collections where encoded_by_employee_id = ${employeeId} and (encoded_at at time zone 'Asia/Manila')::date = ${date}::date) as collections`));
  return { sales: Number(row?.sales ?? 0), collections: Number(row?.collections ?? 0) };
}

/** " 2 New Sales and 3 Collections were encoded before this mark; they stay for review." or "". */
export async function dayOffEntriesNote(employeeId: string, date: string) {
  const { sales, collections } = await entriesEncodedOn(employeeId, date);
  if (!sales && !collections) return "";
  const parts = [sales && `${sales} New Sale${sales === 1 ? "" : "s"}`, collections && `${collections} Collection${collections === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
  return ` ${parts} encoded that day before this mark; kept for review.`;
}
