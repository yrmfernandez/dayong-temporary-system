import { and, eq, ne, sql } from "drizzle-orm";

import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { createCashTransaction } from "@/lib/finance-data";
import { createReadableId } from "@/lib/readable-id";

/*
 * Cash accounts, vendor bills and commissions, read and written directly in the database by ID (owner, October 24,
 * 2026; upgrade #6 phase 3, replacing Sheets-style row writes). Paying a vendor bill or a commission locks its row inside
 * the transaction that also writes the cash outflow, so two payments at once cannot both pass the balance or
 * already-paid check, and the payment and its cash record are saved together or not at all.
 */
const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.round(Number(value) * 100) / 100;
const num = (value: unknown) => Number(value) || 0;
const date = /^\d{4}-\d{2}-\d{2}$/;
const { cash_accounts: accountsTable, vendor_payables: payablesTable, commissions: commissionsTable } = schema;

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
  return (await currentDb().select().from(accountsTable).orderBy(accountsTable.row_seq)).filter((row) => text(row.cash_account_id))
    .map((row) => ({ id: row.cash_account_id, name: text(row.account_name), type: text(row.account_type), openingBalance: num(row.opening_balance), status: text(row.status) || "active" }));
}

export async function saveCashAccount(input: Record<string, unknown>) {
  const name = text(input.name), type = text(input.type), openingBalance = money(input.openingBalance), status = text(input.status) === "inactive" ? "inactive" : "active";
  if (!name || !type || !Number.isFinite(openingBalance)) throw new Error("Account name, type, and opening balance are required.");
  const id = text(input.id);
  return inTransaction(async (tx) => {
    // One account per name: the check and the save hold a lock, so two saves of the same new name cannot both pass.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cash-accounts'))`);
    const [clash] = await tx.select({ id: accountsTable.cash_account_id }).from(accountsTable).where(and(sql`lower(trim(${accountsTable.account_name})) = ${name.toLowerCase()}`, ne(accountsTable.cash_account_id, id || "-"))).limit(1);
    if (clash) throw new Error("Cash account name already exists.");
    if (id) {
      const updated = await tx.update(accountsTable).set({ account_name: name, account_type: type, opening_balance: openingBalance, status }).where(eq(accountsTable.cash_account_id, id)).returning({ id: accountsTable.cash_account_id });
      if (!updated.length) throw new Error("Record not found.");
      return { id };
    }
    const created = createReadableId("CAC");
    await tx.insert(accountsTable).values({ cash_account_id: created, account_name: name, account_type: type, opening_balance: openingBalance, status, ...encodedBy() });
    return { id: created };
  });
}

const toPayable = (row: typeof payablesTable.$inferSelect) => ({
  id: row.payable_id, invoiceDate: text(row.invoice_date), dueDate: text(row.due_date), vendor: text(row.vendor), category: text(row.category), description: text(row.description),
  amount: num(row.amount), amountPaid: num(row.amount_paid), balance: num(row.balance), branch: text(row.branch), status: text(row.status), referenceNumber: text(row.reference_number),
  remarks: text(row.remarks), paidAt: text(row.paid_at), paymentAccount: text(row.payment_account),
});

export async function getVendorPayables() {
  return (await currentDb().select().from(payablesTable).orderBy(payablesTable.row_seq)).filter((row) => text(row.payable_id)).map(toPayable);
}

export async function createVendorPayable(input: Record<string, unknown>) {
  const total = money(input.amount);
  if (!date.test(text(input.invoiceDate)) || !date.test(text(input.dueDate)) || !text(input.vendor) || !text(input.description) || !text(input.branch) || !Number.isFinite(total) || total <= 0) throw new Error("Complete the vendor, dates, branch, description, and amount.");
  const id = createReadableId("PAY");
  await currentDb().insert(payablesTable).values({
    payable_id: id, invoice_date: text(input.invoiceDate), due_date: text(input.dueDate), vendor: text(input.vendor), category: text(input.category) || null, description: text(input.description),
    amount: total, amount_paid: 0, balance: total, branch: text(input.branch), status: "Outstanding", reference_number: text(input.referenceNumber) || null, remarks: text(input.remarks) || null, ...encodedBy(),
  });
  return { id };
}

