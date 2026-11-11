import { monthIndex, monthName } from "@/lib/account-rules";
import { monthlyPay } from "@/lib/program-payment-limit.mjs";
import { calculateRemittance, type IncentiveTier } from "@/lib/remittance";

/**
 * What one member's payment brings in when a MAS collects it (Submit Collections, owner, October 31, 2026): the MAS
 * types only how many months the member paid; the months covered, NOP, amount, their incentive and what they hand over
 * follow from the account. Pure, so the page shows exactly what the server stores (lib/collection-submissions.ts).
 */
export const MAX_SUBMISSION_MONTHS = 60;
/** Members in one submit, all branches together. */
export const MAX_SUBMISSION_ENTRIES = 30;

export type QuoteAccount = { basePay: number; flexible: boolean; maxMonthlyPayment: number | null; flexibleBasePay?: number | null; nextMonth: string; nextNop: number; tiers: IncentiveTier[] };

/**
 * Who collects (owner, November 3, 2026): the MAS (MAS tier) or a Collector collecting another MAS's members (Collector
 * tier; with ORC the Collector earns half of the MAS incentive instead), as the Collections save works it out. A
 * Collector's batch marked DTO (owner, November 11, 2026) earns no incentive: the whole amount is remitted, and ORC is off.
 */
export type QuoteCollector = { role: "MAS" | "Collector"; orc: boolean; dto?: boolean };
/** The channel the payment is saved under: a Collector's batch marked DTO (owner, November 11, 2026) earns nothing. */
export const quoteChannel = (collector: QuoteCollector) => collector.role === "Collector" && collector.dto === true ? "DTO" as const : collector.role;

/**
 * `amountPaid`: what the member paid, typed by the MAS on a flexible program (owner, November 3, 2026), at least the minimum
 * per month and at most the program's monthly maximum; left out (or on a fixed program) it is the full monthly amount, on a
 * flexible program its Base Pay when it has one.
 */
export function masCollectionQuote(account: QuoteAccount, months: number, collector: QuoteCollector = { role: "MAS", orc: false }, amountPaid?: number | null) {
  const count = Math.floor(Number(months));
  if (!Number.isInteger(count) || count < 1 || count > MAX_SUBMISSION_MONTHS) throw new Error(`Months paid must be from 1 to ${MAX_SUBMISSION_MONTHS}.`);
  const nopFrom = account.nextNop, nopTo = nopFrom + count - 1;
  const monthFrom = account.nextMonth, monthTo = monthName(monthIndex(monthFrom) + count - 1);
  // Full monthly installments, or on a flexible program what the MAS typed; the clerk can still change it when saving.
  const installments = Math.round(monthlyPay(account) * 100) * count / 100;
  const typed = account.flexible && amountPaid != null ? Number(amountPaid) : null;
  if (typed !== null && !(Number.isFinite(typed) && typed > 0)) throw new Error("Type the amount the member paid.");
  const amount = typed === null ? installments : Math.round(typed * 100) / 100;
  const { remittance } = calculateRemittance(account.basePay, account.tiers, quoteChannel(collector), nopFrom, nopTo, amount, account.flexible, account.maxMonthlyPayment, { orc: quoteChannel(collector) === "Collector" && collector.orc });
  return { months: count, monthFrom, monthTo, nopFrom, nopTo, amount, incentive: Math.round((amount - remittance) * 100) / 100, remittance };
}
