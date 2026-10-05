import { accountState, todayInManila } from "@/lib/account-rules";
import { accountReport, loadAccountData } from "@/lib/account-data";
import { and, asc, eq } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Accounts an SOA can be issued for, for the account picker: one row per member program enrollment, with today's
 * status from the same rules as MAM (not the last synchronized one), so the picker can be filtered by standing.
 */
export async function listStatementAccounts() {
  const report = await accountReport();
  return report.rows.map((account) => ({
    id: account.id, memberName: account.memberName, memberNumber: account.memberNumber, programName: account.programName, branch: account.branch, mas: account.mas, doi: account.doi,
    status: "status" in account ? account.status : "Needs review",
    temporarilySuspended: "temporarilySuspended" in account ? account.temporarilySuspended : false,
  })).sort((a, b) => a.memberName.localeCompare(b.memberName));
}

/**
 * Statement of Account for one member program enrollment: member and plan details, the New Sale payment, every posted
 * Collection with the months and NOP it covered, and where the account stands today. Status, dues and dates come from
 * the same rules as MAM and Collections (lib/account-rules.ts), so the SOA always agrees with them.
 */
export async function getStatementOfAccount(enrollmentId: string) {
  const data = await loadAccountData({ enrollmentIds: [enrollmentId] });
  const account = data.accounts.find((item) => item.id === enrollmentId);
  if (!account) throw new Error("Select a member program account.");
  const db = currentDb();
  const [[member], [sale]] = await Promise.all([
    db.select().from(schema.members).where(eq(schema.members.member_id, account.memberId)),
    db.select().from(schema.sales).where(and(eq(schema.sales.member_number, account.memberNumber), eq(schema.sales.program_id, account.programId))).orderBy(asc(schema.sales.date_created)).limit(1),
  ]);
  const today = todayInManila();
  const own = data.payments.filter((payment) => payment.enrollmentId === account.id);
  const state = accountState(account, own, today);
  const payments = [...own].sort((a, b) => a.nopFrom - b.nopFrom || a.orDate.localeCompare(b.orDate));
  let running = 0;
  const history = payments.map((payment) => {
    running = round(running + payment.amount);
    return { orDate: payment.orDate, orNumber: payment.orNumber, monthFrom: payment.monthFrom, monthTo: payment.monthTo, nopFrom: payment.nopFrom, nopTo: payment.nopTo, amount: payment.amount, runningTotal: running };
  });
  const collectionsPaid = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const salePaid = sale?.amount_paid ?? 0;
  return {
    statementDate: today,
    member: {
      name: [text(member?.first_name), text(member?.middle_name), text(member?.surname), text(member?.name_extension)].filter(Boolean).join(" ") || account.memberName,
      number: account.memberNumber, contact: text(member?.member_contact), address: text(member?.address), birthdate: member?.birthdate ?? "",
    },
    account: {
      id: account.id, programName: account.programName, programId: account.programId, doi: account.doi, branch: account.branch, mas: account.mas,
      monthlyDue: account.basePay, payBalanceTotal: account.payBalanceTotal, applicationNumber: text(sale?.application_no),
    },
    newSale: sale ? { date: sale.or_date || text(sale.date_created).slice(0, 10), amount: salePaid, registration: sale.registration_amount ?? 0, paymentMode: text(sale.payment_method) } : null,
    history,
    summary: {
      status: state.status, temporarilySuspended: state.temporarilySuspended,
      monthsPaid: state.nop, lastCoveredMonth: state.lastCoveredMonth, nextMonth: state.nextMonth, nextNop: state.nextNop,
      unpaidMonths: state.unpaidMonths, amountDue: state.balance, suspendedAt: state.suspendedAt, forfeitedAt: state.forfeitedAt,
      totalPaid: round(salePaid + collectionsPaid), collectionsPaid,
      // Remaining toward the program's pay-the-balance total, when the program has one.
      remainingBalance: account.payBalanceTotal > 0 ? Math.max(0, round(account.payBalanceTotal - collectionsPaid)) : null,
    },
  };
}
export type StatementOfAccount = Awaited<ReturnType<typeof getStatementOfAccount>>;
