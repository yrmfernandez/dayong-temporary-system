/**
 * An OR number ends with its branch's letter, e.g. "17671 N" or "13584C" (owner, October 12, 2026): digits, then one
 * letter (a space before it is fine). Without the letter two branches' receipts can share a number, which is why
 * Exceptions lists "OR numbers without a branch letter". Checked by the Collections form and its save.
 */
export const OR_NUMBER_EXAMPLE = "12345 C";
export const isValidOrNumber = (value: string) => /^\d+\s?[A-Za-z]$/.test(String(value ?? "").trim());
/** Digits only: the OR number has no letter (accepted in corrections when an Administrator confirms it, `noLetter`). */
export const isDigitsOnlyOrNumber = (value: string) => /^\d+$/.test(String(value ?? "").trim());
/**
 * Why the OR number is not accepted, or "" when it is. `noLetter`: an Administrator confirmed, in a correction, that
 * the receipt really has no letter (owner, October 28, 2026), so digits only are accepted.
 */
export function orNumberProblem(value: string, { noLetter = false }: { noLetter?: boolean } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return "OR Number is required.";
  if (isValidOrNumber(text) || (noLetter && isDigitsOnlyOrNumber(text))) return "";
  if (/^\d+$/.test(text)) return `OR Number ${text} needs the branch letter at the end (e.g. ${text} C).`;
  return `OR Number ${text} must be digits followed by one letter, e.g. ${OR_NUMBER_EXAMPLE}.`;
}
/** The letter in capitals, as staff write it ("12345 c" → "12345 C"). */
export const normalizeOrNumber = (value: string) => String(value ?? "").trim().replace(/([A-Za-z])$/, (letter) => letter.toUpperCase());
/**
 * The OR number after this one, for the next entry of a Collections batch (owner, October 19, 2026): the number plus
 * one, keeping its letter, the space before it and any leading zeros ("17671 N" → "17672 N", "0099C" → "0100C").
 * "" when the value is not a complete OR number, so nothing is guessed.
 */
export function nextOrNumber(value: string) {
  const match = /^(\d+)(\s?)([A-Za-z])$/.exec(String(value ?? "").trim());
  if (!match) return "";
  const [, digits, space, letter] = match;
  return `${(BigInt(digits) + BigInt(1)).toString().padStart(digits.length, "0")}${space}${letter.toUpperCase()}`;
}
