import { monthIndex } from "@/lib/account-rules";
import { formatMonth } from "@/lib/date-format";

/**
 * The MAS collection list (owner, October 30, 2026): from a MAM report, the members who still owe this month, most
 * urgent first. Pure, so the money rule is tested on its own (scripts/test-account-rules.mjs).
 *
 * A member owes this month when the next month due (the month after the last one covered) is this month or earlier,
 * and the account is not Advance, Fully Paid or Forfeited. "To collect" covers every month from the next month due
 * through this month, at the monthly rate (the minimum on a flexible program).
 */
type Standing = {
  status: string; temporarilySuspended: boolean; nextMonth: string; monthlyAmount: number;
  lastCoveredMonth: string; forfeitedAt: string; latestOrDate: string; latestOrNumber: string;
};
type Account = { id: string; memberName: string; memberNumber: string; programName: string; current: Standing | null; history: Array<{ orDate: string; amount: number }> };

const NOT_DUE = new Set(["ADV", "Fully Paid", "Forfeited"]);
/** An account this close to its forfeit date is flagged, so the MAS visits it first. */
export const CLOSE_TO_FORFEIT_DAYS = 31;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const cents = (value: number) => Math.round(value * 100) / 100;

export function collectionList<T extends Account>(rows: T[], today: string) {
  const month = today.slice(0, 7);
  const owing = rows.flatMap((row) => {
    const standing = row.current;
    if (!standing || NOT_DUE.has(standing.status) || standing.nextMonth > month) return [];
    const months = monthIndex(month) - monthIndex(standing.nextMonth) + 1;
    const daysToForfeit = daysBetween(today, standing.forfeitedAt);
    return [{
      row, months, from: standing.nextMonth, to: month, toCollect: cents(months * standing.monthlyAmount),
      status: standing.status, waiverNeeded: standing.temporarilySuspended,
      forfeitsOn: standing.forfeitedAt, daysToForfeit, closeToForfeit: daysToForfeit <= CLOSE_TO_FORFEIT_DAYS,
      lastPaid: standing.latestOrDate, lastOr: standing.latestOrNumber,
    }];
  }).sort((a, b) => a.forfeitsOn.localeCompare(b.forfeitsOn) || b.toCollect - a.toCollect || a.row.memberName.localeCompare(b.row.memberName));
  const paidThisMonth = rows.filter((row) => row.history.some((payment) => payment.orDate.slice(0, 7) === month && payment.orDate <= today));
  const collected = cents(rows.reduce((sum, row) => sum + row.history.filter((payment) => payment.orDate.slice(0, 7) === month && payment.orDate <= today).reduce((total, payment) => total + payment.amount, 0), 0));
  return {
    month, owing, toCollect: cents(owing.reduce((sum, item) => sum + item.toCollect, 0)),
    closeToForfeit: owing.filter((item) => item.closeToForfeit).length,
    paidThisMonth: paidThisMonth.length, collected,
    forfeited: rows.filter((row) => row.current?.status === "Forfeited").length,
  };
}

/** "Sep 2026", or "Sep 2026 – Oct 2026" for several months owed. */
export const monthsLabel = (from: string, to: string) => from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;
