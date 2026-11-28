// Cash an Entry Clerk hands to Finance at the office in person (owner, November 24, 2026). It leaves the clerk's cash on
// hand like a bank deposit, so it is kept with them (bank_deposits) with this type of transfer, and the name of who in
// Finance received it in place of the bank account. The clerk report shows it as its own Cash Out line. Pure, so the
// report's form can use it.

/** The type of transfer of cash turned over to Finance in person. */
export const FINANCE_TURNOVER = "Turned over to Finance";

export const isFinanceTurnover = (item: { transferType: string }) => item.transferType === FINANCE_TURNOVER;

/**
 * Remitted whole amount (owner, November 28, 2026: Jenny's cash on hand was ₱13,420.53 after a ₱1,475.47 expense, she
 * remitted ₱13,421, and her Remaining Cash on Hand became −₱0.47). The amount remitted is more than the cash on hand by
 * centavos only: the clerk confirms they rounded up to whole pesos, and the centavos added count as cash in, so the cash
 * on hand ends at zero. Allowed only for a whole-peso amount over by less than ₱1.
 */
export const WHOLE_AMOUNT_MAX = 1;
const cents = (value: number) => Math.round(value * 100);

/** How much an amount remitted is over the cash on hand (0 when not over), in pesos. */
export const remittedOver = (amount: number, remaining: number) => Math.max(0, cents(amount) - cents(remaining)) / 100;

/** True when the over can be accepted as rounding up to the whole amount: a whole-peso amount, over by less than ₱1. */
export const canRemitWholeAmount = (amount: number, over: number) => over > 0 && cents(over) < cents(WHOLE_AMOUNT_MAX) && cents(amount) % 100 === 0;

/** "" when the centavos added are acceptable for this amount, else why not (checked again by the server). */
export function wholeAmountProblem(amount: number, added: number) {
  if (!(added > 0)) return "";
  if (cents(added) >= cents(WHOLE_AMOUNT_MAX)) return "Remitted whole amount is only for centavos (less than ₱1.00). Check your entries, expenses and deposits for a bigger difference.";
  if (cents(amount) % 100 !== 0) return "Remitted whole amount is for a whole-peso amount (no centavos).";
  if (cents(added) >= cents(amount)) return "The centavos added cannot be the whole amount.";
  return "";
}
