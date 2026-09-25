import { accountState, dateInMonth, monthCount, monthIndex, monthName, validMonth, type Account, type AccountPayment } from "@/lib/account-rules";

export type MamAccount = Account & { memberName: string; programName: string; rowNumber: number };
export function monitoringMonths(from: string, to: string) {
  if (!validMonth(from) || !validMonth(to) || from > to || monthCount(from, to) > 120) throw new Error("Choose a valid month range of up to 120 months.");
  return Array.from({ length: monthCount(from, to) }, (_, i) => monthName(monthIndex(from) + i));
}

export function buildMamReport(data: { accounts: MamAccount[]; payments: AccountPayment[]; sales: { memberNumber: string; programId: string; applicationNumber: string; registrationFee: number }[] }, from: string, to: string, today: string) {
  const months = monitoringMonths(from, to);
  const rows = data.accounts.filter((a) => !a.doi || a.doi.slice(0, 7) <= to).map((account) => {
    const history = data.payments.filter((p) => p.enrollmentId === account.id).sort((a, b) => a.orDate.localeCompare(b.orDate));
    const sale = data.sales.find((s) => s.memberNumber === account.memberNumber && s.programId === account.programId);
    const periods = months.map((month) => {
      const projected = month > today.slice(0, 7);
      const end = month === today.slice(0, 7) ? today : dateInMonth(month, 31);
      const receipts = history.filter((p) => p.orDate.slice(0, 7) === month && p.orDate <= today);
      const collected = receipts.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
      if (account.doi > end) return { month, projected, state: null, error: "", receipts: [], collected: 0, coveredAmount: 0 };
      try {
        // Historical states must not inherit today's persisted Forfeited marker.
        // A future column is a projection from receipts already received, never future transactions.
        const state = accountState({ ...account, storedStatus: month < today.slice(0, 7) ? "" : account.storedStatus }, history.filter((p) => p.orDate <= today), end);
        return { month, projected, state, error: "", receipts, collected,
          coveredAmount: state.allocations.find((a) => a.month === month)?.amount ?? 0 };
      } catch (error) { return { month, projected, state: null, error: error instanceof Error ? error.message : "Review account data.", receipts, collected, coveredAmount: 0 }; }
    });
    return { ...account, applicationNumber: sale?.applicationNumber ?? "", registrationFee: sale?.registrationFee ?? 0, periods, history };
  });
  return { today, from, to, months, rows };
}
