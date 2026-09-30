import { accountState, todayInManila } from "@/lib/account-rules";
import { loadAccountData } from "@/lib/account-data";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: number) => Math.round(value * 100) / 100;

/** Accounts an SOA can be issued for, for the account picker: one row per member program enrollment. */
export async function listStatementAccounts() {
  const data = await loadAccountData();
  return data.accounts.map((account) => ({ id: account.id, memberName: account.memberName, memberNumber: account.memberNumber, programName: account.programName, branch: account.branch, mas: account.mas, doi: account.doi, status: account.storedStatus || "NS" }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
}

/**
 * Statement of Account for one member program enrollment: member and plan details, the New Sale payment, every posted
 * Collection with the months and NOP it covered, and where the account stands today. Status, dues and dates come from
 * the same rules as MAM and Collections (lib/account-rules.ts), so the SOA always agrees with them.
 */
export async function getStatementOfAccount(enrollmentId: string) {
  const [data, extra] = await Promise.all([
    loadAccountData(),
    sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: ["'Members'!A:R", "'Sales'!A:AE"], valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }),
  ]);
  const account = data.accounts.find((item) => item.id === enrollmentId);
  if (!account) throw new Error("Select a member program account.");
  const [members, sales] = extra.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  const member = members.slice(1).find((row) => text(row[0]) === account.memberId) ?? [];
  const sale = sales.slice(1).find((row) => text(row[5]) === account.memberNumber && text(row[21]) === account.programId);
  const today = todayInManila();
  const state = accountState(account, data.payments, today);
  const payments = data.payments.filter((payment) => payment.enrollmentId === account.id).sort((a, b) => a.nopFrom - b.nopFrom || a.orDate.localeCompare(b.orDate));
  let running = 0;
  const history = payments.map((payment) => {
    running = round(running + payment.amount);
    return { orDate: payment.orDate, orNumber: payment.orNumber, monthFrom: payment.monthFrom, monthTo: payment.monthTo, nopFrom: payment.nopFrom, nopTo: payment.nopTo, amount: payment.amount, runningTotal: running };
  });
  const collectionsPaid = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const salePaid = Number(sale?.[26]) || 0;
  return {
    statementDate: today,
    member: {
      name: [text(member[3]), text(member[4]), text(member[2]), text(member[5])].filter(Boolean).join(" ") || account.memberName,
      number: account.memberNumber, contact: text(member[11]), address: text(member[12]), birthdate: text(member[6]).slice(0, 10),
    },
    account: {
      id: account.id, programName: account.programName, programId: account.programId, doi: account.doi, branch: account.branch, mas: account.mas,
      monthlyDue: account.basePay, payBalanceTotal: account.payBalanceTotal, applicationNumber: text(sale?.[28]),
    },
    newSale: sale ? { date: text(sale[30]) || text(sale[1]).slice(0, 10), amount: salePaid, registration: Number(sale[25]) || 0, paymentMode: text(sale[23]) } : null,
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
