import { validateMonthlyMaximum } from "./program-payment-limit.mjs";

export type AccountStatus = "NS" | "U" | "ADV" | "60D" | "90D" | "120D" | "150D" | "Fully Paid" | "Forfeited";
/** Every account status, in the order lists and filters show them (Fully Paid was "Paid" until October 27, 2026). */
export const ACCOUNT_STATUSES: readonly AccountStatus[] = ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Fully Paid", "Forfeited"];
export type Account = {
  id: string; memberId: string; memberNumber: string; programId: string;
  doi: string; branch: string; mas: string; basePay: number; payBalanceTotal: number; storedStatus: string;
  /** Forfeited as carried from the old system (member_programs.forfeit_held): holds whatever the receipts say. */
  forfeitHeld?: boolean;
  /** The recorded full payment's date (member_programs.fully_paid_on): from that day the account is Fully Paid. */
  fullyPaidOn?: string;
  /** What the New Sale paid toward the program's months (none on a registration-fee program), for flexible payoffs. */
  saleCredit?: number;
  /**
   * Flexible program: basePay is the minimum monthly payment; a payment may be any amount of at least the minimum per
   * month it covers, and the account is paid off when its collections reach payBalanceTotal.
   */
  flexible?: boolean;
  maxMonthlyPayment?: number | null;
  /** Months without payment before the account is forfeited: 12 for Pay the Balance programs, otherwise 6 (forfeitMonthsFor). */
  forfeitMonths?: number;
  /** The program has a registration fee: its New Sale pays the registration only and is not a NOP (saleNops). */
  registrationFee?: boolean;
};

/**
 * NOPs the New Sale counts (owner, October 21, 2026). Without a registration fee the New Sale pays the first month and is
 * NOP 1, so the first collection is NOP 2. With a registration fee the New Sale pays the registration only, so the first
 * collection is NOP 1. Either way the first collection pays for the month after the DOI: NOP n covers the DOI month plus
 * (n - saleNops) months.
 */
export const saleNops = (account: { registrationFee?: boolean | null }) => (account.registrationFee ? 0 : 1);
export const firstCollectionNop = (account: { registrationFee?: boolean | null }) => saleNops(account) + 1;

/**
 * Forfeiture (owner, October 16, 2026): an account of a program in the Pay the Balance category is still not forfeited
 * up to and including 12 months after its anchor (the last payment, or the DOI day of an advance's last month); every
 * other account up to and including 6 months. It is forfeited the day after.
 */
