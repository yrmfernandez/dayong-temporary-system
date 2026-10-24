import { inTransaction } from "@/lib/db";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { createCashTransaction } from "@/lib/finance-data";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";

const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.round(Number(value) * 100) / 100;
const date = /^\d{4}-\d{2}-\d{2}$/;
const rows = async (range: string) => (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" })).data.values ?? [];
const rowOf = (data: unknown[][], id: string) => { const index = data.slice(1).findIndex((row) => text(row[0]) === id); if (index < 0) throw new Error("Record not found."); return index + 2; };

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/**
 * Money paid out from a finance page also leaves the cash ledger (owner, October 24, 2026; upgrade #3): the cash account
 * and branch it was paid from, and the day, default today. Checked before anything is saved.
 */
export async function cashOutDetails(input: { account?: unknown; branch?: unknown; date?: unknown }, fallbackBranch = "") {
  const account = text(input.account), branch = text(input.branch) || text(fallbackBranch), paidOn = text(input.date) || manilaToday();
  if (!(await getCashAccounts()).some((item) => item.name === account && item.status === "active")) throw new Error("Choose the cash account it was paid from.");
  if (!branch) throw new Error("Choose the branch it is charged to.");
  if (!date.test(paidOn) || paidOn > manilaToday()) throw new Error("Enter the payment date (today or earlier).");
  return { account, branch, date: paidOn };
}

export async function getCashAccounts() {
  return (await rows("'Cash Accounts'!A:E")).slice(1).filter((row) => text(row[0])).map((row) => ({ id: text(row[0]), name: text(row[1]), type: text(row[2]), openingBalance: Number(row[3]) || 0, status: text(row[4]) || "active" }));
}

export async function saveCashAccount(input: Record<string, unknown>) {
  const name = text(input.name), type = text(input.type), openingBalance = money(input.openingBalance), status = text(input.status) === "inactive" ? "inactive" : "active";
  if (!name || !type || !Number.isFinite(openingBalance)) throw new Error("Account name, type, and opening balance are required.");
  const existing = await getCashAccounts();
  if (existing.some((account) => account.name.toLowerCase() === name.toLowerCase() && account.id !== text(input.id))) throw new Error("Cash account name already exists.");
  const id = text(input.id);
  if (id) {
    const data = await rows("'Cash Accounts'!A:E"), rowNumber = rowOf(data, id);
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Cash Accounts'!A${rowNumber}:E${rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[id, name, type, openingBalance, status]] } });
    return { id };
  }
  const created = createReadableId("CAC");
  await appendEncodedRows({ range: "'Cash Accounts'!A:E", requestBody: { values: [[created, name, type, openingBalance, status]] } });
  return { id: created };
}

export async function getVendorPayables() {
  return (await rows("'Vendor Payables'!A:O")).slice(1).filter((row) => text(row[0])).map((row, index) => ({ id: text(row[0]), rowNumber: index + 2, invoiceDate: text(row[1]), dueDate: text(row[2]), vendor: text(row[3]), category: text(row[4]), description: text(row[5]), amount: Number(row[6]) || 0, amountPaid: Number(row[7]) || 0, balance: Number(row[8]) || 0, branch: text(row[9]), status: text(row[10]), referenceNumber: text(row[11]), remarks: text(row[12]), paidAt: text(row[13]), paymentAccount: text(row[14]) }));
}

export async function createVendorPayable(input: Record<string, unknown>) {
  const total = money(input.amount);
  if (!date.test(text(input.invoiceDate)) || !date.test(text(input.dueDate)) || !text(input.vendor) || !text(input.description) || !text(input.branch) || !Number.isFinite(total) || total <= 0) throw new Error("Complete the vendor, dates, branch, description, and amount.");
  const id = createReadableId("PAY");
  await appendEncodedRows({ range: "'Vendor Payables'!A:O", requestBody: { values: [[id, text(input.invoiceDate), text(input.dueDate), text(input.vendor), text(input.category), text(input.description), total, 0, total, text(input.branch), "Outstanding", text(input.referenceNumber), text(input.remarks), "", ""]] } });
  return { id };
}

/** Records a payment on a vendor bill and its cash outflow together: both are saved or neither is. */
export async function payVendorPayable(id: string, paid: unknown, input: { account?: unknown; date?: unknown; reference?: unknown }) {
  const data = await rows("'Vendor Payables'!A:O"), rowNumber = rowOf(data, id), row = data[rowNumber - 1];
  const total = Number(row[6]) || 0, current = Number(row[7]) || 0, payment = money(paid);
  if (!Number.isFinite(payment) || payment <= 0 || payment > total - current) throw new Error("Payment must be greater than zero and cannot exceed the balance.");
  const cash = await cashOutDetails(input, text(row[9]));
  const amountPaid = Math.round((current + payment) * 100) / 100, balance = Math.round((total - amountPaid) * 100) / 100, status = balance === 0 ? "Paid" : "Partially Paid";
  const cashId = await inTransaction(async () => {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: [
      { range: `'Vendor Payables'!H${rowNumber}:K${rowNumber}`, values: [[amountPaid, balance, row[9], status]] },
      { range: `'Vendor Payables'!N${rowNumber}:O${rowNumber}`, values: [[new Date().toISOString(), cash.account]] },
    ] } });
    return (await createCashTransaction({ date: cash.date, direction: "outflow", category: "Vendor payment", description: `${text(row[3])}: ${text(row[5])}${status === "Paid" ? "" : " (partial)"}`,
      amount: payment, branch: cash.branch, account: cash.account, referenceType: "Vendor Payable", referenceId: id, remarks: text(input.reference) || text(row[11]) })).id;
  });
  return { id, balance, status, cashTransactionId: cashId };
}

