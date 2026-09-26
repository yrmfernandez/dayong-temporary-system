import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { headerMatches } from "@/lib/sheet-headers";

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => Number(value ?? 0) || 0;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const round = (value: number) => Math.round(value * 100) / 100;

export type ExpenseRecord = {
  id: string; rowNumber: number; date: string; category: string; description: string;
  amount: number; payee: string; paidBy: string; branch: string; paymentMethod: string;
  referenceNumber: string; receiptNumber: string; status: string; remarks: string;
  createdAt: string; encodedBy: string; voidedAt: string; voidReason: string;
};

export type CashLedgerEntry = {
  id: string; date: string; direction: "inflow" | "outflow"; category: string;
  description: string; amount: number; branch: string; account: string;
  referenceType: string; referenceId: string; status: string; remarks: string;
  source: "remittance" | "expense" | "manual"; rowNumber?: number; encodedBy?: string;
};

async function loadRows() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: ["'Expenses'", "'Cash Transactions'", "'Remittances'"],
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const [expenses = [], cash = [], remittances = []] =
    response.data.valueRanges?.map((range) => range.values ?? []) ?? [];
  if (!headerMatches(expenses[0]?.[0], "expense_id") || !headerMatches(cash[0]?.[0], "transaction_id")) {
    throw new Error("Run the finance sheet migration before using Finance.");
  }
  return { expenses, cash, remittances };
}

export async function getFinanceData() {
  const rows = await loadRows();
  const expenses: ExpenseRecord[] = rows.expenses.slice(1).map((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, date: text(row[1]), category: text(row[2]),
    description: text(row[3]), amount: amount(row[4]), payee: text(row[5]), paidBy: text(row[6]),
    branch: text(row[7]), paymentMethod: text(row[8]), referenceNumber: text(row[9]),
    receiptNumber: text(row[10]), status: text(row[11]) || "Posted", remarks: text(row[12]),
    createdAt: text(row[13]), voidedAt: text(row[14]), voidReason: text(row[16]), encodedBy: text(row[19]),
  })).filter((row) => row.id);
  const manual = rows.cash.slice(1).map<CashLedgerEntry>((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, date: text(row[1]), direction: text(row[2]) === "outflow" ? "outflow" : "inflow",
    category: text(row[3]), description: text(row[4]), amount: amount(row[5]), branch: text(row[6]),
    account: text(row[7]), referenceType: text(row[8]), referenceId: text(row[9]),
    status: text(row[10]) || "Posted", remarks: text(row[11]), source: "manual", encodedBy: text(row[18]),
  })).filter((row) => row.id);
  const approvedRemittances: CashLedgerEntry[] = rows.remittances.slice(1)
    .filter((row) => text(row[0]) && text(row[4]) === "Approved")
    .map((row) => ({ id: `LED-${text(row[0])}`, date: text(row[3]), direction: "inflow", category: "Approved Remittance",
      description: `Cash remitted by ${text(row[2]) || "accountable staff"}`, amount: amount(row[11]), branch: text(row[1]),
      account: "Cash on Hand", referenceType: "Remittance", referenceId: text(row[0]), status: "Posted", remarks: text(row[22]), source: "remittance" }));
  const expenseEntries: CashLedgerEntry[] = expenses.filter((row) => row.status === "Posted").map((row) => ({
    id: `LED-${row.id}`, date: row.date, direction: "outflow", category: row.category,
    description: row.description, amount: row.amount, branch: row.branch, account: row.paidBy || "Cash on Hand",
    referenceType: "Expense", referenceId: row.id, status: "Posted", remarks: row.remarks, source: "expense",
  }));
  const ledger = [...approvedRemittances, ...expenseEntries, ...manual].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return { expenses: expenses.sort((a, b) => b.date.localeCompare(a.date)), manual, ledger };
}

function required(value: unknown, label: string) {
  const result = text(value); if (!result) throw new Error(`${label} is required.`); return result;
}

export async function createExpense(input: Record<string, unknown>) {
  const value = round(Number(input.amount));
  if (!datePattern.test(text(input.date))) throw new Error("Enter a valid expense date.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Expense amount must be greater than zero.");
  const id = `EXP-${crypto.randomUUID()}`;
  await appendEncodedRows({ range: "Expenses!A:Q", requestBody: { values: [[id, text(input.date), required(input.category, "Category"),
    required(input.description, "Description"), value, required(input.payee, "Payee"), text(input.paidBy), required(input.branch, "Branch"),
    required(input.paymentMethod, "Payment method"), text(input.referenceNumber), text(input.receiptNumber), "Posted", text(input.remarks),
    new Date().toISOString(), "", "", ""]] } });
  return { id };
}

export async function createCashTransaction(input: Record<string, unknown>) {
  const value = round(Number(input.amount)); const direction = text(input.direction);
  if (!datePattern.test(text(input.date))) throw new Error("Enter a valid transaction date.");
  if (!['inflow', 'outflow'].includes(direction)) throw new Error("Choose cash inflow or outflow.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Transaction amount must be greater than zero.");
  const id = `CASH-${crypto.randomUUID()}`;
  await appendEncodedRows({ range: "'Cash Transactions'!A:P", requestBody: { values: [[id, text(input.date), direction,
    required(input.category, "Category"), required(input.description, "Description"), value, required(input.branch, "Branch"),
    required(input.account, "Cash account"), text(input.referenceType) || "Manual", text(input.referenceId), "Posted", text(input.remarks),
    new Date().toISOString(), "", "", ""]] } });
  return { id };
}

export async function voidFinanceRecord(kind: "expense" | "cash", id: string, reason: string) {
  const actor = getEncoder(); const data = await getFinanceData();
  const record = kind === "expense" ? data.expenses.find((row) => row.id === id) : data.manual.find((row) => row.id === id);
  if (!record?.rowNumber) throw new Error("Financial record not found.");
  if (record.status === "Voided") throw new Error("Financial record is already voided.");
  const title = kind === "expense" ? "Expenses" : "Cash Transactions";
  const statusColumn = kind === "expense" ? "L" : "K";
  const voidRange = kind === "expense" ? `O${record.rowNumber}:Q${record.rowNumber}` : `N${record.rowNumber}:P${record.rowNumber}`;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: [
    { range: `'${title}'!${statusColumn}${record.rowNumber}`, values: [["Voided"]] },
    { range: `'${title}'!${voidRange}`, values: [[actor.encodedAt, `'${actor.userId}`, required(reason, "Void reason")]] },
  ] } });
}
