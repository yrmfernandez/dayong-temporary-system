import { manilaNow } from "@/lib/remittance-deadline";
import { previousWorkingDay, type WorkCalendar } from "@/lib/working-days";
import { toCents } from "@/lib/money";

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
 *
 * Cash count (owner, November 27, 2026): on a Cash batch the clerk types the cash they counted from the MAS instead of
 * the turnover sheet's figure, so short and over are found from the real cash. The count is everything handed over for
 * the batch: the total remittance, Fidelity and the penalty, so it is compared with the expected cash (total remittance
 * + penalty). It is recorded as before with control total = cash counted − penalty, so the slip, Discrepancy, Exceptions
 * and the clerk report work unchanged. Other remittance methods keep the control total from the turnover sheet.
 * The clerk counts by denomination (owner, November 27, 2026: how many ₱1,000, ₱500, ₱100 and so on); the total is
 * worked out from the pieces (cashCountTotal) and the breakdown is kept in the note of a short or over.
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

/**
 * "" when the control total is entered and the total remittance can be calculated, otherwise what is missing.
 * `totalRemittance` is null while an entry is incomplete (its remittance cannot be calculated yet). A total that does
 * not match is not a problem: see controlTotalDifference.
 */
export function controlTotalProblem(controlTotal: unknown, totalRemittance: number | null, cash = false) {
  const total = Number(controlTotal);
  if (controlTotal === "" || controlTotal === null || controlTotal === undefined || !Number.isFinite(total) || total <= 0) return cash ? "Enter the cash you counted from the MAS for this batch." : "Enter the net total (total remittance) from the MAS's turnover sheet.";
  if (totalRemittance === null) return cash ? "Complete the entries so the expected cash can be calculated." : "Complete the entries so the total remittance can be calculated.";
  return "";
}

/** The cash a Cash batch should bring in: total remittance (with Fidelity) + penalty; null while it cannot be calculated. */
export const expectedCash = (totalRemittance: number | null, penalty: number) => totalRemittance === null ? null : (toCents(totalRemittance) + toCents(Math.max(0, penalty || 0))) / 100;

/** The control total recorded for a cash count: the cash counted less the penalty, so it compares with the total remittance. */
export const cashCountControlTotal = (counted: unknown, penalty: number) => (toCents(Number(counted)) - toCents(Math.max(0, penalty || 0))) / 100;

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

/** True for a short or over recorded from a cash count (its note starts with Cash counted); else from a turnover sheet. */
export const isCashCountNote = (note: string) => String(note ?? "").startsWith("Cash counted ");

/** "Cash count" or "Turnover sheet": where a recorded short or over came from, for messages and slip remarks. */
export const varianceSource = (note: string) => String(note ?? "").startsWith("Handover ") ? "Handover count" : isCashCountNote(note) ? "Cash count" : "Turnover sheet";

/**
 * Philippine bills and coins counted for a Cash batch, largest first (₱20 is one row, bill or coin). Centavos down to
 * ₱0.01 (owner, November 28, 2026): before, ₱0.25 was the only centavo coin, so 50, 10, 5 and 1 centavo could not be counted.
 */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01] as const;

/** "₱1,000", "₱20", "₱0.50", "₱0.05": a denomination as shown (centavos with two decimals). */
export const denominationLabel = (denomination: number) => `₱${denomination < 1 ? denomination.toFixed(2) : denomination.toLocaleString("en-PH")}`;

/** Pieces per denomination, e.g. { "1000": 3, "500": 1 }; typed text on the form, numbers on the server. */
export type CashCounts = Record<string, number | string>;

/** The pieces of one denomination: a whole number of 0 or more; NaN when it is not. */
const pieces = (value: unknown) => { const text = String(value ?? "").trim(); if (!text) return 0; const count = Number(text); return Number.isInteger(count) && count >= 0 && count <= 100000 ? count : Number.NaN; };

/** "" when every count is a whole number of pieces of a known denomination, otherwise what is wrong. */
export function cashCountsProblem(counts: unknown) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "Count the cash by denomination.";
  for (const [key, value] of Object.entries(counts as Record<string, unknown>)) {
    if (!DENOMINATIONS.some((denomination) => String(denomination) === key)) return `₱${key} is not a denomination that can be counted.`;
    if (Number.isNaN(pieces(value))) return `Enter a whole number of ${denominationLabel(Number(key))} pieces.`;
  }
  return "";
}

/** The total of the pieces counted, in pesos (0 when nothing is counted or a count is not a whole number). */
export const cashCountTotal = (counts: CashCounts) => cashCountsProblem(counts) ? 0
  : DENOMINATIONS.reduce((cents, denomination) => cents + pieces(counts[String(denomination)]) * toCents(denomination), 0) / 100;

