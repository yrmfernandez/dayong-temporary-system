/**
 * Cash counted by denomination when a remittance is received. The total is added up by the system instead of by hand,
 * and the count is kept on the slip (Remittances AB cash_count) as text such as "1000x3, 500x1, 20x2".
 */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;
export type CashCount = Partial<Record<(typeof DENOMINATIONS)[number], number>>;

export const cashCountTotal = (count: CashCount) => DENOMINATIONS.reduce((sum, value) => sum + value * (Math.max(0, Math.floor(count[value] ?? 0))), 0);

export const formatCashCount = (count: CashCount) => DENOMINATIONS.filter((value) => (count[value] ?? 0) > 0).map((value) => `${value}x${Math.floor(count[value] ?? 0)}`).join(", ");

/** Reads "1000x3, 500x1"; null when the text is not a valid count. */
export function parseCashCount(text: string): CashCount | null {
  const count: CashCount = {};
  for (const part of text.split(",").map((item) => item.trim()).filter(Boolean)) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    const value = Number(match?.[1]) as (typeof DENOMINATIONS)[number];
    if (!match || !DENOMINATIONS.includes(value) || count[value] !== undefined) return null;
    count[value] = Number(match[2]);
  }
  return count;
}

/** "" when a submitted count is absent or adds up to the amount received, otherwise the problem. */
export function cashCountProblem(text: string, actualAmount: number) {
  if (!text.trim()) return "";
  const count = parseCashCount(text);
  if (!count) return "The cash count could not be read. Count the bills and coins again.";
  const total = cashCountTotal(count);
  return Math.round(total * 100) === Math.round(actualAmount * 100) ? "" : `The counted cash adds up to ₱${total.toLocaleString("en-PH")}, not the ₱${actualAmount.toLocaleString("en-PH")} entered.`;
}
