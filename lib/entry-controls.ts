import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Data-entry controls shared by the New Sales and Collections forms and their saves.
 *
 * Backdated entries: an OR (or application) date of today or yesterday is normal. An older date needs a reason, kept
 * with the entry (Collections AN, Sales AS backdate_reason) and listed for administrators in Exceptions.
 *
 * Control total: before saving a batch, the clerk types the net total written on the MAS's turnover sheet: the total
 * remittance (amount collected less incentives, plus Fidelity), the same figure as "Total remittance" in the batch
 * summary. The batch saves only when it matches exactly, so a mistyped, missed or doubled entry, a wrong amount or a
 * wrong incentive is caught at once. A penalty is separate and not part of it.
 */
export const BACKDATE_REASON_MIN = 5;

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** True when the date is earlier than yesterday (Manila). */
export const needsBackdateReason = (date: string, today = manilaNow().date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < dayBefore(today);

export function checkBackdate(date: string, reason: string, label: string, today = manilaNow().date) {
  if (needsBackdateReason(date, today) && reason.trim().length < BACKDATE_REASON_MIN) {
    throw new Error(`${label}: the date ${date} is more than a day old. Enter the reason it is being encoded late.`);
  }
}

const cents = (value: number) => Math.round(value * 100);

/**
 * "" when the batch's total remittance equals the control total, otherwise what is wrong. `totalRemittance` is null
 * while an entry is incomplete (its remittance cannot be calculated yet).
 */
export function controlTotalProblem(controlTotal: unknown, totalRemittance: number | null) {
  const total = Number(controlTotal);
  if (controlTotal === "" || controlTotal === null || controlTotal === undefined || !Number.isFinite(total) || total <= 0) return "Enter the net total (total remittance) from the MAS's turnover sheet.";
  if (totalRemittance === null) return "Complete the entries so the total remittance can be calculated.";
  const sum = cents(totalRemittance);
  if (sum === cents(total)) return "";
  const peso = (value: number) => (value / 100).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  return `The total remittance is ${peso(sum)} but the turnover sheet says ${peso(cents(total))} (${sum > cents(total) ? "over" : "short"} by ${peso(Math.abs(sum - cents(total)))}). Check the amounts, incentives and Fidelity, and look for a missing or repeated entry.`;
}

/**
 * An application number that is only the year and series letters ("2026SP", "2026 SP-"): the form number itself was
 * left out. Such sales were imported before; they are labelled "(need edit)" and new ones are refused.
 */
export const isIncompleteApplicationNumber = (value: string) => /^\s*\d{2,4}\s*[A-Za-z]+\s*-?\s*$/.test(value);
export const INCOMPLETE_APPLICATION_MESSAGE = "enter the whole Application Number, including the number after the series letters (e.g. 2026SP-00154).";
