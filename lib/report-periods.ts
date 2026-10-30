import { and, asc, eq, sql } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema, type Queryable } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { formatDate } from "@/lib/date-format";
import { createReadableId } from "@/lib/readable-id";
import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Weekly and monthly reports the clerk submits (owner, October 30, 2026):
 *
 * - Weekly: the clerk chooses up to which day (today at the latest); it starts the day after their last weekly ended,
 *   so no day is left out or counted twice (the first one starts on a day they choose). They submit it; once submitted
 *   it is locked for them, unless the audit returns it with a reason, and they submit it again after fixing it.
 * - Monthly: the weeklies not yet in a monthly, up to the weekly the clerk chooses; every one of them must be approved.
 *   It is for the month most of its days fall in (Sep 28 - Nov 1 is October).
 *
 * Each submitted period is a row of weekly_audits / monthly_audits (report_date its first day, end_date its last), so
 * the audit of it (lib/daily-audit.ts) is the same row: HR and Finance prepare and may return it; an Administrator approves.
 */
export type PeriodKind = "weekly" | "monthly";
export type ClerkPeriod = {
  id: string; kind: PeriodKind; start: string; end: string; monthLabel: string;
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
    id: row.audit_id, kind, start: text(row.report_date), end: text(row.end_date), monthLabel: text(row.month_label),
    submission: text(row.submission) === "Returned" ? "Returned" : "Submitted",
    auditStatus: status === "Approved" ? "Approved" : status === "Draft" ? "Draft" : "Not started",
    submittedAt: text(row.submitted_at), submittedBy: text(row.submitted_by_name), returnedAt: text(row.returned_at), returnedBy: text(row.returned_by_name),
    returnReason: text(row.return_reason), editAllowedAt: text(row.clerk_edit_allowed_at),
  };
}

/** The clerk's submitted weeklies or monthlies, oldest first. */
export async function clerkPeriods(employeeId: string, kind: PeriodKind, db: Queryable = currentDb()) {
  const table = TABLE[kind];
  const rows = await db.select().from(table).where(and(eq(table.employee_id, text(employeeId)), sql`${table.end_date} is not null`)).orderBy(asc(table.report_date));
  return rows.map((row) => readPeriod(kind, row));
}

export const periodContaining = (periods: ClerkPeriod[], date: string) => periods.find((period) => period.start <= date && date <= period.end) ?? null;

/** The day the clerk's next weekly starts: the day after their last weekly ended ("" before their first). */
export const nextWeekStart = (weeklies: ClerkPeriod[]) => (weeklies.length ? shift(weeklies[weeklies.length - 1].end, 1) : "");

/** The weeklies a new monthly gathers: those after the clerk's last monthly. */
export const weeksAfterLastMonthly = (weeklies: ClerkPeriod[], monthlies: ClerkPeriod[]) => {
  const after = monthlies.length ? monthlies[monthlies.length - 1].end : "";
  return weeklies.filter((week) => week.start > after);
};

/** Why the weeklies cannot make a monthly yet, or "": every one of them must be approved. */
export function monthlyProblem(weeks: ClerkPeriod[]) {
  if (!weeks.length) return "There is no submitted weekly report after your last monthly report.";
  const open = weeks.filter((week) => week.auditStatus !== "Approved");
  return open.length ? `Every weekly report in the month must be approved first: ${open.map((week) => `${spanText(week.start, week.end)} (${week.submission === "Returned" ? "returned" : "not approved yet"})`).join("; ")}.` : "";
}

export type ReportSpan = { start: string; end: string; weeks?: Array<{ start: string; end: string }>; monthLabel?: string };
export type PeriodView = {
  kind: PeriodKind; periods: ClerkPeriod[]; current: ClerkPeriod | null;
  /** The report not submitted yet: its first day (fixed after the first weekly), the weeklies a monthly would gather, and why it cannot be submitted. */
  draft: { start: string; end: string; chooseStart: boolean; weeks: ClerkPeriod[]; choices: ClerkPeriod[]; monthLabel: string; problem: string } | null;
  span: ReportSpan;
};

/**
 * The weekly or monthly report to show for `date` (and `to`): the submitted one containing `date` (or starting on it and
 * ending on `to`), else the one not submitted yet. A new weekly runs from the day after the last weekly to `to` (today
 * by default); a new monthly gathers the weeklies after the last monthly, up to the one ending on `to` (the last by default).
 */
export async function periodView(kind: PeriodKind, employeeId: string, date: string, to = ""): Promise<PeriodView> {
  const today = manilaNow().date;
  // to=new: the report not submitted yet, even when `date` falls in a submitted one (the picker's New report).
  const day = validDate(date) ? date : today, until = validDate(to) ? to : "", fresh = to === "new";
  const [weeklies, monthlies] = await Promise.all([clerkPeriods(employeeId, "weekly"), kind === "monthly" ? clerkPeriods(employeeId, "monthly") : Promise.resolve([])]);
  const periods = kind === "weekly" ? weeklies : monthlies;
  const exact = until ? periods.find((period) => period.start === day && period.end === until) : null;
  const current = exact ?? (until || fresh ? null : periodContaining(periods, day));
  const weeksOf = (start: string, end: string) => weeklies.filter((week) => week.start >= start && week.end <= end).map((week) => ({ start: week.start, end: week.end }));
  if (current) return { kind, periods, current, draft: null, span: { start: current.start, end: current.end, ...(kind === "monthly" ? { weeks: weeksOf(current.start, current.end), monthLabel: current.monthLabel } : {}) } };
  if (kind === "weekly") {
    const next = nextWeekStart(weeklies);
    const start = next || day;
    const end = until || (today >= start ? today : start);
    const problem = end < start ? "The last day cannot be before the first." : end > today ? "The last day cannot be after today." : "";
    return { kind, periods, current: null, draft: { start, end, chooseStart: !next, weeks: [], choices: [], monthLabel: "", problem }, span: { start, end: end < start ? start : end } };
  }
  const open = weeksAfterLastMonthly(weeklies, monthlies);
  const last = (until ? open.find((week) => week.end === until) : null) ?? open[open.length - 1];
  const weeks = last ? open.filter((week) => week.end <= last.end) : [];
  if (!weeks.length) return { kind, periods, current: null, draft: { start: day, end: day, chooseStart: false, weeks: [], choices: [], monthLabel: "", problem: monthlyProblem([]) }, span: { start: day, end: day, weeks: [] } };
  const start = weeks[0].start, end = weeks[weeks.length - 1].end, monthLabel = monthOfMost(start, end);
  return { kind, periods, current: null, draft: { start, end, chooseStart: false, weeks, choices: open, monthLabel, problem: monthlyProblem(weeks) }, span: { start, end, weeks: weeksOf(start, end), monthLabel } };
}

/** The clerk submits a new weekly (from the day after their last, or `from` for their first, to `to`) or monthly (the weeklies up to the one ending on `to`). */
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
    const open = weeksAfterLastMonthly(weeklies, monthlies);
    const last = open.find((week) => week.end === to);
    if (!last) throw new Error("Choose the last weekly report the monthly report covers.");
    const weeks = open.filter((week) => week.end <= last.end);
    const problem = monthlyProblem(weeks);
    if (problem) throw new Error(problem);
    const start = weeks[0].start, monthLabel = monthOfMost(start, last.end), id = createReadableId("MNR");
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
