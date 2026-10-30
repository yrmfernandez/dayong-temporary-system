const shift = (date: string, days: number) => { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + days); return day.toISOString().slice(0, 10); };

/** The last day of the month of `date` (YYYY-MM-DD). */
export const monthEnd = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * The report week containing `date` (owner, October 30, 2026): Monday to Sunday, but never outside its month. The
 * first week starts on the 1st and the last ends on the month's last day, so October 2026 is Oct 1-4, 5-11, 12-18,
 * 19-25 and 26-31. Used by the weekly report and audit (lib/daily-audit.ts periodSpan) and This week on Reports pages.
 */
export function reportWeek(date: string) {
  const monday = shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)), sunday = shift(monday, 6);
  const first = `${date.slice(0, 7)}-01`, last = monthEnd(date);
  return { start: monday < first ? first : monday, end: sunday > last ? last : sunday };
}
