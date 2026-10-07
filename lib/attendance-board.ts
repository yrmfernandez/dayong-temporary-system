import type { SessionUser } from "@/lib/auth";
import type { AttendanceRecord } from "@/lib/attendance-data";

/** Where an employee stands on one day. Present covers On time, Late, and Early. */
export type BoardCategory = "On time" | "Late" | "Early" | "Absent" | "AWOL" | "On leave" | "Day Off" | "Not clocked in" | "Non-working day";

const roleNames = (user: Pick<SessionUser, "roleNames">) => user.roleNames.map((role) => role.trim().toLowerCase());

export function canViewAttendanceTracking(user: Pick<SessionUser, "roleNames" | "permissions">) {
  return roleNames(user).some((role) => ["administrator", "admin", "hr officer", "hr", "finance", "ceo", "president"].includes(role))
    || Boolean(user.permissions.manageAttendance || user.permissions.viewAttendanceReports);
}

/** Late time may be corrected by management and HR (it flows into payroll deductions); Finance only views it. */
export function canAdjustLateness(user: Pick<SessionUser, "roleNames" | "permissions">) {
  return roleNames(user).some((role) => ["administrator", "admin", "hr officer", "hr", "ceo", "president"].includes(role))
    || Boolean(user.permissions.manageAttendance);
}

/**
 * A missing record is Absent once the day has passed; today it is only "Not clocked in" yet.
 * A clocked-in employee is Late when late minutes remain (after the 20-minute grace), Early when they clocked in at or
 * before the scheduled time (08:00 itself is Early), otherwise On time.
 */
export function boardCategory(record: AttendanceRecord | null, date: string, today: string): BoardCategory {
  if (record?.status === "Day Off") return "Day Off";
  if (record?.status === "Leave") return "On leave";
  if (record?.status === "AWOL") return "AWOL";
  if (record?.status === "Absent") return "Absent";
  if (!record?.timeIn) return date < today ? "Absent" : "Not clocked in";
  if (record.lateMinutes > 0) return "Late";
  if (record.scheduledTimeIn && record.timeIn <= record.scheduledTimeIn) return "Early";
  return "On time";
}

/** Minutes between two HH:MM times; positive when `later` is after `earlier`. */
export function minutesBetween(earlier: string, later: string) {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return toMinutes(later) - toMinutes(earlier);
}

// ---------------------------------------------------------------- an employee's own history (My Attendance)

/** An employee's own attendance history: one week (Monday to Sunday), one month, or one year. */
export type HistoryPeriod = "week" | "month" | "year";
export const HISTORY_PERIODS: HistoryPeriod[] = ["week", "month", "year"];
export const isHistoryPeriod = (value: unknown): value is HistoryPeriod => HISTORY_PERIODS.includes(value as HistoryPeriod);

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (text: string) => new Date(`${text}T00:00:00Z`);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The period containing `date` (YYYY-MM-DD): its first and last day, a label, and the dates of the periods around it. */
export function periodRange(period: HistoryPeriod, date: string) {
  const anchor = utc(date);
  let from: Date, to: Date, previous: Date, next: Date, label: string;
  if (period === "week") {
    from = new Date(anchor); from.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
    to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    previous = new Date(from); previous.setUTCDate(from.getUTCDate() - 7);
    next = new Date(from); next.setUTCDate(from.getUTCDate() + 7);
    const sameMonth = from.getUTCMonth() === to.getUTCMonth();
    label = `${MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCDate()} – ${sameMonth ? "" : `${MONTH_NAMES[to.getUTCMonth()]} `}${to.getUTCDate()}, ${to.getUTCFullYear()}`;
  } else if (period === "month") {
    from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    previous = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
    next = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
    label = `${MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
  } else {
    from = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    to = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31));
    previous = new Date(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1));
    next = new Date(Date.UTC(anchor.getUTCFullYear() + 1, 0, 1));
    label = String(from.getUTCFullYear());
  }
  return { from: iso(from), to: iso(to), previous: iso(previous), next: iso(next), label };
}

export type HistoryTotals = { early: number; onTime: number; late: number; absent: number; leave: number; dayOff: number; workedHours: number; overtimeHours: number; lateMinutes: number; undertimeMinutes: number };
const emptyTotals = (): HistoryTotals => ({ early: 0, onTime: 0, late: 0, absent: 0, leave: 0, dayOff: 0, workedHours: 0, overtimeHours: 0, lateMinutes: 0, undertimeMinutes: 0 });
const round = (value: number) => Math.round(value * 100) / 100;

function addTo(totals: HistoryTotals, record: AttendanceRecord, category: BoardCategory) {
  if (category === "Early") totals.early++;
  else if (category === "On time") totals.onTime++;
  else if (category === "Late") totals.late++;
  else if (category === "Absent" || category === "AWOL") totals.absent++;
  else if (category === "On leave") totals.leave++;
  else if (category === "Day Off") totals.dayOff++;
  totals.workedHours = round(totals.workedHours + record.workedHours);
  totals.overtimeHours = round(totals.overtimeHours + record.overtimeHours);
  totals.lateMinutes += record.lateMinutes;
  totals.undertimeMinutes += record.undertimeMinutes;
}

/**
 * Days with their Early / On time / Late / Absent / … category, totals for the period, and a breakdown: per day for a
 * week, per week (Monday start) for a month, per month for a year. Non-working days are listed but not counted.
 */
export function summarizeHistory(period: HistoryPeriod, records: AttendanceRecord[], today: string) {
  const days = [...records].sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate))
    .map((record) => ({ ...record, category: record.status === "Non-working Day" ? "Non-working day" as BoardCategory : boardCategory(record, record.attendanceDate, today) }));
  const totals = emptyTotals();
  const groups = new Map<string, { key: string; label: string; totals: HistoryTotals }>();
  for (const day of [...days].reverse()) {
    if (day.category === "Non-working day" || day.category === "Not clocked in") continue;
    addTo(totals, day, day.category);
    const date = utc(day.attendanceDate);
    let key: string, label: string;
    if (period === "year") { key = day.attendanceDate.slice(0, 7); label = MONTH_NAMES[date.getUTCMonth()]; }
    else if (period === "month") { const monday = periodRange("week", day.attendanceDate).from; key = monday; label = `Week of ${MONTH_NAMES[utc(monday).getUTCMonth()]} ${utc(monday).getUTCDate()}`; }
    else { key = day.attendanceDate; label = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]} ${date.getUTCDate()}`; }
    const group = groups.get(key) ?? groups.set(key, { key, label, totals: emptyTotals() }).get(key)!;
    addTo(group.totals, day, day.category);
  }
  const counted = totals.early + totals.onTime + totals.late;
  return { days, totals, present: counted, punctuality: counted ? Math.round(((totals.early + totals.onTime) / counted) * 100) : null, breakdown: [...groups.values()] };
}
export type AttendanceHistory = ReturnType<typeof summarizeHistory> & ReturnType<typeof periodRange> & { period: HistoryPeriod; today: string };
