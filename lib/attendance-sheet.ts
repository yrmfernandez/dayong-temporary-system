import type { AttendanceRecord } from "@/lib/attendance-data";
import { boardCategory } from "@/lib/attendance-board";
import { withDayTotals } from "@/lib/attendance";
import { isWorkingDay, type DeclaredDay } from "@/lib/working-days";

/**
 * Attendance sheet (owner, October 14, 2026): every day of a date range for an employee, including days with no record,
 * and the totals Finance checks before paying salaries. The counts follow payroll (lib/payroll-calc.ts): days payable
 * are Present days plus approved leave; late, undertime and overtime come from Present days only. Days with no record
 * are listed separately because payroll does not deduct them (the system records them Absent when the day closes).
 *
 * Pure, so it can be tested; app/api/attendance-sheet loads the records, employees and declared non-working days.
 */

export type SheetDayStatus =
  | "Present" | "Late" | "Absent" | "Absent (system)" | "AWOL" | "Leave" | "Day Off" | "Not required"
  | "No record" | "Not clocked in" | "Sunday" | "Non-working day" | "Upcoming" | "Before hire";

export type SheetDay = {
  date: string;
  weekday: string;
  /** A scheduled working day (Monday to Saturday, not declared non-working for the employee's branch). */
  workingDay: boolean;
  status: SheetDayStatus;
  branch: string;
  timeIn: string;
  timeOut: string;
  regularHours: number;
  totalHours: number;
  overtimeHours: number;
  lateMinutes: number;
  undertimeMinutes: number;
  /** Clocked in on a past day but never clocked out (no hours counted). */
  missingTimeOut: boolean;
  /** Present on a Sunday or a declared non-working day. */
  restDayWork: boolean;
  leave: string;
  notes: string;
};

export type SheetSummary = {
  /** Working days from the later of the range start and the hire date up to the earlier of the range end and today. */
  scheduledDays: number;
  present: number;
  lateDays: number;
  lateMinutes: number;
  undertimeDays: number;
  undertimeMinutes: number;
  overtimeHours: number;
  regularHours: number;
  totalHours: number;
  approvedLeave: number;
  otherLeave: number;
  absent: number;
  systemAbsent: number;
  awol: number;
  dayOff: number;
  notRequired: number;
  noRecord: number;
  missingTimeOut: number;
  restDayWork: number;
  /** Present + approved leave: the days paid under payroll's attendance method. */
  daysPayable: number;
  /** Present ÷ days expected (scheduled less day off, not required and approved leave); null when none expected. */
  attendanceRate: number | null;
};

export type SheetEmployee = { id: string; name: string; branch: string; roles: string[]; status: string; dateHired: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 100) / 100;

export function emptySummary(): SheetSummary {
  return {
    scheduledDays: 0, present: 0, lateDays: 0, lateMinutes: 0, undertimeDays: 0, undertimeMinutes: 0, overtimeHours: 0,
    regularHours: 0, totalHours: 0, approvedLeave: 0, otherLeave: 0, absent: 0, systemAbsent: 0, awol: 0, dayOff: 0,
    notRequired: 0, noRecord: 0, missingTimeOut: 0, restDayWork: 0, daysPayable: 0, attendanceRate: null,
  };
}

