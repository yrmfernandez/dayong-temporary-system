/**
 * Incentive deadline for New Sales and Collections. An OR carries a date only, so the countdown starts at the office's
 * 10:00 AM remittance cutoff on the OR date: the MAS or Collector keeps the incentive when the cash is received within
 * 24 hours of it, by 10:00 AM the next day. Later, the incentive is forfeited and the full amount is remitted.
 * Times are Manila wall-clock times written "YYYY-MM-DD HH:MM", so they compare as text.
 */
export const REMITTANCE_CUTOFF = "10:00";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** 10:00 AM the day after the OR date, or "" when the OR date is not a valid date (the rule is then not applied). */
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
export function manilaNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

/** The Manila date of a UTC ISO stamp such as a sale's date_created; other text is cut to its first 10 characters. */
export function manilaDateOf(value: string) {
  return /T\d{2}:/.test(value) && !Number.isNaN(Date.parse(value)) ? manilaNow(new Date(value)).date : value.slice(0, 10);
}

/** "Oct 4, 10:00 AM" for showing a deadline. */
export function formatDeadline(deadline: string) {
  if (!deadline) return "";
  const [day, time] = deadline.split(" ");
  const label = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const [hours, minutes] = time.split(":").map(Number);
  return `${label}, ${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
