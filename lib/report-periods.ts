import { and, asc, eq, sql } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema, type Queryable } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { formatDate } from "@/lib/date-format";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";
import { monthEnd } from "@/lib/report-week";

/**
 * Weekly and monthly reports the clerk submits (owner, October 30, 2026):
 *
 * - Weekly: the clerk chooses up to which day (today at the latest); it starts the day after their last weekly ended,
 *   so no day is left out or counted twice (the first one starts on a day they choose). They submit it; once submitted
 *   it is locked for them, unless the audit returns it with a reason, and they submit it again after fixing it.
 * - Week number (owner, November 12, 2026): each weekly belongs to the month most of its days fall in (Sep 28 - Oct 4
 *   is October) and is Week 1, 2, 3... of that month in the order submitted. A weekly already in a monthly keeps that
 *   monthly's month; one after the last monthly is never put in that month or before it.
 * - Monthly: exactly one month's weeklies, Week 1 to the last (owner, November 12, 2026). It can be submitted once the
 *   weeklies reach the month's last day (or a weekly of a later month exists) and every one of them is approved.
 *
 * Each submitted period is a row of weekly_audits / monthly_audits (report_date its first day, end_date its last), so
 * the audit of it (lib/daily-audit.ts) is the same row: HR and Finance prepare and may return it; an Administrator approves.
 */
export type PeriodKind = "weekly" | "monthly";
export type ClerkPeriod = {
  id: string; kind: PeriodKind; start: string; end: string; monthLabel: string;
  /** A weekly's place (November 12, 2026): Week `week` of `monthLabel`; 0 on a monthly. */
  week: number;
  submission: "Submitted" | "Returned"; auditStatus: "Not started" | "Draft" | "Approved";
  submittedAt: string; submittedBy: string; returnedAt: string; returnedBy: string; returnReason: string; editAllowedAt: string;
};
type PeriodTable = typeof schema.weekly_audits;
const TABLE: Record<PeriodKind, PeriodTable> = { weekly: schema.weekly_audits, monthly: schema.monthly_audits as unknown as PeriodTable };
export const isPeriodKind = (kind: string): kind is PeriodKind => kind === "weekly" || kind === "monthly";

const text = (value: unknown) => String(value ?? "").trim();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (date: string) => datePattern.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const shift = (date: string, days: number) => { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + days); return day.toISOString().slice(0, 10); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Oct 5, 2026 – Oct 11, 2026". */
export const spanText = (start: string, end: string) => (start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`);
/** "2026-10" → "October 2026". */
export const monthName = (label: string) => (/^\d{4}-\d{2}$/.test(label) ? `${MONTHS[Number(label.slice(5)) - 1]} ${label.slice(0, 4)}` : label);

/** The month most of the days from `start` to `end` fall in ("YYYY-MM"); a tie goes to the later month. */
export function monthOfMost(start: string, end: string) {
  const days = new Map<string, number>();
  for (let day = start; day <= end; day = shift(day, 1)) days.set(day.slice(0, 7), (days.get(day.slice(0, 7)) ?? 0) + 1);
  return [...days.entries()].reduce((best, entry) => (entry[1] >= best[1] ? entry : best), ["", 0])[0];
}

function readPeriod(kind: PeriodKind, row: PeriodTable["$inferSelect"]): ClerkPeriod {
  const status = text(row.status);
  return {
    id: row.audit_id, kind, start: text(row.report_date), end: text(row.end_date), monthLabel: text(row.month_label), week: 0,
    submission: text(row.submission) === "Returned" ? "Returned" : "Submitted",
    auditStatus: status === "Approved" ? "Approved" : status === "Draft" ? "Draft" : "Not started",
    submittedAt: text(row.submitted_at), submittedBy: text(row.submitted_by_name), returnedAt: text(row.returned_at), returnedBy: text(row.returned_by_name),
    returnReason: text(row.return_reason), editAllowedAt: text(row.clerk_edit_allowed_at),
  };
}

async function loadPeriods(employeeId: string, kind: PeriodKind, db: Queryable) {
  const table = TABLE[kind];
  const rows = await db.select().from(table).where(and(eq(table.employee_id, text(employeeId)), sql`${table.end_date} is not null`)).orderBy(asc(table.report_date));
  return rows.map((row) => readPeriod(kind, row));
}

const nextMonth = (label: string) => { const [year, month] = label.split("-").map(Number); return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`; };
const monthOfWeek = (week: { start: string; end: string }, monthlies: ClerkPeriod[]) => {
  const inMonthly = monthlies.find((monthly) => monthly.start <= week.start && week.end <= monthly.end && monthly.monthLabel);
  if (inMonthly) return inMonthly.monthLabel;
  const most = monthOfMost(week.start, week.end), lastMonthly = monthlies.filter((monthly) => monthly.end < week.start && monthly.monthLabel).pop();
  // Never in or before the month of a monthly already submitted before it.
  return lastMonthly && most <= lastMonthly.monthLabel ? nextMonth(lastMonthly.monthLabel) : most;
};