/** Every day from `from` to `to` for one employee, with the period totals. */
export function attendanceSheet({ employee, records, declaredDays, from, to, today }: {
  employee: Pick<SheetEmployee, "branch" | "dateHired">;
  records: AttendanceRecord[];
  declaredDays: DeclaredDay[];
  from: string; to: string; today: string;
}) {
  const byDate = new Map(records.map((record) => [record.attendanceDate, record]));
  const calendar = { days: declaredDays, branch: employee.branch };
  const hired = /^\d{4}-\d{2}-\d{2}/.test(employee.dateHired) ? employee.dateHired.slice(0, 10) : "";
  const days: SheetDay[] = [];
  const summary = emptySummary();

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const record = byDate.get(date) ?? null;
    const workingDay = isWorkingDay(date, calendar) && record?.status !== "Non-working Day";
    const day: SheetDay = {
      date, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], workingDay, status: "No record",
      branch: record?.branch ?? "", timeIn: record?.timeIn ?? "", timeOut: record?.timeOut ?? "",
      regularHours: 0, totalHours: 0, overtimeHours: 0, lateMinutes: 0, undertimeMinutes: 0,
      missingTimeOut: false, restDayWork: false,
      leave: record?.status === "Leave" ? [record.leaveType || "Leave", record.leaveApprovalStatus].filter(Boolean).join(" · ") : "",
      notes: record?.notes ?? "",
    };
    days.push(day);

    if (record?.status === "Present" && record.timeIn) {
      const totals = withDayTotals(record);
      day.status = record.lateMinutes > 0 ? "Late" : "Present";
      day.regularHours = totals.regularHours;
      day.totalHours = totals.workedHours;
      day.overtimeHours = record.overtimeHours;
      day.lateMinutes = record.lateMinutes;
      day.undertimeMinutes = record.undertimeMinutes;
      day.missingTimeOut = !record.timeOut && date < today;
      day.restDayWork = !workingDay;
    } else if (record && record.status !== "Present") {
      const category = boardCategory(record, date, today);
      day.status = record.status === "Non-working Day" ? "Non-working day"
        : record.status === "Absent" && record.notes.startsWith("Absent by system") ? "Absent (system)"
        : category === "On leave" ? "Leave" : category === "Not required" ? "Not required"
        : (category as SheetDayStatus);
    } else if (hired && date < hired) day.status = "Before hire";
    else if (!workingDay) day.status = day.weekday === "Sun" ? "Sunday" : "Non-working day";
    else if (date > today) day.status = "Upcoming";
    else if (date === today) day.status = "Not clocked in";

    // Totals: a day counts once it has passed (today counts only when worked), and never before the hire date.
    if (day.status === "Before hire" || day.status === "Upcoming") continue;
    if (workingDay && date <= today && (date < today || day.status === "Present" || day.status === "Late")) summary.scheduledDays++;
    switch (day.status) {
      case "Present": case "Late":
        summary.present++;
        if (day.lateMinutes > 0) summary.lateDays++;
        if (day.undertimeMinutes > 0) summary.undertimeDays++;
        summary.lateMinutes += day.lateMinutes;
        summary.undertimeMinutes += day.undertimeMinutes;
        summary.overtimeHours = round(summary.overtimeHours + day.overtimeHours);
        summary.regularHours = round(summary.regularHours + day.regularHours);
        summary.totalHours = round(summary.totalHours + day.totalHours);
        if (day.missingTimeOut) summary.missingTimeOut++;
        if (day.restDayWork) summary.restDayWork++;
        break;
      case "Leave":
        if (record?.leaveApprovalStatus.toLowerCase() === "approved") summary.approvedLeave++; else summary.otherLeave++;
        break;
      case "Absent": summary.absent++; break;
      case "Absent (system)": summary.absent++; summary.systemAbsent++; break;
      case "AWOL": summary.awol++; break;
      case "Day Off": summary.dayOff++; break;
      case "Not required": summary.notRequired++; break;
      case "No record": if (workingDay && date < today) summary.noRecord++; break;
    }
  }

  summary.daysPayable = summary.present + summary.approvedLeave;
  const expected = summary.scheduledDays - summary.dayOff - summary.notRequired - summary.approvedLeave;
  summary.attendanceRate = expected > 0 ? Math.min(100, Math.round(((summary.present - summary.restDayWork) / expected) * 100)) : null;
  return { days, summary };
}

/** One row per employee for a summary table, and the grand totals. */
export function sumSummaries(summaries: SheetSummary[]): SheetSummary {
  const total = emptySummary();
  for (const summary of summaries) {
    for (const key of Object.keys(total) as Array<keyof SheetSummary>) {
      if (key === "attendanceRate") continue;
      total[key] = round((total[key] as number) + (summary[key] as number));
    }
  }
  const expected = total.scheduledDays - total.dayOff - total.notRequired - total.approvedLeave;
  total.attendanceRate = expected > 0 ? Math.min(100, Math.round(((total.present - total.restDayWork) / expected) * 100)) : null;
  return total;
}
