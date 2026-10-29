import { manilaNow } from "@/lib/remittance-deadline";
import { previousWorkingDay, type WorkCalendar } from "@/lib/working-days";

/**
 * Data-entry controls shared by the New Sales and Collections forms and their saves.
 *
 * Backdated entries: an OR (or application) date of today or yesterday is normal. An older date needs a reason, kept
 * with the entry (Collections AN, Sales AS backdate_reason) and listed for administrators in Exceptions.
 *
 * Control total: before saving a batch, the clerk types the net total written on the MAS's turnover sheet: the total
 * remittance (amount collected less incentives, plus Fidelity), the same figure as "Total remittance" in the batch
 * summary. A penalty is separate and not part of it. Until October 29, 2026 the batch saved only on an exact match;
 * now it saves short or over too (owner): the difference is shown before saving, recorded with the batch, and its slip
 * goes to Discrepancy so it is traced and settled (lib/turnover-variance.ts).
 */
export const BACKDATE_REASON_MIN = 5;

/**
 * True when the date is earlier than the last working day before today (Manila): on a Monday a Saturday OR is on time,
 * as is one dated before a declared non-working day (lib/working-days.ts; owner, October 12, 2026).
 */
export const needsBackdateReason = (date: string, today = manilaNow().date, calendar?: WorkCalendar) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < previousWorkingDay(today, calendar);

/**
 * The day a receipt's lateness is judged from (owner, October 28, 2026: the clerk gave the reason once for the changed
 * Date Remitted, then every entry asked again): the batch's Date Remitted when it is earlier than today and was changed
 * with a reason (that reason explains why the batch is encoded after it), otherwise today. A receipt then needs its own
 * reason only when its date is more than one working day before the Date Remitted.
 */
export const lateCheckDay = (dateRemitted: string, dateRemittedReason: string, today = manilaNow().date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dateRemitted) && dateRemitted < today && dateRemittedReason.trim().length >= BACKDATE_REASON_MIN ? dateRemitted : today;

/** The late-entry reason kept with a receipt: its own, or the batch's Date Remitted reason when that covers it. */
export const lateEntryReason = (date: string, ownReason: string, dateRemittedReason: string, today = manilaNow().date, calendar?: WorkCalendar) =>
  ownReason.trim() || (needsBackdateReason(date, today, calendar) && dateRemittedReason.trim() ? `Date Remitted changed: ${dateRemittedReason.trim()}`.slice(0, 300) : "");

export function checkBackdate(date: string, reason: string, label: string, today = manilaNow().date, calendar?: WorkCalendar) {
  if (needsBackdateReason(date, today, calendar) && reason.trim().length < BACKDATE_REASON_MIN) {
    throw new Error(`${label}: the date ${date} is more than one working day old. Enter the reason it is being encoded late.`);
  }
}

const cents = (value: number) => Math.round(value * 100);

/**
 * "" when the control total is entered and the total remittance can be calculated, otherwise what is missing.
 * `totalRemittance` is null while an entry is incomplete (its remittance cannot be calculated yet). A total that does
 * not match is not a problem: see controlTotalDifference.
 */
export function controlTotalProblem(controlTotal: unknown, totalRemittance: number | null) {
  const total = Number(controlTotal);
  if (controlTotal === "" || controlTotal === null || controlTotal === undefined || !Number.isFinite(total) || total <= 0) return "Enter the net total (total remittance) from the MAS's turnover sheet.";
  if (totalRemittance === null) return "Complete the entries so the total remittance can be calculated.";
  return "";
}

/** The longest note kept with a short or over turnover sheet (lib/turnover-variance.ts). */
export const TURNOVER_NOTE_MAX = 300;

/** "Short by ₱50.00" / "Over by ₱50.00" for a difference (control total − total remittance). */
export const varianceLabel = (difference: number) => `${difference < 0 ? "Short" : "Over"} by ${Math.abs(difference).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}`;

/** Control total − total remittance, in pesos: negative is short, positive is over, 0 matches; null when not comparable. */
export function controlTotalDifference(controlTotal: unknown, totalRemittance: number | null) {
  if (controlTotalProblem(controlTotal, totalRemittance) || totalRemittance === null) return null;
  return (cents(Number(controlTotal)) - cents(totalRemittance)) / 100;
}

/** What the form shows beside the control total: what is missing, a match, or how much it is short or over. */
export function controlTotalStatus(controlTotal: unknown, totalRemittance: number | null) {
  const difference = controlTotalDifference(controlTotal, totalRemittance);
  if (difference === null) return { tone: "problem" as const, difference: 0, text: controlTotalProblem(controlTotal, totalRemittance) };
  if (!difference) return { tone: "match" as const, difference, text: "Matches the total remittance." };
  const peso = Math.abs(difference).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  return {
    tone: "variance" as const,
    difference,
    text: difference < 0
      ? `Short by ${peso}: the turnover sheet is less than the entries. Look for a doubled entry or a wrong amount. It can still be saved; its slip goes to Discrepancy.`
      : `Over by ${peso}: the turnover sheet is more than the entries. Look for a missing entry or a wrong incentive. It can still be saved; its slip goes to Discrepancy.`,
  };
}

/**
 * An application number that is only the year and series letters ("2026SP", "2026 SP-"): the form number itself was
 * left out. Such sales were imported before; they are labelled "(need edit)" and new ones are refused. A number
 * without a dash between the series and the form number ("2026SP00154") is refused too (owner, October 17, 2026).
 */
export const isIncompleteApplicationNumber = (value: string) => /^\s*\d{2,4}\s*[A-Za-z]+\s*-?\s*$/.test(value) || !String(value ?? "").includes("-");
export const INCOMPLETE_APPLICATION_MESSAGE = "enter the whole Application Number with its dash, including the number after the series letters (e.g. 2026SP-00154).";

/** The DOI time of a New Sale (owner, October 19, 2026): HH:MM, 24-hour. */
export const isDoiTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const DOI_TIME_MESSAGE = "Enter the DOI time as hours and minutes (for example 14:30).";

/**
 * The application number after this one, for the next sale of a New Sales batch (owner, October 19, 2026): the digits
 * after the dash plus one, the series and leading zeros kept ("062026-01616" → "062026-01617", "2026SP-0790" →
 * "2026SP-0791"). "" when the value is not a complete application number, so nothing is guessed.
 */
export function nextApplicationNumber(value: string) {
  const text = String(value ?? "").trim();
  const match = /^(.*-\s*)(\d+)$/.exec(text);
  if (!match || isIncompleteApplicationNumber(text)) return "";
  const [, series, digits] = match;
  return `${series}${(BigInt(digits) + BigInt(1)).toString().padStart(digits.length, "0")}`;
}