export async function getCommissions() {
  return (await rows("Commissions!A:L")).slice(1).filter((row) => text(row[0])).map((row, index) => ({ id: text(row[0]), rowNumber: index + 2, employeeId: text(row[1]), employeeName: text(row[2]), periodFrom: text(row[3]), periodTo: text(row[4]), grossIncentive: Number(row[5]) || 0, fidelityDeduction: Number(row[6]) || 0, netCommission: Number(row[7]) || 0, status: text(row[8]), paidAt: text(row[9]), referenceNumber: text(row[10]), remarks: text(row[11]) }));
}

export async function createCommission(input: Record<string, unknown>) {
  const gross = money(input.grossIncentive), fidelity = money(input.fidelityDeduction), net = Math.round((gross - fidelity) * 100) / 100;
  if (!text(input.employeeId) || !text(input.employeeName) || !date.test(text(input.periodFrom)) || !date.test(text(input.periodTo)) || text(input.periodFrom) > text(input.periodTo) || !Number.isFinite(gross) || gross < 0 || !Number.isFinite(fidelity) || fidelity < 0 || fidelity > gross) throw new Error("Complete the employee, period, gross incentive, and valid Fidelity deduction.");
  const id = createReadableId("COM");
  await appendEncodedRows({ range: "Commissions!A:L", requestBody: { values: [[id, text(input.employeeId), text(input.employeeName), text(input.periodFrom), text(input.periodTo), gross, fidelity, net, "Pending", "", text(input.referenceNumber), text(input.remarks)]] } });
  return { id };
}

/**
 * A commission paid directly from Commissions, not through payroll: marked Paid and its net amount recorded as a cash
 * outflow, together. Commissions paid in a payroll are not recorded here; the payroll's one outflow already covers them.
 */
export async function payCommissionDirectly(id: string, input: { referenceNumber?: unknown; account?: unknown; branch?: unknown; date?: unknown }) {
  const commission = (await getCommissions()).find((item) => item.id === id);
  if (!commission) throw new Error("Record not found.");
  if (commission.status === "Paid") throw new Error("Commission is already paid.");
  const cash = await cashOutDetails(input);
  return inTransaction(async () => {
    const cashId = commission.netCommission > 0
      ? (await createCashTransaction({ date: cash.date, direction: "outflow", category: "Commission", description: `Commission ${commission.employeeName} (${commission.periodFrom} to ${commission.periodTo})`,
        amount: commission.netCommission, branch: cash.branch, account: cash.account, referenceType: "Commission", referenceId: id, remarks: text(input.referenceNumber) })).id
      : "";
    await payCommission(id, text(input.referenceNumber));
    return { id, cashTransactionId: cashId };
  });
}

export async function payCommission(id: string, referenceNumber: string) {
  const data = await rows("Commissions!A:L"), rowNumber = rowOf(data, id), row = data[rowNumber - 1];
  if (text(row[8]) === "Paid") throw new Error("Commission is already paid.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Commissions!I${rowNumber}:K${rowNumber}`, valueInputOption: "RAW", requestBody: { values: [["Paid", new Date().toISOString(), text(referenceNumber) || text(row[10])]] } });
  return { id };
}
