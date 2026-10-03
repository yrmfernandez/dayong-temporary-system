import { manilaNow } from "@/lib/remittance-deadline";

/**
 * Data-entry controls shared by the New Sales and Collections forms and their saves.
 *
 * Backdated entries: an OR (or application) date of today or yesterday is normal. An older date needs a reason, kept
 * with the entry (Collections AN, Sales AS backdate_reason) and listed for administrators in Exceptions.
 *
 * Control total: before saving a batch, the clerk types the total written on the MAS's turnover sheet. The batch saves
 * only when its entries add up to exactly that, so a mistyped, missed or doubled entry is caught at once.
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

/** "" when the entries add up to the control total, otherwise what is wrong. */
export function controlTotalProblem(controlTotal: unknown, amounts: number[]) {
  const total = Number(controlTotal);
  if (controlTotal === "" || controlTotal === null || controlTotal === undefined || !Number.isFinite(total) || total <= 0) return "Enter the control total from the MAS's turnover sheet.";
  const sum = amounts.reduce((value, amount) => value + cents(amount), 0);
  if (sum === cents(total)) return "";
  const peso = (value: number) => (value / 100).toLocaleString("en-PH", { style: "currency", currency: "PHP" });
  return `The entries add up to ${peso(sum)} but the turnover sheet says ${peso(cents(total))} (${sum > cents(total) ? "over" : "short"} by ${peso(Math.abs(sum - cents(total)))}). Check for a mistyped, missing or repeated entry.`;
}
