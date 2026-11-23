import { roundMoney } from "./money.ts";
/**
 * The Fidelity base (owner, October 30, 2026): contributions have no limit and nothing is locked. The first FIDELITY_CAP
 * of an employee's approved balance is the base, withdrawn by a percentage or a fixed amount; anything above it is the
 * excess, withdrawn on its own; or the whole balance is withdrawn at once. Pure, so the money rule is tested on its own
 * (scripts/test-money-rules.mjs, upgrade #9); lib/fidelity.ts applies it to each employee.
 */
export const FIDELITY_CAP = 10000;

/** Base (the first FIDELITY_CAP), excess (above it) and still-to-reach-the-base parts of an approved balance. */
export function fidelityStanding(approved: number) {
  const balance = Math.max(0, roundMoney(approved));
  return {
    base: roundMoney(Math.min(balance, FIDELITY_CAP)),
    excess: roundMoney(Math.max(0, balance - FIDELITY_CAP)),
    remaining: Math.max(0, roundMoney(FIDELITY_CAP - balance)),
  };
}

/**
 * The amount of a base withdrawal: a percentage of the base the employee holds now, or a fixed amount. Never more
 * than the base; null when the entry is not a usable amount.
 */
export function baseWithdrawalAmount(base: number, mode: string, value: number) {
  if (!(value > 0)) return null;
  const paid = mode === "percent" ? (value <= 100 ? roundMoney((base * value) / 100) : null) : mode === "fixed" ? roundMoney(value) : null;
  return paid !== null && paid > 0 && paid <= base ? paid : null;
}
