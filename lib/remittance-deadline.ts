/**
 * The office's 3:00 PM remittance cutoff (owner's decision 2026-10-05; it was 10:00 AM).
 * - Incentive deadline: an OR carries a date only, so the MAS or Collector keeps the incentive when the cash is received
 *   by 3:00 PM the day after the OR date. Later, the incentive is forfeited and the full amount is remitted.
 * - Encoding: nobody saves New Sales or Collections from 3:00 PM until midnight (entryClosed).
 * Times are Manila wall-clock times written "YYYY-MM-DD HH:MM", so they compare as text.
 */
export const REMITTANCE_CUTOFF = "15:00";
export const ENTRY_CLOSED_MESSAGE = "Encoding is closed after 3:00 PM. Save New Sales and Collections tomorrow.";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** 3:00 PM the day after the OR date, or "" when the OR date is not a valid date (the rule is then not applied). */
export function incentiveDeadline(orDate: string) {
  const day = orDate.slice(0, 10);
  if (!validDate(day)) return "";
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return `${next} ${REMITTANCE_CUTOFF}`;
}

/** True when cash received at `receivedAt` ("YYYY-MM-DD HH:MM", Manila) still earns the incentive. */
export function keepsIncentive(orDate: string, receivedAt: string) {
  const deadline = incentiveDeadline(orDate);
  return !deadline || receivedAt <= deadline;
}

/** The current Manila date and time as "YYYY-MM-DD" and "HH:MM". */
// Made once: building an Intl.DateTimeFormat is slow, and dashboards convert thousands of dates (October 8, 2026: the
// CEO / President dashboard spent about 3 s making one per sale).
const manilaParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function manilaNow(now = new Date()) {
  const parts = manilaParts.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

/** The Manila date of a UTC ISO stamp such as a sale's date_created; other text is cut to its first 10 characters. */
export function manilaDateOf(value: string) {
  return /T\d{2}:/.test(value) && !Number.isNaN(Date.parse(value)) ? manilaNow(new Date(value)).date : value.slice(0, 10);
}

/** True from the 3:00 PM cutoff until midnight (Manila): no New Sales or Collections are saved. */
export function entryClosed(now = currentTime()) {
  return manilaNow(now).time >= REMITTANCE_CUTOFF;
}

/** The current time; tests set globalThis.dayongTestNow to fix it. */
function currentTime() {
  const fixed = (globalThis as { dayongTestNow?: string }).dayongTestNow;
  return fixed ? new Date(fixed) : new Date();
}

/** "Oct 4, 3:00 PM" for showing a deadline. */
export function formatDeadline(deadline: string) {
  if (!deadline) return "";
  const [day, time] = deadline.split(" ");
  const label = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const [hours, minutes] = time.split(":").map(Number);
  return `${label}, ${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
