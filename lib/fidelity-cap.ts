/**
 * The Fidelity lock (owner): contributions have no limit; the first FIDELITY_CAP of an employee's approved balance is
 * locked until they leave the company, and anything above it may be withdrawn at any time. Pure, so the money rule is
 * tested on its own (scripts/test-money-rules.mjs, upgrade #9); lib/fidelity.ts applies it to each employee.
 */
export const FIDELITY_CAP = 10000;

const cents = (value: number) => Math.round(value * 100) / 100;

/** Locked, withdrawable and still-to-lock parts of an approved balance; a separated employee may take all of it. */
export function fidelityStanding(approved: number, separated: boolean) {
  const balance = Math.max(0, cents(approved));
  return {
    locked: cents(Math.min(balance, FIDELITY_CAP)),
    withdrawable: cents(Math.max(0, balance - FIDELITY_CAP)),
    remaining: Math.max(0, cents(FIDELITY_CAP - balance)),
    readyForRelease: separated && balance > 0,
  };
}
