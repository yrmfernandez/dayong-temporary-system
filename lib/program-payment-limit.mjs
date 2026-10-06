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
