import { accountState, dateInMonth, monthCount, monthIndex, monthName, paymentsByEnrollment, validMonth, type Account, type AccountPayment } from "@/lib/account-rules";

export type MamAccount = Account & { memberName: string; programName: string; deactivatedOn?: string };
export function monitoringMonths(from: string, to: string) {
  if (!validMonth(from) || !validMonth(to) || from > to || monthCount(from, to) > 120) throw new Error("Choose a valid month range of up to 120 months.");
  return Array.from({ length: monthCount(from, to) }, (_, i) => monthName(monthIndex(from) + i));
}

const cents = (value: number) => Math.round(value * 100);

/**
 * The month's fixed quota for one account (owner, November 5, 2026): what its status would make due by the month's end
 * if no payment came in that month, so payments never change it. Back months follow the status, as Amount Due does: U
 * one month, 60D two, 90D three, 120D four, 150D five. Nothing when the month is already covered (paid ahead, or the
 * New Sale's own month), and nothing once Fully Paid or Forfeited. An account forfeiting during the month still owed it
 * when the month began. `before` is the receipts of earlier months.
 */
function monthQuota(account: Account, before: AccountPayment[], month: string) {
  const atEnd = accountState(account, before, dateInMonth(month, 31));
  if ((atEnd.lastCoveredMonth || account.doi.slice(0, 7)) >= month) return 0;
  if (atEnd.balance !== null) return atEnd.balance;
  const atStart = accountState(account, before, dateInMonth(monthName(monthIndex(month) - 1), 31));
  return atStart.balance === null ? 0 : atStart.monthlyAmount * Math.min(atStart.unpaidMonths + 1, 5);
}

/** What a receipt paid for this month or earlier; the part paid ahead is left out, shared by months covered. */
function paidUpTo(receipt: AccountPayment, month: string) {
  if (!validMonth(receipt.monthFrom) || !validMonth(receipt.monthTo) || receipt.monthTo <= month) return receipt.amount;
  if (receipt.monthFrom > month) return 0;
  return receipt.amount * monthCount(receipt.monthFrom, month) / monthCount(receipt.monthFrom, receipt.monthTo);
}

type QuotaPeriod = { quota: number; quotaCollected: number; ended: boolean; state: unknown; collected: number };

/**
 * MAM's quota figures for any set of rows, in one place for the page, the print and the CSV. Per month: `quota` fixed,
 * `counted` the collections that pay it down (never more than an account's quota, so an advance cannot hide someone
 * else's shortfall), `remaining` quota less counted, account by account, and `collected` everything received.
 * For the range, a month still unpaid is not counted again in the next month's quota: the range's quota is what was
 * counted over its months plus what is still open at each account's last month.
 */
export function mamQuotaTotals(rows: Array<{ periods: QuotaPeriod[] }>) {
  const months = rows[0]?.periods.map((_, index) => {
    const sum = (pick: (period: QuotaPeriod) => number) => rows.reduce((total, row) => total + cents(pick(row.periods[index])), 0) / 100;
    const quota = sum((period) => period.quota), counted = sum((period) => period.quotaCollected);
    return { quota, counted, remaining: Math.round((quota - counted) * 100) / 100, collected: sum((period) => period.collected) };
  }) ?? [];
  const remaining = rows.reduce((total, row) => {
    const last = row.periods.findLast((period) => period.state && !period.ended);
    return total + (last ? cents(last.quota) - cents(last.quotaCollected) : 0);
  }, 0) / 100;
  const counted = months.reduce((total, month) => total + cents(month.counted), 0) / 100;
  return { months, last: months.at(-1) ?? null, quota: Math.round((counted + remaining) * 100) / 100, counted, remaining };
}

export function buildMamReport(data: { accounts: MamAccount[]; payments: AccountPayment[]; sales: { memberNumber: string; programId: string; applicationNumber: string; registrationFee: number }[] }, from: string, to: string, today: string) {
  const months = monitoringMonths(from, to);
  // Grouped once, so each account looks up its own payments and sale instead of scanning every row.
  const byEnrollment = paymentsByEnrollment(data.payments);
  const salesByAccount = new Map<string, (typeof data.sales)[number]>();
  for (const sale of data.sales) if (!salesByAccount.has(`${sale.memberNumber}\u0000${sale.programId}`)) salesByAccount.set(`${sale.memberNumber}\u0000${sale.programId}`, sale);
  const rows = data.accounts.filter((a) => !a.doi || a.doi.slice(0, 7) <= to).map((account) => {
    const history = [...(byEnrollment.get(account.id) ?? [])].sort((a, b) => a.orDate.localeCompare(b.orDate));
    const sale = salesByAccount.get(`${account.memberNumber}\u0000${account.programId}`);
    // Deactivated (dropped out, deceased, entered by mistake): counted up to that month, ended after it, no quota.
    const endedAfter = account.deactivatedOn ? account.deactivatedOn.slice(0, 7) : "";
    const periods = months.map((month) => {
      const projected = month > today.slice(0, 7);
      if (endedAfter && month > endedAfter) return { month, projected, state: null, error: "", receipts: [], collected: 0, coveredAmount: 0, quota: 0, quotaCollected: 0, ended: true };
      const end = month === today.slice(0, 7) ? today : dateInMonth(month, 31);
      const receipts = history.filter((p) => p.orDate.slice(0, 7) === month && p.orDate <= today);
      const collected = receipts.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
      if (account.doi > end) return { month, projected, state: null, error: "", receipts: [], collected: 0, coveredAmount: 0, quota: 0, quotaCollected: 0, ended: false };
      try {
        // Historical states must not inherit today's Forfeited carried from the old system.
        // A future column is a projection from receipts already received, never future transactions.
        const asOfMonth = { ...account, forfeitHeld: month < today.slice(0, 7) ? false : account.forfeitHeld };
        const state = accountState(asOfMonth, history.filter((p) => p.orDate <= today), end);
        const quota = monthQuota(asOfMonth, history.filter((p) => p.orDate.slice(0, 7) < month && p.orDate <= today), month);
        const quotaCollected = Math.min(quota, receipts.reduce((sum, receipt) => sum + cents(paidUpTo(receipt, month)), 0) / 100);
        return { month, projected, state, error: "", receipts, collected, quota, quotaCollected,
          coveredAmount: state.allocations.find((a) => a.month === month)?.amount ?? 0, ended: false };
      } catch (error) { return { month, projected, state: null, error: error instanceof Error ? error.message : "Review account data.", receipts, collected, coveredAmount: 0, quota: 0, quotaCollected: 0, ended: false }; }
    });
    // Today's standing whatever the month range: the MAS collection list and the member payment card read it.
    let current: ReturnType<typeof accountState> | null = null, currentError = "";
    // A deactivated account has no standing today: it is off the collection list.
    if (!account.deactivatedOn) try { current = accountState(account, history.filter((p) => p.orDate <= today), today); }
    catch (error) { currentError = error instanceof Error ? error.message : "Review account data."; }
    return { ...account, applicationNumber: sale?.applicationNumber ?? "", registrationFee: sale?.registrationFee ?? 0, periods, history, current, currentError };
  });
  return { today, from, to, months, rows };
}