export const PAY_THE_BALANCE_CATEGORY_ID = "CAT-PAY-THE-BALANCE";
export const forfeitMonthsFor = (categoryId: string | null | undefined, categoryName = "") =>
  categoryId === PAY_THE_BALANCE_CATEGORY_ID || categoryName.trim().toLowerCase() === "pay the balance" ? 12 : 6;

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
  /*
   * Everything counts from "Month of" on the OR date's day (owner, October 24, 2026, the October 17 rule extended to
   * Forfeited): the account is paid through the last covered month on the day of the last payment's OR date, and each
   * later month falls due on that day and is missed the day after (owner, October 28, 2026). Paid October 10 for July:
   * paid through July 10, so one month missed August 11, 60D and temporarily suspended (Waiver needed) September 11, 90D
   * October 11, 120D November 11, 150D December 11, and Forfeited the day after six months (January 11), or twelve for
   * Pay the Balance programs (forfeitMonthsFor).
   * An advance counts the same way from its last covered month. Before any collection the New Sale covers the DOI month
   * on the DOI day. Days past the end of a short month fall on its last day. `anchor` (the last OR date, or the DOI day
   * of an advance's last covered month) is still reported but no longer moves any status.
   */
  const lastPaidMonth = lastCoveredMonth || account.doi.slice(0, 7);
  const payDay = Number((latest?.orDate ?? account.doi).slice(8, 10));
  // The k-th month after the last covered one falls due on this day (k = 0: the paid-through date), clamped to short
  // months. It is missed the day after (owner, October 28, 2026: last payment on the 10th, 60D on the 11th), as
  // Forfeited already was.
  const dueOn = (k: number) => dateInMonth(monthName(monthIndex(lastPaidMonth) + k), payDay);
  const paidThrough = dueOn(0);
  let missedMonths = Math.max(0, monthIndex(today) - monthIndex(lastPaidMonth));
  if (missedMonths > 0 && dueOn(missedMonths) >= today) missedMonths--;
  const suspendedAt = addDay(dueOn(2));
  const forfeitedAt = addDay(dueOn(account.forfeitMonths ?? 6));
  // Fully Paid (owner, October 27, 2026): a recorded full payment (certificate, old Fully Paid list, or entered by hand),
  // or the program completed: its months reach the term (fixed programs: Pay Balance Total ÷ rate, e.g. 25,200 ÷ 420 =
  // 60; the New Sale is NOP 1 without a registration fee) or what was received (New Sale included) reaches the total. Before, only collections were added up, so a term program was never shown paid.
  const coveredNop = Math.max(saleNops(account), ...[...coverage.values()].map((value) => value.nop));
  const termMonths = !account.flexible && account.payBalanceTotal > 0 && account.basePay > 0 ? Math.round(account.payBalanceTotal / account.basePay) : 0;
  const received = payments.reduce((sum, payment) => sum + payment.amount, 0) + (account.saleCredit ?? 0);
  // Either way completes it: the months reach the term, or what was received reaches the total (a lump payment that
  // exactly pays the balance, or a flexible program).
  const completed = account.payBalanceTotal > 0 && ((termMonths > 0 && coveredNop >= termMonths) || Math.round(received * 100) >= Math.round(account.payBalanceTotal * 100));
  const paid = Boolean(account.fullyPaidOn && validDate(account.fullyPaidOn) && account.fullyPaidOn <= today) || completed;
  // A Forfeited carried from the old system holds (forfeitHeld), except on Pay the Balance programs: they wait the full
  // 12 months before being declared forfeited, whatever was stored under the old 6-month rule (owner, October 16, 2026).
  // The stored status itself never holds (October 26, 2026): it is what the app last worked out (the nightly job stores
  // it), so holding it kept an account Forfeited after its receipts were corrected (PH-73684484).
  const keepsStoredForfeit = (account.forfeitMonths ?? 6) <= 6;
  const forfeited = !paid && ((keepsStoredForfeit && account.forfeitHeld === true) || today >= forfeitedAt);
  const temporarilySuspended = !forfeited && today >= suspendedAt;
  const currentMonth = today.slice(0, 7);
  const firstMonth = months[0] ?? account.doi.slice(0, 7);
  if (months.length && monthCount(firstMonth, lastCoveredMonth) !== months.length) throw new Error(`Account ${account.id} has gaps in payment coverage. Review its history.`);
  const unpaidMonths = missedMonths;
  let status: AccountStatus = "NS";
  if (paid) status = "Fully Paid";
  else if (forfeited) status = "Forfeited";
  else if (payments.length) {
    status = lastCoveredMonth > currentMonth ? "ADV"
      : unpaidMonths <= 1 ? "U" : (["60D", "90D", "120D", "150D"] as const)[Math.min(unpaidMonths, 5) - 2];
  }
  // Without a registration fee the New Sale is NOP 1 (the DOI month), so an NS account's first Collection is NOP 2, the
  // month after DOI; with one the New Sale is no NOP and the first Collection is NOP 1 (saleNops).
  const nop = coveredNop;
  // Amount due: the missed months (U one, 60D two, 90D three, 120D four, 150D five, as before October 12), or the next
  // month when none is missed yet.
  const dueNow = status === "NS" ? 1 : status === "ADV" || status === "Fully Paid" ? 0 : Math.max(1, Math.min(unpaidMonths, 5));
  return {
    status, temporarilySuspended, anchor, paidThrough, suspendedAt, forfeitedAt, nop, nextNop: nop + 1,
    lastCoveredMonth, nextMonth: monthName(monthIndex(lastCoveredMonth || account.doi.slice(0, 7)) + 1),
    monthlyAmount: account.basePay, tmd: account.basePay * nop,
    balance: forfeited ? null : account.basePay * dueNow,
    unpaidMonths, latestOrDate: latest?.orDate ?? "", latestOrNumber: latest?.orNumber ?? "",
    dateRemitted: latest?.dateRemitted ?? "", allocations: [...coverage].map(([month, value]) => ({ month, ...value })),
  };
}