/** Gives each weekly its month and week number (Week 1, 2... of the month, in order); `monthlies` oldest first. */
export function numberWeeks(weeklies: ClerkPeriod[], monthlies: ClerkPeriod[]) {
  const counts = new Map<string, number>();
  return weeklies.map((week) => {
    const month = monthOfWeek(week, monthlies), number = (counts.get(month) ?? 0) + 1;
    counts.set(month, number);
    return { ...week, monthLabel: month, week: number };
  });
}

/** Where a weekly from `start` to `end` not submitted yet would fall: its month and week number. */
export function nextWeekPlace(weeklies: ClerkPeriod[], monthlies: ClerkPeriod[], start: string, end: string) {
  const month = monthOfWeek({ start, end }, monthlies);
  return { monthLabel: month, week: weeklies.filter((week) => week.monthLabel === month).length + 1 };
}

/** The clerk's submitted weeklies (each with its month and week number) or monthlies, oldest first. */
export async function clerkPeriods(employeeId: string, kind: PeriodKind, db: Queryable = currentDb()) {
  if (kind === "monthly") return loadPeriods(employeeId, "monthly", db);
  const [weeklies, monthlies] = await Promise.all([loadPeriods(employeeId, "weekly", db), loadPeriods(employeeId, "monthly", db)]);
  return numberWeeks(weeklies, monthlies);
}

/** "Week 2 of October 2026". */
export const weekName = (period: { week: number; monthLabel: string }) => (period.week ? `Week ${period.week} of ${monthName(period.monthLabel)}` : "");

export const periodContaining = (periods: ClerkPeriod[], date: string) => periods.find((period) => period.start <= date && date <= period.end) ?? null;

/** The day the clerk's next weekly starts: the day after their last weekly ended ("" before their first). */
export const nextWeekStart = (weeklies: ClerkPeriod[]) => (weeklies.length ? shift(weeklies[weeklies.length - 1].end, 1) : "");

/** The weeklies a new monthly gathers: those after the clerk's last monthly. */
export const weeksAfterLastMonthly = (weeklies: ClerkPeriod[], monthlies: ClerkPeriod[]) => {
  const after = monthlies.length ? monthlies[monthlies.length - 1].end : "";
  return weeklies.filter((week) => week.start > after);
};

/**
 * The weeklies the next monthly gathers (November 12, 2026): every weekly after the last monthly that belongs to the
 * month of the first of them, Week 1 to the last; `later` says whether a weekly of a later month exists.
 */
export function nextMonthWeeks(weeklies: ClerkPeriod[], monthlies: ClerkPeriod[]) {
  const open = weeksAfterLastMonthly(weeklies, monthlies);
  const month = open[0]?.monthLabel ?? "";
  return { month, weeks: open.filter((week) => week.monthLabel === month), later: open.some((week) => week.monthLabel > month) };
}

