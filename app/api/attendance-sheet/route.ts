import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { getPhilippineDate } from "@/lib/attendance";
import { canViewAttendanceTracking } from "@/lib/attendance-board";
import { getAttendanceRecordsForRange } from "@/lib/attendance-data";
import { attendanceSheet, gridCell, sumSummaries } from "@/lib/attendance-sheet";
import { closeFinishedAttendanceDaysQuietly } from "@/lib/auto-absence";
import { getEmployees } from "@/lib/employees";
import { getPayProfiles } from "@/lib/payroll";
import { declaredNonWorkingDays } from "@/lib/work-calendar";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

/**
 * Attendance sheet (owner, October 14, 2026; Finance, HR, management): every employee's attendance summary for a date
 * range, or one employee's day-by-day sheet (`employeeId`). lib/attendance-sheet.ts.
 * The summary also carries each employee's grid cells (the paper sheet's format, October 15, 2026) and, for those who
 * can open Payroll, the pay rate ("fixed 6000" monthly, "525/ daily").
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canViewAttendanceTracking(user)) return Response.json({ success: false, message: "Attendance tracking access is required." }, { status: 403 });

  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("from")?.trim() ?? "";
    const to = params.get("to")?.trim() ?? "";
    const employeeId = params.get("employeeId")?.trim() ?? "";
    const includeInactive = params.get("inactive") === "1";
    if (!validDate(from) || !validDate(to) || from > to) throw new Error("Choose a valid date range.");
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 366) throw new Error("The attendance sheet is limited to 367 days.");

    // Finished days get their system absences first, as payroll does, so the sheet matches what payroll will count.
    await closeFinishedAttendanceDaysQuietly();
    const today = getPhilippineDate();
    const [employees, declaredDays] = await Promise.all([getEmployees(), declaredNonWorkingDays()]);
    const people = employees.map((employee) => ({ id: employee.id, name: employee.name, branch: employee.branch, roles: employee.roles, status: employee.status, dateHired: employee.dateHired }))
      .sort((first, second) => first.name.localeCompare(second.name));

    // The same records payroll reads (one per employee per day), so the sheet and payroll count alike.
    const records = await getAttendanceRecordsForRange(from, to);
    if (employeeId) {
      const employee = people.find((item) => item.id === employeeId);
      if (!employee) throw new Error("Select a registered employee.");
      const sheet = attendanceSheet({ employee, records: records.filter((record) => record.employeeId === employeeId), declaredDays, from, to, today });
      return Response.json({ success: true, from, to, today, employees: people, employee, ...sheet }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const byEmployee = new Map<string, typeof records>();
    for (const record of records) byEmployee.set(record.employeeId, [...(byEmployee.get(record.employeeId) ?? []), record]);
    // Active employees, plus anyone else with attendance in the range (they worked part of it); all with the toggle.
    const listed = people.filter((employee) => includeInactive || employee.status === "active" || byEmployee.has(employee.id));
    const rates = new Map<string, string>();
    if (canAccessPath(user, "/payroll")) {
      for (const profile of await getPayProfiles()) {
        if (profile.status !== "active" || !profile.baseRate) continue;
        if (profile.baseType === "monthly") rates.set(profile.employeeId, `fixed ${profile.baseRate}`);
        else if (profile.baseType === "daily") rates.set(profile.employeeId, `${profile.baseRate}/ daily`);
      }
    }
    const rows = listed.map((employee) => {
      const sheet = attendanceSheet({ employee, records: byEmployee.get(employee.id) ?? [], declaredDays, from, to, today });
      return { employee, summary: sheet.summary, cells: sheet.days.map(gridCell), rate: rates.get(employee.id) ?? "" };
    });
    return Response.json({ success: true, from, to, today, employees: people, rows, showRates: rates.size > 0, totals: sumSummaries(rows.map((row) => row.summary)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the attendance sheet." }, { status: 400 });
  }
}
