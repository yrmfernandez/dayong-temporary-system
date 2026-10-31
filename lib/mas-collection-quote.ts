import { monthIndex, monthName } from "@/lib/account-rules";
import { calculateRemittance, type IncentiveTier } from "@/lib/remittance";

/**
 * What one member's payment brings in when a MAS collects it (Submit Collections, owner, October 31, 2026): the MAS
 * types only how many months the member paid; the months covered, NOP, amount, their incentive and what they hand over
 * follow from the account. Pure, so the page shows exactly what the server stores (lib/collection-submissions.ts).
 */
export const MAX_SUBMISSION_MONTHS = 60;

export type QuoteAccount = { basePay: number; flexible: boolean; maxMonthlyPayment: number | null; nextMonth: string; nextNop: number; tiers: IncentiveTier[] };

export function masCollectionQuote(account: QuoteAccount, months: number) {
  const count = Math.floor(Number(months));
  if (!Number.isInteger(count) || count < 1 || count > MAX_SUBMISSION_MONTHS) throw new Error(`Months paid must be from 1 to ${MAX_SUBMISSION_MONTHS}.`);
  const nopFrom = account.nextNop, nopTo = nopFrom + count - 1;
  const monthFrom = account.nextMonth, monthTo = monthName(monthIndex(monthFrom) + count - 1);
  // Full monthly installments (the minimum on a flexible program); the clerk can still change the amount when saving.
  const amount = Math.round(account.basePay * 100) * count / 100;
  const { remittance } = calculateRemittance(account.basePay, account.tiers, "MAS", nopFrom, nopTo, amount, account.flexible, account.maxMonthlyPayment);
  return { months: count, monthFrom, monthTo, nopFrom, nopTo, amount, incentive: Math.round((amount - remittance) * 100) / 100, remittance };
}