/** Why the weeklies cannot make the month's monthly yet, or "": the month is covered and every weekly is approved. */
export function monthlyProblem(weeks: ClerkPeriod[], month = "", later = false) {
  if (!weeks.length) return "There is no submitted weekly report after your last monthly report.";
  const last = weeks[weeks.length - 1], lastDay = month ? monthEnd(`${month}-01`) : "";
  if (month && !later && last.end < lastDay) return `${monthName(month)} is not finished: your weekly reports reach ${formatDate(last.end)}. Submit the weekly reports up to ${formatDate(lastDay)} first.`;
  const open = weeks.filter((week) => week.auditStatus !== "Approved");
  return open.length ? `Every weekly report in the month must be approved first: ${open.map((week) => `Week ${week.week}, ${spanText(week.start, week.end)} (${week.submission === "Returned" ? "returned" : "not approved yet"})`).join("; ")}.` : "";
}

export type ReportSpan = { start: string; end: string; weeks?: Array<{ start: string; end: string; week?: number }>; monthLabel?: string; week?: number };
export type PeriodView = {
  kind: PeriodKind; periods: ClerkPeriod[]; current: ClerkPeriod | null;
  /** The report not submitted yet: its first day (fixed after the first weekly), the weeklies a monthly would gather, and why it cannot be submitted. */
  draft: { start: string; end: string; chooseStart: boolean; weeks: ClerkPeriod[]; monthLabel: string; week: number; problem: string } | null;
  span: ReportSpan;
};

/**
 * The weekly or monthly report to show for `date` (and `to`): the submitted one containing `date` (or starting on it and
 * ending on `to`), else the one not submitted yet. A new weekly runs from the day after the last weekly to `to` (today
 * by default); a new monthly gathers the weeklies of the next month (nextMonthWeeks).
 */
export async function periodView(kind: PeriodKind, employeeId: string, date: string, to = ""): Promise<PeriodView> {
  const today = manilaNow().date;
  // to=new: the report not submitted yet, even when `date` falls in a submitted one (the picker's New report).
  const day = validDate(date) ? date : today, until = validDate(to) ? to : "", fresh = to === "new";
  const [rawWeeklies, monthlies] = await Promise.all([loadPeriods(employeeId, "weekly", currentDb()), loadPeriods(employeeId, "monthly", currentDb())]);
  const weeklies = numberWeeks(rawWeeklies, monthlies);
  const periods = kind === "weekly" ? weeklies : monthlies;
  const exact = until ? periods.find((period) => period.start === day && period.end === until) : null;
  const current = exact ?? (until || fresh ? null : periodContaining(periods, day));
  const weeksOf = (start: string, end: string) => weeklies.filter((week) => week.start >= start && week.end <= end).map((week) => ({ start: week.start, end: week.end, week: week.week }));
  if (current) return { kind, periods, current, draft: null, span: { start: current.start, end: current.end, monthLabel: current.monthLabel, ...(kind === "monthly" ? { weeks: weeksOf(current.start, current.end) } : { week: current.week }) } };
  if (kind === "weekly") {
    const next = nextWeekStart(weeklies);
    const start = next || day;
    const end = until || (today >= start ? today : start);
    const problem = end < start ? "The last day cannot be before the first." : end > today ? "The last day cannot be after today." : "";
    const place = nextWeekPlace(weeklies, monthlies, start, end < start ? start : end);
    return { kind, periods, current: null, draft: { start, end, chooseStart: !next, weeks: [], ...place, problem }, span: { start, end: end < start ? start : end, ...place } };
  }
  const { month, weeks, later } = nextMonthWeeks(weeklies, monthlies);
  if (!weeks.length) return { kind, periods, current: null, draft: { start: day, end: day, chooseStart: false, weeks: [], monthLabel: "", week: 0, problem: monthlyProblem([]) }, span: { start: day, end: day, weeks: [] } };
  const start = weeks[0].start, end = weeks[weeks.length - 1].end;
  return { kind, periods, current: null, draft: { start, end, chooseStart: false, weeks, monthLabel: month, week: 0, problem: monthlyProblem(weeks, month, later) }, span: { start, end, weeks: weeksOf(start, end), monthLabel: month } };
}