/** The pieces counted, without the zeros: { "1000": 3, "500": 1 } (an object lists whole-number keys smallest first). */
export const cleanCashCounts = (counts: CashCounts) => Object.fromEntries(DENOMINATIONS.map((denomination) => [String(denomination), pieces(counts[String(denomination)])]).filter(([, count]) => Number(count) > 0)) as Record<string, number>;

/** "₱1,000×3, ₱500×1, ₱0.25×4, ₱0.05×2": the breakdown as text. */
export const cashCountsText = (counts: CashCounts) => { const clean = cleanCashCounts(counts); return DENOMINATIONS.filter((denomination) => clean[String(denomination)]).map((denomination) => `${denominationLabel(denomination)}×${clean[String(denomination)]}`).join(", "); };

/** The note kept with a cash count's short or over: the cash counted (and the penalty in it), its breakdown, then the clerk's note. */
export const cashCountNote = (counted: unknown, penalty: number, note: string, counts?: CashCounts) =>
  `Cash counted ${peso(toCents(Number(counted)) / 100)}${penalty > 0 ? ` incl. penalty ${peso(penalty)}` : ""}${counts && cashCountsText(counts) ? ` (${cashCountsText(counts)})` : ""}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, TURNOVER_NOTE_MAX);

/** The longest note kept with a short or over turnover sheet (lib/turnover-variance.ts). */
export const TURNOVER_NOTE_MAX = 300;

/**
 * The reference no. of a bank or e-wallet batch (owner, November 27, 2026): required on New Sales and Collections
 * when the remittance method is not cash, with a number in it (the transaction or deposit slip number), as the
 * remarks of a bank deposit. From December 1, 2026 the batch is recorded in Bank Deposits with this reference.
 */
export const PAYMENT_REFERENCE_MAX = 100;
export function paymentReferenceProblem(value: unknown, method = "") {
  const reference = String(value ?? "").trim();
  const name = method ? `${method} reference no.` : "reference no.";
  if (!reference) return `Enter the ${name}: the transaction or deposit slip number.`;
  if (!/\d/.test(reference)) return `The ${name} needs a number; letters only are not accepted.`;
  if (reference.length > PAYMENT_REFERENCE_MAX) return `The ${name} must be ${PAYMENT_REFERENCE_MAX} characters or fewer.`;
  return "";
}

/** "Short by ₱50.00" / "Over by ₱50.00" for a difference (control total − total remittance). */
export const varianceLabel = (difference: number) => `${difference < 0 ? "Short" : "Over"} by ${Math.abs(difference).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}`;

/** Control total − total remittance, in pesos: negative is short, positive is over, 0 matches; null when not comparable. */
export function controlTotalDifference(controlTotal: unknown, totalRemittance: number | null, cash = false) {
  if (controlTotalProblem(controlTotal, totalRemittance, cash) || totalRemittance === null) return null;
  return (toCents(Number(controlTotal)) - toCents(totalRemittance)) / 100;
}

/** What the form shows beside the control total: what is missing, a match, or how much it is short or over. */
export function controlTotalStatus(controlTotal: unknown, totalRemittance: number | null, cash = false) {
  const difference = controlTotalDifference(controlTotal, totalRemittance, cash);
  if (difference === null) return { tone: "problem" as const, difference: 0, text: controlTotalProblem(controlTotal, totalRemittance, cash) };
  if (cash) {
    if (!difference) return { tone: "match" as const, difference, text: "Matches the expected cash." };
    return {
      tone: "variance" as const,
      difference,
      text: difference < 0
        ? `Short by ${peso(Math.abs(difference))}: the cash counted is less than the entries need. Count again, then look for a doubled entry or a wrong amount. It can still be saved; its slip goes to Discrepancy.`
        : `Over by ${peso(Math.abs(difference))}: the cash counted is more than the entries need. Count again, then look for a missing entry or a wrong incentive. It can still be saved; its slip goes to Discrepancy.`,
    };
  }
  if (!difference) return { tone: "match" as const, difference, text: "Matches the total remittance." };
  return {
    tone: "variance" as const,
    difference,
    text: difference < 0
      ? `Short by ${peso(Math.abs(difference))}: the turnover sheet is less than the entries. Look for a doubled entry or a wrong amount. It can still be saved; its slip goes to Discrepancy.`
      : `Over by ${peso(Math.abs(difference))}: the turnover sheet is more than the entries. Look for a missing entry or a wrong incentive. It can still be saved; its slip goes to Discrepancy.`,
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
