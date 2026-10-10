import { validateMonthlyMaximum } from "./program-payment-limit.mjs";

export type AccountStatus = "NS" | "U" | "ADV" | "60D" | "90D" | "120D" | "150D" | "Paid" | "Forfeited";
export type Account = {
  id: string; memberId: string; memberNumber: string; programId: string;
  doi: string; branch: string; mas: string; basePay: number; payBalanceTotal: number; storedStatus: string;
  /**
   * Flexible program: basePay is the minimum monthly payment; a payment may be any amount of at least the minimum per
   * month it covers, and the account is paid off when its collections reach payBalanceTotal.
   */
  flexible?: boolean;
  maxMonthlyPayment?: number | null;
};
export type AccountPayment = {
  id: string; enrollmentId: string; orDate: string; orNumber: string;
  monthFrom: string; monthTo: string; nopFrom: number; nopTo: number;
  amount: number; dateRemitted: string; mas: string;
};

// Made once: building an Intl.DateTimeFormat is slow, and every account's status check asks for today.
const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
export function todayInManila() {
  return manilaDay.format(new Date());
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validMonth(value: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function monthIndex(value: string) { const [y, m] = value.split("-").map(Number); return y * 12 + m - 1; }
export function monthName(index: number) { return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`; }
export function monthCount(from: string, to: string) { return monthIndex(to) - monthIndex(from) + 1; }
export function dateInMonth(month: string, day: number) {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(Math.min(day, new Date(Date.UTC(year, number, 0)).getUTCDate())).padStart(2, "0")}`;
}
export function addMonths(date: string, months: number) {
  return dateInMonth(monthName(monthIndex(date) + months), Number(date.slice(8, 10)));
}
export function addDay(date: string) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Allocations are derived from actual stored ranges, never synthetic collections.
export function allocations(payments: AccountPayment[], basePay?: number, flexible = false) {
  const result = new Map<string, { nop: number; amount: number; paymentId: string }>();
  const nops = new Set<number>();
  for (const payment of payments) {
    const count = monthCount(payment.monthFrom, payment.monthTo);
    if (!validDate(payment.orDate) || !validMonth(payment.monthFrom) || !validMonth(payment.monthTo) || count < 1 || count > 1200 || !Number.isInteger(payment.nopFrom) || payment.nopFrom < 1 || !Number.isInteger(payment.nopTo) || payment.nopTo - payment.nopFrom + 1 !== count || !Number.isFinite(payment.amount) || payment.amount <= 0) {
      throw new Error(`Payment ${payment.id} has invalid dates, amount, or NOP coverage. Review its history.`);
    }
    const cents = Math.round(payment.amount * 100);
    const monthlyCents = basePay ? Math.round(basePay * 100) : cents / count;
    if (Math.abs(payment.amount * 100 - cents) > 0.0001 || !Number.isInteger(monthlyCents) || cents < monthlyCents * count) throw new Error(`Payment ${payment.id} cannot cover its selected full monthly installments.`);
    // Flexible programs: each covered month is credited with its share of what was actually paid (at least the minimum).
    const share = (index: number) => (flexible ? Math.floor(cents / count) + (index < cents % count ? 1 : 0) : monthlyCents) / 100;
    for (let i = 0; i < count; i++) {
      const month = monthName(monthIndex(payment.monthFrom) + i);
      const nop = payment.nopFrom + i;
      if (result.has(month) || nops.has(nop)) throw new Error(`Payment ${payment.id} overlaps existing month or NOP coverage.`);
      result.set(month, { nop, amount: share(i), paymentId: payment.id });
      nops.add(nop);
    }
  }
  return result;
}

/**
 * Payments grouped by enrollment. Reports over every account must look payments up here instead of passing the whole
 * payment list to accountState for each account: that is accounts × payments work (tens of seconds at 10k × 50k).
 */
export function paymentsByEnrollment<T extends { enrollmentId: string }>(payments: T[]) {
  const grouped = new Map<string, T[]>();
  for (const payment of payments) {
    const list = grouped.get(payment.enrollmentId);
    if (list) list.push(payment); else grouped.set(payment.enrollmentId, [payment]);
  }
  return grouped;
}

export function accountState(account: Account, allPayments: AccountPayment[], today = todayInManila()) {
  if (!validDate(account.doi) || !validDate(today) || !Number.isFinite(account.basePay) || account.basePay <= 0) throw new Error(`Account ${account.id} needs a valid DOI and monthly program rate.`);
  const payments = allPayments.filter((p) => p.enrollmentId === account.id && p.orDate <= today);
  const coverage = allocations(payments, account.basePay, account.flexible);
  const months = [...coverage.keys()].sort();
  const lastCoveredMonth = months.at(-1) ?? "";
  const latest = [...payments].sort((a, b) => a.orDate.localeCompare(b.orDate)).at(-1);
  let anchor = latest?.orDate ?? account.doi;
  // Advance coverage extends the clock to DOI's day in its last covered month.
  for (const payment of payments) {
    if (payment.monthTo > payment.orDate.slice(0, 7)) {
      const coveredDate = dateInMonth(payment.monthTo, Number(account.doi.slice(8, 10)));
      if (coveredDate > anchor) anchor = coveredDate;
    }
  }
  const suspendedAt = addMonths(anchor, 2);
  const forfeitedAt = addDay(addMonths(anchor, 6));
  const paid = account.payBalanceTotal > 0 && payments.reduce((sum, payment) => sum + payment.amount, 0) >= account.payBalanceTotal;
  const forfeited = !paid && (account.storedStatus === "Forfeited" || today >= forfeitedAt);
  const temporarilySuspended = !forfeited && today >= suspendedAt;
  const currentMonth = today.slice(0, 7);
  const firstMonth = months[0] ?? account.doi.slice(0, 7);
  if (months.length && monthCount(firstMonth, lastCoveredMonth) !== months.length) throw new Error(`Account ${account.id} has gaps in payment coverage. Review its history.`);
  let unpaidMonths = 0;
  for (let index = monthIndex(firstMonth); index <= monthIndex(currentMonth); index++) {
    if (!coverage.has(monthName(index))) unpaidMonths++;
  }
  let status: AccountStatus = "NS";
  if (paid) status = "Paid";
  else if (forfeited) status = "Forfeited";
  else if (payments.length) {
    status = unpaidMonths === 0 ? (lastCoveredMonth > currentMonth ? "ADV" : "U")
      : (["60D", "90D", "120D", "150D"] as const)[Math.min(unpaidMonths, 4) - 1];
  }
  // The New Sale itself is NOP 1 (the DOI month), so an NS account's first Collection is NOP 2, the month after DOI.
  const nop = Math.max(1, ...[...coverage.values()].map((value) => value.nop));
  const multipliers: Record<AccountStatus, number> = { NS: 1, U: 1, ADV: 0, "60D": 2, "90D": 3, "120D": 4, "150D": 5, Paid: 0, Forfeited: 0 };
  return {
    status, temporarilySuspended, anchor, suspendedAt, forfeitedAt, nop, nextNop: nop + 1,
    lastCoveredMonth, nextMonth: monthName(monthIndex(lastCoveredMonth || account.doi.slice(0, 7)) + 1),
    monthlyAmount: account.basePay, tmd: account.basePay * nop,
    balance: forfeited ? null : account.basePay * multipliers[status],
    unpaidMonths, latestOrDate: latest?.orDate ?? "", latestOrNumber: latest?.orNumber ?? "",
    dateRemitted: latest?.dateRemitted ?? "", allocations: [...coverage].map(([month, value]) => ({ month, ...value })),
  };
}

/** Who brought the payment in. DTO (Direct to Office) is paid at the office and keeps the current (MAS) incentive tier. */
export const COLLECTION_CHANNELS = ["MAS", "Collector", "DTO"] as const;
export type CollectionChannel = (typeof COLLECTION_CHANNELS)[number];
/** MAS collections earn the MAS incentive, Collector collections the Collector incentive, DTO none (owner, October 10, 2026). */
export const incentiveRoleFor = (channel: string): "MAS" | "Collector" | "DTO" => channel === "Collector" ? "Collector" : channel === "DTO" ? "DTO" : "MAS";

export type PaymentInput = { monthFrom: string; monthTo: string; nopFrom: number; nopTo: number; amount: number; orDate: string; orNumber: string; waiver: string; collectedByRole: string; originalMas: string };
export function validatePayment(account: Account, history: AccountPayment[], input: PaymentInput, today = todayInManila()) {
  const state = accountState(account, history, today);
  if (state.status === "Forfeited") throw new Error("This program account is forfeited. Payments are blocked.");
  if (!validDate(input.orDate) || input.orDate > today || input.orDate < account.doi) throw new Error("OR Date must be a valid date between DOI and today.");
  if (state.latestOrDate && input.orDate < state.latestOrDate) throw new Error("OR Date cannot precede the last recorded payment. Review backdated entries separately.");
  const atPayment = accountState(account, history, input.orDate);
  if (atPayment.status === "Forfeited") throw new Error("The account was forfeited on this OR Date.");
  if ((state.temporarilySuspended || atPayment.temporarilySuspended) && input.waiver !== "Waiver") throw new Error("Select Waiver under If Suspended before accepting payment.");
  if (!(COLLECTION_CHANNELS as readonly string[]).includes(input.collectedByRole)) throw new Error("Select whether the collection was made by MAS, Collector, or DTO (Direct to Office).");
  if (!input.orNumber.trim()) throw new Error("OR Number is required.");
  if (history.some((p) => p.enrollmentId === account.id && p.orNumber === input.orNumber)) throw new Error("This receipt is already recorded for the account.");
  if (!validMonth(input.monthFrom) || !validMonth(input.monthTo)) throw new Error("Select valid covered months.");
  const count = monthCount(input.monthFrom, input.monthTo);
  if (count < 1 || count > 1200 || !Number.isInteger(input.nopFrom) || input.nopFrom < 1 || !Number.isInteger(input.nopTo) || input.nopTo - input.nopFrom + 1 !== count) throw new Error("NOP range must match the number of covered months.");
  // NOP is never typed: it always continues from the account (NS starts at 2 because the sale is NOP 1).
  if (input.nopFrom !== state.nextNop) throw new Error(`NOP must start at ${state.nextNop}. Refresh the account history.`);
  if (input.monthFrom !== state.nextMonth) throw new Error(`Payment must begin with ${state.nextMonth}; do not skip unpaid months or repay covered months.`);
  const expected = Math.round(account.basePay * 100) * count;
  const amountCents = Math.round(input.amount * 100);
  const paidBefore = history.filter((payment) => payment.enrollmentId === account.id).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  const payoffCents = Math.round(account.payBalanceTotal * 100);
  if (!Number.isFinite(input.amount) || amountCents < expected) throw new Error(account.flexible ? `Pay at least the minimum of ${(Math.round(account.basePay * 100) / 100).toFixed(2)} per month: ${count} month(s) requires at least ${(expected / 100).toFixed(2)}.` : `Pay full monthly installments: ${count} month(s) requires at least ${(expected / 100).toFixed(2)}.`);
  // Flexible programs take any amount from the minimum up to what is left of the total payable.
  if (account.flexible) {
    validateMonthlyMaximum(input.amount, count, true, account.maxMonthlyPayment);
    if (payoffCents && paidBefore + amountCents > payoffCents) throw new Error(`The amount is more than the remaining program balance of ${Math.max(0, payoffCents - paidBefore) / 100}.`);
  } else if (amountCents > expected && (!payoffCents || paidBefore + amountCents !== payoffCents)) throw new Error(`An amount above the monthly total must exactly pay the remaining program balance of ${Math.max(0, payoffCents - paidBefore) / 100}.`);
  return state;
}
