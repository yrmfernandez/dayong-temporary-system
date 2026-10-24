import { and, desc, eq } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { attachmentList, BURIAL_ACCOUNT, choiceWithOther, EXPENSE_ACCOUNTS, EXPENSE_APPROVERS, expenseNumbers } from "@/lib/expense-options";
import { createReadableId } from "@/lib/readable-id";
import { expensePhotosFrom, saveExpensePhotos } from "@/lib/receipt-photos";

/*
 * Expenses and Cash Transactions, read and written directly in the database by ID (owner, October 24, 2026; upgrade #6
 * phase 3, replacing Sheets-style row writes). Creating writes one row; editing, voiding and deleting lock the row and
 * update it once, so a change is never half saved and never lands on the wrong row. createCashTransaction joins the
 * caller's transaction (payroll payment, vendor payments, commissions and Fidelity payouts), so the payout and its
 * cash outflow are saved together.
 */
const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => Number(value ?? 0) || 0;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const round = (value: number) => Math.round(value * 100) / 100;
const { expenses: expensesTable, cash_transactions: cashTable, remittances: remittancesTable } = schema;

export type ExpenseRecord = {
  id: string; date: string; category: string; description: string;
  amount: number; payee: string; paidBy: string; branch: string; paymentMethod: string;
  referenceNumber: string; receiptNumber: string; status: string; remarks: string;
  createdAt: string; encodedBy: string; voidedAt: string; voidReason: string;
  attachments: string; approvedBy: string;
};

export type CashLedgerEntry = {
  id: string; date: string; direction: "inflow" | "outflow"; category: string;
  description: string; amount: number; branch: string; account: string;
  referenceType: string; referenceId: string; status: string; remarks: string;
  source: "remittance" | "expense" | "manual"; encodedBy?: string;
};

const toExpense = (row: typeof expensesTable.$inferSelect): ExpenseRecord => ({
  id: row.expense_id, date: text(row.expense_date), category: text(row.category), description: text(row.description), amount: amount(row.amount), payee: text(row.payee),
  paidBy: text(row.paid_by), branch: text(row.branch), paymentMethod: text(row.payment_method), referenceNumber: text(row.reference_number), receiptNumber: text(row.receipt_number),
  status: text(row.status) || "Posted", remarks: text(row.remarks), createdAt: text(row.created_at), voidedAt: text(row.voided_at), voidReason: text(row.void_reason),
  encodedBy: text(row.encoded_by_employee_id), attachments: text(row.attachments), approvedBy: text(row.approved_by),
});