/** The clerk submits a new weekly (from the day after their last, or `from` for their first, to `to`) or monthly (the next month's weeklies, the last ending on `to`). */
export async function submitPeriod(kind: PeriodKind, clerk: { employeeId: string; name: string }, input: { from?: string; to?: string }) {
  const actor = getEncoder();
  const employeeId = text(clerk.employeeId), to = text(input.to), from = text(input.from);
  return inTransaction(async (tx) => {
    // One submission at a time per clerk: two at once would both start after the same last weekly.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`report-period:${employeeId}`}))`);
    const weeklies = await clerkPeriods(employeeId, "weekly", tx);
    const now = new Date().toISOString(), today = manilaNow().date;
    const base = { employee_id: employeeId, employee_name: clerk.name, submission: "Submitted", submitted_at: now, submitted_by_name: actor.name, updated_at: now, ...encodedBy() };
    if (kind === "weekly") {
      const start = nextWeekStart(weeklies) || from;
      if (!validDate(start)) throw new Error("Choose the first day of your first weekly report.");
      if (!validDate(to)) throw new Error("Choose the last day of the weekly report.");
      if (to < start) throw new Error(`The weekly report starts on ${formatDate(start)}: its last day cannot be before that.`);
      if (to > today) throw new Error("The last day of the weekly report cannot be after today.");
      const id = createReadableId("WKR");
      await tx.insert(TABLE.weekly).values({ audit_id: id, report_date: start, end_date: to, ...base });
      return { id, start, end: to };
    }
    const monthlies = await clerkPeriods(employeeId, "monthly", tx);
    const { month: monthLabel, weeks, later } = nextMonthWeeks(weeklies, monthlies);
    const problem = monthlyProblem(weeks, monthLabel, later);
    if (problem) throw new Error(problem);
    const last = weeks[weeks.length - 1];
    if (to && to !== last.end) throw new Error("Your weekly reports changed. Reload the page and submit the monthly report again.");
    const start = weeks[0].start, id = createReadableId("MNR");
    await tx.insert(TABLE.monthly).values({ audit_id: id, report_date: start, end_date: last.end, month_label: monthLabel, ...base });
    return { id, start, end: last.end, monthLabel };
  });
}

/** The clerk submits a returned report again, after fixing it. */
export async function resubmitPeriod(kind: PeriodKind, employeeId: string, start: string) {
  const actor = getEncoder(), table = TABLE[kind];
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(table).where(and(eq(table.employee_id, text(employeeId)), eq(table.report_date, text(start)), sql`${table.end_date} is not null`)).limit(1).for("update");
    if (!row) throw new Error("This report has not been submitted.");
    if (text(row.submission) !== "Returned") throw new Error("This report is already submitted.");
    const now = new Date().toISOString();
    await tx.update(table).set({ submission: "Submitted", submitted_at: now, submitted_by_name: actor.name, updated_at: now }).where(eq(table.audit_id, row.audit_id));
    return { id: row.audit_id };
  });
}

/** HR, Finance or an Administrator returns a submitted, not yet approved report to the clerk, with the reason. */
export async function returnPeriod(kind: PeriodKind, employeeId: string, start: string, reason: string) {
  const actor = getEncoder(), table = TABLE[kind], why = text(reason);
  if (why.length < 3) throw new Error("Give the reason the report is returned to the clerk.");
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(table).where(and(eq(table.employee_id, text(employeeId)), eq(table.report_date, text(start)), sql`${table.end_date} is not null`)).limit(1).for("update");
    if (!row) throw new Error("The clerk has not submitted this report.");
    if (text(row.status) === "Approved") throw new Error("This report is approved. An Administrator must reopen it before it can be returned.");
    if (text(row.submission) === "Returned") throw new Error("This report is already returned to the clerk.");
    const now = new Date().toISOString();
    await tx.update(table).set({ submission: "Returned", returned_at: now, returned_by_name: actor.name, return_reason: why.slice(0, 500), updated_at: now }).where(eq(table.audit_id, row.audit_id));
    return { id: row.audit_id };
  });
}
