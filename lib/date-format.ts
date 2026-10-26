// One way to show dates on every screen (owner, October 27, 2026: "arrange all dates in the system to be uniformed"):
//   date        Oct 27, 2026
//   date+time   Oct 27, 2026 3:05 PM   (Manila)
//   month       Oct 2026
// Stored and downloaded dates stay YYYY-MM-DD (CSV/Excel read those as dates); only what is shown changes. Safe in
// the browser. A value that is not a date is returned as it was, so a label or "—" passes through unchanged.
// No imports, so plain Node tests can load it (scripts/test-date-format.mjs).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
const timeParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true });

const asText = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? "").trim();
const isZoned = (text: string) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) && /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(text);
/** A stored time with its zone ("…Z", "… +00", "+08:00") as a Date. */
const zonedTime = (text: string) => new Date(text.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

/** "2026-10-27" or a stored time → "Oct 27, 2026" (a time counts on its Manila date). Not a date: returned as it was. */
export function formatDate(value: unknown) {
  const text = asText(value);
  const at = isZoned(text) ? zonedTime(text) : null;
  const day = at && !Number.isNaN(at.getTime()) ? manilaDay.format(at) : text.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return text;
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

/** A stored time → "Oct 27, 2026 3:05 PM" in Manila; "2026-10-27 15:05" (already Manila) the same; a plain date → its date. */
export function formatDateTime(value: unknown) {
  const text = asText(value);
  if (isZoned(text)) {
    const at = zonedTime(text);
    if (!Number.isNaN(at.getTime())) return `${formatDate(text)} ${timeParts.format(at)}`;
  }
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (local) {
    const hours = Number(local[2]);
    return `${formatDate(local[1])} ${hours % 12 || 12}:${local[3]} ${hours < 12 ? "AM" : "PM"}`;
  }
  return formatDate(text);
}

/** "2026-10" (or a date in it) → "Oct 2026". */
export function formatMonth(value: unknown) {
  const match = /^(\d{4})-(\d{2})/.exec(asText(value));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return asText(value);
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** "Oct 4–Oct 10, 2026" style range for two dates; one date when they are the same. */
export function formatRange(from: unknown, to: unknown) {
  const a = formatDate(from), b = formatDate(to);
  return !asText(to) || a === b ? a : `${a} – ${b}`;
}