/** Who brought the payment in. DTO (Direct to Office) is paid at the office and keeps the current (MAS) incentive tier. */
export const COLLECTION_CHANNELS = ["MAS", "Collector", "DTO"] as const;
export type CollectionChannel = (typeof COLLECTION_CHANNELS)[number];
/** MAS collections earn the MAS incentive, Collector collections the Collector incentive, DTO none (owner, October 10, 2026). */
export const incentiveRoleFor = (channel: string): "MAS" | "Collector" | "DTO" => channel === "Collector" ? "Collector" : channel === "DTO" ? "DTO" : "MAS";

/**
 * Days (Manila) when payments may be entered on forfeited accounts (owner, October 13, 2026: "just today"). On any other
 * day a forfeited account takes no payment. Add a day here only on the owner's instruction.
 */
export const FORFEITED_PAYMENT_DAYS: readonly string[] = ["2026-10-13"];
export const forfeitedPaymentsAllowed = (today = todayInManila()) => FORFEITED_PAYMENT_DAYS.includes(today);

export type PaymentInput = { monthFrom: string; monthTo: string; nopFrom: number; nopTo: number; amount: number; orDate: string; orNumber: string; waiver: string; collectedByRole: string; originalMas: string };
export function validatePayment(account: Account, history: AccountPayment[], input: PaymentInput, today = todayInManila()) {
  const state = accountState(account, history, today);
  const forfeitedAllowed = forfeitedPaymentsAllowed(today);
  if (state.status === "Fully Paid") throw new Error("This program account is fully paid. No more payments are taken.");
  if (state.status === "Forfeited" && !forfeitedAllowed) throw new Error("This program account is forfeited. Payments are blocked.");
  if (!validDate(input.orDate) || input.orDate > today || input.orDate < account.doi) throw new Error("OR Date must be a valid date between DOI and today.");
  if (state.latestOrDate && input.orDate < state.latestOrDate) throw new Error("OR Date cannot precede the last recorded payment. Review backdated entries separately.");
  const atPayment = accountState(account, history, input.orDate);
  if (atPayment.status === "Forfeited" && !forfeitedAllowed) throw new Error("The account was forfeited on this OR Date.");
  // Suspension is judged on the OR date, the day the member paid, not the day it is encoded (owner, October 14, 2026: an
  // August payment made in September and encoded in October needs no Waiver). Forfeiture above is still judged today.
  if (atPayment.temporarilySuspended && input.waiver !== "Waiver") throw new Error("Select Waiver under If Suspended before accepting payment.");
  if (!(COLLECTION_CHANNELS as readonly string[]).includes(input.collectedByRole)) throw new Error("Select whether the collection was made by MAS, Collector, or DTO (Direct to Office).");
  if (!input.orNumber.trim()) throw new Error("OR Number is required.");
  if (history.some((p) => p.enrollmentId === account.id && p.orNumber === input.orNumber)) throw new Error("This receipt is already recorded for the account.");
  if (!validMonth(input.monthFrom) || !validMonth(input.monthTo)) throw new Error("Select valid covered months.");
  const count = monthCount(input.monthFrom, input.monthTo);
  if (count < 1 || count > 1200 || !Number.isInteger(input.nopFrom) || input.nopFrom < 1 || !Number.isInteger(input.nopTo) || input.nopTo - input.nopFrom + 1 !== count) throw new Error("NOP range must match the number of covered months.");
  // NOP is never typed: it always continues from the account (NS starts at 2, or 1 on a registration-fee program).
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
