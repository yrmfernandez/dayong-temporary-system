import { monthlyPay } from "./program-payment-limit.mjs";

/**
 * Program rule: whether encoders may type the amount on a New Sale or a Collection (Programs T
 * new_sale_amount_editable, U collection_amount_editable). FALSE, the default, locks the amount to what the program
 * says, so it cannot be mistyped.
 */
export const isTrue = (value: unknown) => value === true || /^(true|yes)$/i.test(String(value ?? "").trim());

/** Programs T:U cells. Anything but an explicit true is FALSE. */
export const amountEditableCells = (data: { newSaleAmountEditable?: unknown; collectionAmountEditable?: unknown }) =>
  [data.newSaleAmountEditable === true ? "TRUE" : "FALSE", data.collectionAmountEditable === true ? "TRUE" : "FALSE"];

/** The locked New Sale amount: the registration amount, or the first month's base pay when there is no registration fee. */
export const fixedNewSaleAmount = (program: { registrationFeeRequired: boolean; registrationAmount: number; basePay: number }) =>
  program.registrationFeeRequired ? program.registrationAmount : program.basePay;

/**
 * Cash on spot (owner, November 26, 2026; lib/remittance.ts CASH_ON_SPOT_RATE): the New Sale pays the whole program, its
 * Total amount payable, so the account is Fully Paid from the start (lib/account-rules.ts counts the New Sale toward the
 * total). Only a program with a Total amount payable and no registration fee can take it: a registration-fee New Sale
 * pays the registration only and does not count toward the program.
 */
export const cashOnSpotAmount = (program: { registrationFeeRequired: boolean; payBalanceTotal?: number | null }) =>
  !program.registrationFeeRequired && Number(program.payBalanceTotal) > 0 ? Math.round(Number(program.payBalanceTotal) * 100) / 100 : 0;
export function cashOnSpotProblem(program: { name: string; registrationFeeRequired: boolean; payBalanceTotal?: number | null }, amount: number) {
  const full = cashOnSpotAmount(program);
  if (program.registrationFeeRequired) return `${program.name} has a registration fee, so it cannot be paid as Cash on spot.`;
  if (!full) return `${program.name} has no Total amount payable in Programs, so it cannot be paid as Cash on spot.`;
  if (Math.round(amount * 100) !== Math.round(full * 100)) return `Cash on spot pays ${program.name} in full: the amount paid must be ${full.toFixed(2)}.`;
  return "";
}

/** The amount a New Sale starts with: as above, but a flexible program's Base Pay instead of its minimum. */
export const defaultNewSaleAmount = (program: { registrationFeeRequired: boolean; registrationAmount: number; basePay: number; flexible?: boolean; flexibleBasePay?: number | null }) =>
  program.registrationFeeRequired ? program.registrationAmount : monthlyPay(program);
