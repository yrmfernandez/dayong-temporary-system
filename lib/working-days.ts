/**
 * Working days for the entry deadlines (owner, October 12, 2026): an OR dated before a Sunday or a declared non-working
 * day is not late because the office was closed. Non-working days are the same ones attendance uses: every Sunday, and
 * the days an administrator declares non-working in the attendance calendar, for all branches or some
 * (lib/attendance-calendar.ts). A holiday that was not declared is a working day.
 *
 * Pure, so the forms use it too; the server loads the declared days with loadWorkCalendar (lib/work-calendar.ts).
 */
export type DeclaredDay = { date: string; allBranches: boolean; branchNames: string[] };
/** The declared non-working days and the branch the entry belongs to. Without one, only Sundays are off. */
export type WorkCalendar = { days: DeclaredDay[]; branch?: string };

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isWorkingDay(date: string, calendar?: WorkCalendar) {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return false;
  const branch = calendar?.branch ?? "";
  return !calendar?.days.some((day) => day.date === date && (day.allBranches || day.branchNames.some((name) => same(name, branch))));
}

/** The first working day after `date`. */
export function nextWorkingDay(date: string, calendar?: WorkCalendar) {
  let next = shift(date, 1);
  // A year of closed days in a row would be a data error; stop rather than loop forever.
  for (let guard = 0; guard < 366 && !isWorkingDay(next, calendar); guard++) next = shift(next, 1);
  return next;
}

/** The last working day before `date`. */
export function previousWorkingDay(date: string, calendar?: WorkCalendar) {
  let previous = shift(date, -1);
  for (let guard = 0; guard < 366 && !isWorkingDay(previous, calendar); guard++) previous = shift(previous, -1);
  return previous;
}