/** Records a payment on a vendor bill and its cash outflow together: both are saved or neither is. */
export async function payVendorPayable(id: string, paid: unknown, input: { account?: unknown; date?: unknown; reference?: unknown }) {
  const payment = money(paid);
  const [preview] = await currentDb().select().from(payablesTable).where(eq(payablesTable.payable_id, text(id)));
  if (!preview) throw new Error("Record not found.");
  const cash = await cashOutDetails(input, text(preview.branch));
  return inTransaction(async (tx) => {
    // Locked: a second payment on the same bill waits and then sees the new balance.
    const [row] = await tx.select().from(payablesTable).where(eq(payablesTable.payable_id, text(id))).for("update");
    const total = num(row.amount), current = num(row.amount_paid);
    if (!Number.isFinite(payment) || payment <= 0 || Math.round(payment * 100) > Math.round((total - current) * 100)) throw new Error("Payment must be greater than zero and cannot exceed the balance.");
    const amountPaid = Math.round((current + payment) * 100) / 100, balance = Math.round((total - amountPaid) * 100) / 100, status = balance === 0 ? "Paid" : "Partially Paid";
    await tx.update(payablesTable).set({ amount_paid: amountPaid, balance, status, paid_at: new Date().toISOString(), payment_account: cash.account }).where(eq(payablesTable.payable_id, row.payable_id));
    const cashId = (await createCashTransaction({ date: cash.date, direction: "outflow", category: "Vendor payment", description: `${text(row.vendor)}: ${text(row.description)}${status === "Paid" ? "" : " (partial)"}`,
      amount: payment, branch: cash.branch, account: cash.account, referenceType: "Vendor Payable", referenceId: row.payable_id, remarks: text(input.reference) || text(row.reference_number) })).id;
    return { id: row.payable_id, balance, status, cashTransactionId: cashId };
  });
}

const toCommission = (row: typeof commissionsTable.$inferSelect) => ({
  id: row.commission_id, employeeId: text(row.employee_id), employeeName: text(row.employee_name), periodFrom: text(row.period_from), periodTo: text(row.period_to),
  grossIncentive: num(row.gross_incentive), fidelityDeduction: num(row.fidelity_deduction), netCommission: num(row.net_commission), status: text(row.status), paidAt: text(row.paid_at),
  referenceNumber: text(row.reference_number), remarks: text(row.remarks),
});

export async function getCommissions() {
  return (await currentDb().select().from(commissionsTable).orderBy(commissionsTable.row_seq)).filter((row) => text(row.commission_id)).map(toCommission);
}

export async function createCommission(input: Record<string, unknown>) {
  const gross = money(input.grossIncentive), fidelity = money(input.fidelityDeduction), net = Math.round((gross - fidelity) * 100) / 100;
  if (!text(input.employeeId) || !text(input.employeeName) || !date.test(text(input.periodFrom)) || !date.test(text(input.periodTo)) || text(input.periodFrom) > text(input.periodTo) || !Number.isFinite(gross) || gross < 0 || !Number.isFinite(fidelity) || fidelity < 0 || fidelity > gross) throw new Error("Complete the employee, period, gross incentive, and valid Fidelity deduction.");
  const id = createReadableId("COM");
  await currentDb().insert(commissionsTable).values({
    commission_id: id, employee_id: text(input.employeeId), employee_name: text(input.employeeName), period_from: text(input.periodFrom), period_to: text(input.periodTo),
    gross_incentive: gross, fidelity_deduction: fidelity, net_commission: net, status: "Pending", reference_number: text(input.referenceNumber) || null, remarks: text(input.remarks) || null, ...encodedBy(),
  });
  return { id };
}

/**
 * A commission paid directly from Commissions, not through payroll: marked Paid and its net amount recorded as a cash
 * outflow, together. Commissions paid in a payroll are not recorded here; the payroll's one outflow already covers them.
 */
export async function payCommissionDirectly(id: string, input: { referenceNumber?: unknown; account?: unknown; branch?: unknown; date?: unknown }) {
  const cash = await cashOutDetails(input);
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(commissionsTable).where(eq(commissionsTable.commission_id, text(id))).for("update");
    if (!row) throw new Error("Record not found.");
    const commission = toCommission(row);
    if (commission.status === "Paid") throw new Error("Commission is already paid.");
    const cashId = commission.netCommission > 0
      ? (await createCashTransaction({ date: cash.date, direction: "outflow", category: "Commission", description: `Commission ${commission.employeeName} (${commission.periodFrom} to ${commission.periodTo})`,
        amount: commission.netCommission, branch: cash.branch, account: cash.account, referenceType: "Commission", referenceId: commission.id, remarks: text(input.referenceNumber) })).id
      : "";
    await payCommission(commission.id, text(input.referenceNumber));
    return { id: commission.id, cashTransactionId: cashId };
  });
}

/** Marks one commission Paid with its reference (kept when none is given); refused when it already is. */
export async function payCommission(id: string, referenceNumber: string) {
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(commissionsTable).where(eq(commissionsTable.commission_id, text(id))).for("update");
    if (!row) throw new Error("Record not found.");
    if (text(row.status) === "Paid") throw new Error("Commission is already paid.");
    await tx.update(commissionsTable).set({ status: "Paid", paid_at: new Date().toISOString(), reference_number: text(referenceNumber) || row.reference_number }).where(eq(commissionsTable.commission_id, row.commission_id));
    return { id: row.commission_id };
  });
}
