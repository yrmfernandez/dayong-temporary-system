// The company works on Manila time (UTC+8): every report, filter and on-screen date is the Manila date (upgrade #7,
// October 24, 2026). The database stores times in UTC, so a time saved between midnight and 8:00 AM in Manila is still
// on the day before in UTC; cutting the first 10 characters of such a time gives the wrong day. Safe on the client too.

const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in Manila, as YYYY-MM-DD. The one copy: pages and lib import it rather than writing their own. */
export function manilaToday(now = new Date()) {
  return manilaDay.format(now);
}

/**
 * A real calendar date written YYYY-MM-DD. Refuses impossible days (2026-02-31, 2026-04-31) and months (2026-13-01)
 * without throwing. The one copy (November 23, 2026): nineteen local copies disagreed, some let February 31 through
 * and some threw on month 13, which showed a server error instead of "choose a valid date".
 */
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The YYYY-MM-DD date a number of days after (or before, when negative) a YYYY-MM-DD date. */
export function addDays(date: string, count: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The Manila date (YYYY-MM-DD) of a stored time. Handles UTC ISO times ("2026-10-23T17:30:00.000Z") and database times
 * ("2026-10-23 17:30:00+00"); both carry their zone. Plain dates and times without a zone (already Manila, e.g.
 * "2026-10-24 01:30") are cut to their first 10 characters.
 */
export function manilaDateOf(value: string | Date | null | undefined) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : manilaDay.format(value);
  const stamp = String(value ?? "").trim();
  const zoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(stamp);
  if (!zoned) return stamp.slice(0, 10);
  const zone = zoned[3].toUpperCase() === "Z" ? "Z" : zoned[3].length === 3 ? `${zoned[3]}:00` : zoned[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(`${zoned[1]}T${zoned[2]}${zone}`);
  return Number.isNaN(parsed.getTime()) ? stamp.slice(0, 10) : manilaDay.format(parsed);
}
