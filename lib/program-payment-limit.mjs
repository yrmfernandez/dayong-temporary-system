/**
 * Null means no monthly maximum. Fixed-payment programs do not use this setting.
 * @param {{ flexible?: unknown, basePay: unknown, maxMonthlyPayment?: unknown }} input
 * @returns {number | null}
 */
export function normalizeMonthlyMaximum(input) {
  if (input.flexible !== true || input.maxMonthlyPayment === null || input.maxMonthlyPayment === undefined || input.maxMonthlyPayment === "") return null;
  const maximum = Number(input.maxMonthlyPayment);
  const minimum = Number(input.basePay);
  if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isFinite(minimum) || maximum < minimum || Math.abs(maximum * 100 - Math.round(maximum * 100)) > 0.0001) {
    throw new Error("Maximum monthly payment must be at least the minimum monthly payment, with at most two decimal places.");
  }
  return Math.round(maximum * 100) / 100;
}

/**
 * Flexible program's Base Pay (owner, November 4, 2026): empty is none, and the minimum is used. Fixed-payment programs
 * do not use this setting.
 * @param {{ flexible?: unknown, basePay: unknown, flexibleBasePay?: unknown, maxMonthlyPayment?: unknown }} input
 * @returns {number | null}
 */
export function normalizeFlexibleBasePay(input) {
  if (input.flexible !== true || input.flexibleBasePay === null || input.flexibleBasePay === undefined || input.flexibleBasePay === "") return null;
  const base = Number(input.flexibleBasePay);
  const minimum = Number(input.basePay);
  const maximum = input.maxMonthlyPayment === null || input.maxMonthlyPayment === undefined || input.maxMonthlyPayment === "" ? null : Number(input.maxMonthlyPayment);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(minimum) || base < minimum || Math.abs(base * 100 - Math.round(base * 100)) > 0.0001) {
    throw new Error("Base Pay must be at least the minimum monthly payment, with at most two decimal places.");
  }
  if (maximum !== null && base > maximum) throw new Error("Base Pay cannot be more than the maximum monthly payment.");
  return Math.round(base * 100) / 100;
}

/**
 * The monthly amount filled in and shown as due: a flexible program's Base Pay when it has one, otherwise basePay (on a
 * flexible program, the minimum). The rules on what may be paid still use the minimum.
 * @param {{ basePay: number, flexible?: boolean | null, flexibleBasePay?: number | null }} program
 * @returns {number}
 */
export const monthlyPay = (program) => (program.flexible && Number(program.flexibleBasePay) > 0 ? Number(program.flexibleBasePay) : program.basePay);

/**
 * A multi-month receipt is divided across its covered months, as in flexible incentive calculations.
 * @param {number} amount
 * @param {number} months
 * @param {boolean} [flexible]
 * @param {number | null} [maximum]
 */
export function validateMonthlyMaximum(amount, months, flexible, maximum) {
  if (flexible && maximum != null && Math.round(amount * 100) > Math.round(maximum * 100) * months) {
    throw new Error(`Pay no more than the maximum of ${maximum.toFixed(2)} per month: ${months} month(s) allows at most ${(Math.round(maximum * 100) * months / 100).toFixed(2)}.`);
  }
}
