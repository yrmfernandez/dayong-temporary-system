import { accountState, dateInMonth, monthCount, monthIndex, monthName, paymentsByEnrollment, validMonth, type Account, type AccountPayment } from "@/lib/account-rules";

export type MamAccount = Account & { memberName: string; programName: string; deactivatedOn?: string };
export function monitoringMonths(from: string, to: string) {
  if (!validMonth(from) || !validMonth(to) || from > to || monthCount(from, to) > 120) throw new Error("Choose a valid month range of up to 120 months.");
  return Array.from({ length: monthCount(from, to) }, (_, i) => monthName(monthIndex(from) + i));
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
      if (endedAfter && month > endedAfter) return { month, projected, state: null, error: "", receipts: [], collected: 0, coveredAmount: 0, ended: true };
      const end = month === today.slice(0, 7) ? today : dateInMonth(month, 31);
      const receipts = history.filter((p) => p.orDate.slice(0, 7) === month && p.orDate <= today);
      const collected = receipts.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
      if (account.doi > end) return { month, projected, state: null, error: "", receipts: [], collected: 0, coveredAmount: 0, ended: false };
      try {
        // Historical states must not inherit today's Forfeited carried from the old system.
        // A future column is a projection from receipts already received, never future transactions.
        const state = accountState({ ...account, forfeitHeld: month < today.slice(0, 7) ? false : account.forfeitHeld }, history.filter((p) => p.orDate <= today), end);
        return { month, projected, state, error: "", receipts, collected,
          coveredAmount: state.allocations.find((a) => a.month === month)?.amount ?? 0, ended: false };
      } catch (error) { return { month, projected, state: null, error: error instanceof Error ? error.message : "Review account data.", receipts, collected, coveredAmount: 0, ended: false }; }
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
