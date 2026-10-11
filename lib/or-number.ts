/**
 * An OR number ends with its branch's letter, e.g. "17671 N" or "13584C" (owner, October 12, 2026): digits, then one
 * letter (a space before it is fine). Without the letter two branches' receipts can share a number, which is why
 * Exceptions lists "OR numbers without a branch letter". Checked by the Collections form and its save.
 */
export const OR_NUMBER_EXAMPLE = "12345 C";
export const isValidOrNumber = (value: string) => /^\d+\s?[A-Za-z]$/.test(String(value ?? "").trim());
/** Why the OR number is not accepted, or "" when it is. */
export function orNumberProblem(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return "OR Number is required.";
  if (isValidOrNumber(text)) return "";
  if (/^\d+$/.test(text)) return `OR Number ${text} needs the branch letter at the end (e.g. ${text} C).`;
  return `OR Number ${text} must be digits followed by one letter, e.g. ${OR_NUMBER_EXAMPLE}.`;
}
/** The letter in capitals, as staff write it ("12345 c" → "12345 C"). */
export const normalizeOrNumber = (value: string) => String(value ?? "").trim().replace(/([A-Za-z])$/, (letter) => letter.toUpperCase());