export async function getFinanceData() {
  const db = currentDb();
  const [expenseRows, cashRows, remittanceRows] = await Promise.all([
    db.select().from(expensesTable),
    db.select().from(cashTable),
    db.select({ id: remittancesTable.remittance_id, branch: remittancesTable.branch, mas: remittancesTable.mas, date: remittancesTable.date_remitted, total: remittancesTable.total_remittance, remarks: remittancesTable.remarks })
      .from(remittancesTable).where(eq(remittancesTable.status, "Approved")),
  ]);
  const expenses = expenseRows.map(toExpense).filter((row) => row.id);
  const manual = cashRows.map<CashLedgerEntry>((row) => ({
    id: row.transaction_id, date: text(row.transaction_date), direction: text(row.direction) === "outflow" ? "outflow" : "inflow",
    category: text(row.category), description: text(row.description), amount: amount(row.amount), branch: text(row.branch),
    account: text(row.cash_account), referenceType: text(row.reference_type), referenceId: text(row.reference_id),
    status: text(row.status) || "Posted", remarks: text(row.remarks), source: "manual", encodedBy: text(row.encoded_by_employee_id),
  })).filter((row) => row.id);
  const approvedRemittances: CashLedgerEntry[] = remittanceRows.map((row) => ({ id: `LED-${row.id}`, date: text(row.date), direction: "inflow", category: "Approved Remittance",
    description: `Cash remitted by ${text(row.mas) || "accountable staff"}`, amount: amount(row.total), branch: text(row.branch),
    account: "Cash on Hand", referenceType: "Remittance", referenceId: row.id, status: "Posted", remarks: text(row.remarks), source: "remittance" }));
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

/**
 * Saves an entry from the company expense form (the Expenses page and the Entry Clerk's report). Payee and payment
 * details are optional extras. At least one photo of the receipt is required (owner, October 21, 2026): `input.photos`
 * are checked with the other fields, then saved under the new expense's ID before the expense row, so an expense is never
 * saved without them and a refused expense leaves no photo behind.
 */
export async function createExpense(input: Record<string, unknown>) {
  const value = round(Number(input.amount));
  if (!datePattern.test(text(input.date))) throw new Error("Enter a valid date of expense.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Expense amount must be greater than zero.");
  const account = choiceWithOther(EXPENSE_ACCOUNTS, input.category, input.categoryOther, "account name");
  const approvedBy = choiceWithOther(EXPENSE_APPROVERS, input.approvedBy, input.approvedByOther, "approver");
  const attachments = attachmentList(input.attachments, input.attachmentOther);
  const { receipt, member } = expenseNumbers(account, input.receiptNumber, input.payee);
  const description = required(input.description, "Purpose"), branch = required(input.branch, "Branch");
  const photos = expensePhotosFrom(input.photos);
  if (!photos.length) throw new Error("Attach a photo of the receipt.");
  getEncoder();
  const id = createReadableId("EXP");
  await saveExpensePhotos(id, photos);
  await currentDb().insert(expensesTable).values({
    expense_id: id, expense_date: text(input.date), category: account, description, amount: value, payee: member || null, paid_by: text(input.paidBy) || "Cash on Hand", branch,
    payment_method: text(input.paymentMethod) || "Cash", reference_number: text(input.referenceNumber) || null, receipt_number: receipt || null, status: "Posted", remarks: text(input.remarks) || null,
    created_at: new Date().toISOString(), attachments: attachments || null, approved_by: approvedBy || null, ...encodedBy(),
  });
  return { id, photos: photos.length };
}

/**
 * An expense recorded on an Entry Clerk's report, edited or deleted from the report (owner, October 16, 2026), as
 * deposits are: by the clerk who recorded it, or an administrator. Delete voids it with the reason (it leaves the
 * report, Expenses and the cash ledger; Finance and the Audit Log still show it). A voided expense is not edited.
 * Locks the row for the rest of the caller's transaction.
 */
async function ownExpense(tx: Parameters<Parameters<typeof inTransaction>[0]>[0], id: string, by: { employeeId: string; isAdmin: boolean }) {
  const [row] = await tx.select().from(expensesTable).where(eq(expensesTable.expense_id, text(id))).for("update");
  if (!row) throw new Error("Expense not found.");
  if (!by.isAdmin && text(row.encoded_by_employee_id) !== by.employeeId) throw new Error("You can change only expenses you recorded.");
  if ((text(row.status) || "Posted") === "Voided") throw new Error("This expense was already deleted.");
  return row;
}

export async function editExpense(id: string, input: Record<string, unknown>, by: { employeeId: string; isAdmin: boolean }) {
  const value = round(Number(input.amount));
  if (!datePattern.test(text(input.date))) throw new Error("Enter a valid date of expense.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Expense amount must be greater than zero.");
  const account = choiceWithOther(EXPENSE_ACCOUNTS, input.category, input.categoryOther, "account name");
  const approvedBy = choiceWithOther(EXPENSE_APPROVERS, input.approvedBy, input.approvedByOther, "approver");
  const description = required(input.description, "Purpose");
  const { receipt, member } = expenseNumbers(account, input.receiptNumber, input.payee);
  getEncoder();
  await inTransaction(async (tx) => {
    const row = await ownExpense(tx, id, by);
    // Date, account, purpose, amount, receipt, remarks and approver; the payee (the member, for Cash Burial Assistance)
    // only when given or for that account. Branch and status stay.
    await tx.update(expensesTable).set({
      expense_date: text(input.date), category: account, description, amount: value, receipt_number: receipt || null, remarks: text(input.remarks) || null, approved_by: approvedBy || null,
      ...(account === BURIAL_ACCOUNT || member ? { payee: member || null } : {}),
    }).where(eq(expensesTable.expense_id, row.expense_id));
  });
}

export async function deleteExpense(id: string, reason: string, by: { employeeId: string; isAdmin: boolean }) {
  if (text(reason).length < 3) throw new Error("Give the reason for deleting the expense.");
  await inTransaction(async (tx) => {
    await ownExpense(tx, id, by);
    await voidFinanceRecord("expense", text(id), text(reason).slice(0, 200));
  });
}

/** One cash movement; inside a caller's transaction it is saved with the rest of that save. */
export async function createCashTransaction(input: Record<string, unknown>) {
  const value = round(Number(input.amount)); const direction = text(input.direction);
  if (!datePattern.test(text(input.date))) throw new Error("Enter a valid transaction date.");
  if (!["inflow", "outflow"].includes(direction)) throw new Error("Choose cash inflow or outflow.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Transaction amount must be greater than zero.");
  const id = createReadableId("CASH");
  await currentDb().insert(cashTable).values({
    transaction_id: id, transaction_date: text(input.date), direction, category: required(input.category, "Category"), description: required(input.description, "Description"), amount: value,
    branch: required(input.branch, "Branch"), cash_account: required(input.account, "Cash account"), reference_type: text(input.referenceType) || "Manual", reference_id: text(input.referenceId) || null,
    status: "Posted", remarks: text(input.remarks) || null, created_at: new Date().toISOString(), ...encodedBy(),
  });
  return { id };
}

/** Voids an expense or a manual cash transaction with the reason: one locked update by ID. */
export async function voidFinanceRecord(kind: "expense" | "cash", id: string, reason: string) {
  const actor = getEncoder();
  const why = required(reason, "Void reason");
  await inTransaction(async (tx) => {
    const table = kind === "expense" ? expensesTable : cashTable;
    const idColumn = kind === "expense" ? expensesTable.expense_id : cashTable.transaction_id;
    const [row] = await tx.select({ status: table.status }).from(table).where(eq(idColumn, text(id))).for("update");
    if (!row) throw new Error("Financial record not found.");
    if (text(row.status) === "Voided") throw new Error("Financial record is already voided.");
    await tx.update(table).set({ status: "Voided", voided_at: actor.encodedAt, voided_by_user_id: actor.userId, void_reason: why }).where(and(eq(idColumn, text(id))));
  });
}

/** The latest cash transactions for a reference (e.g. a payroll run or vendor bill), newest first. */
export async function cashTransactionsFor(referenceType: string, referenceId: string) {
  return currentDb().select().from(cashTable).where(and(eq(cashTable.reference_type, referenceType), eq(cashTable.reference_id, referenceId))).orderBy(desc(cashTable.created_at));
}
