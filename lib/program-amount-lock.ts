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
 * Total amount payable, plus the registration amount on a registration-fee program, so the account is Fully Paid from
 * the start (lib/account-data.ts counts the New Sale, less any registration, toward the total). Only a program with a
 * Total amount payable can take it.
 */
export const cashOnSpotAmount = (program: { registrationFeeRequired: boolean; registrationAmount?: number | null; payBalanceTotal?: number | null }) => {
  const total = Number(program.payBalanceTotal) || 0;
  if (total <= 0) return 0;
  return Math.round((total + (program.registrationFeeRequired ? Number(program.registrationAmount) || 0 : 0)) * 100) / 100;
};
export function cashOnSpotProblem(program: { name: string; registrationFeeRequired: boolean; registrationAmount?: number | null; payBalanceTotal?: number | null }, amount: number) {
  const full = cashOnSpotAmount(program);
  if (!full) return `${program.name} has no Total amount payable in Programs, so it cannot be paid as Cash on spot.`;
  if (Math.round(amount * 100) !== Math.round(full * 100)) return `Cash on spot pays ${program.name} in full: the amount paid must be ${full.toFixed(2)}${program.registrationFeeRequired ? " (registration plus the Total amount payable)" : ""}.`;
  return "";
}

/** The amount a New Sale starts with: as above, but a flexible program's Base Pay instead of its minimum. */
export const defaultNewSaleAmount = (program: { registrationFeeRequired: boolean; registrationAmount: number; basePay: number; flexible?: boolean; flexibleBasePay?: number | null }) =>
  program.registrationFeeRequired ? program.registrationAmount : monthlyPay(program);
