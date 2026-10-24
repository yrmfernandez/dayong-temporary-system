import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { getAttendanceRecordsForRange } from "@/lib/attendance-data";
import { closeFinishedAttendanceDaysQuietly } from "@/lib/auto-absence";
import { currentDb, encodedBy, getDb, inTransaction, schema, type Queryable } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { createCashTransaction } from "@/lib/finance-data";
import { getCashAccounts } from "@/lib/finance-operations";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import {
  ADJUSTMENT_CATEGORIES, COMPANY_PROGRAM_CATEGORY, computePayrollLine, defaultPayrollSettings, runTotals,
  type Adjustment, type BaseType, type PayProfile, type PayrollLine, type PayrollSettings,
} from "@/lib/payroll-calc";
import { createReadableId } from "@/lib/readable-id";

/*
 * Tables, read and written directly (owner, October 24, 2026; upgrade #6 phase 1, replacing the Sheets-style row
 * writes): pay_profiles (one row per employee; each payroll line snapshots the rate it used), payroll_runs (one per pay
 * period), payroll_lines (one per employee per calculation; recalculation marks old lines "replaced"),
 * payroll_adjustments (additions/deductions with a required reason; removal keeps the row).
 *
 * Every action that changes a run is one transaction that first locks the run's row, so it all saves or none of it
 * does, and two people pressing Approve or Mark paid at once cannot both go through: the second waits, then sees the
 * new status. Creating and recalculating runs also take one payroll-wide lock, so two runs cannot claim the same
 * commission or overlap the same period. Rows are found by ID, never by row position.
 */
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value) || 0;
const centavos = (value: number) => Math.round(value * 100) / 100;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const { pay_profiles: profilesTable, payroll_runs: runsTable, payroll_lines: linesTable, payroll_adjustments: adjustmentsTable, commissions: commissionsTable } = schema;

/** One payroll-wide lock for the rest of the transaction: run creation and recalculation wait for each other. */
const lockPayroll = (tx: Queryable) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('payroll-runs'))`);

// ---------- Pay profiles ----------

export async function getPayProfiles(db: Queryable = currentDb()): Promise<PayProfile[]> {
  return (await db.select().from(profilesTable)).filter((row) => text(row.employee_id)).map((row) => ({
    employeeId: row.employee_id,
    baseType: (["daily", "monthly", "none"].includes(text(row.base_type)) ? text(row.base_type) : "none") as BaseType,
    baseRate: num(row.base_rate),
    commissionEligible: Boolean(row.commission_eligible),
    hoursPerDay: num(row.hours_per_day) || 8,
    overtimeMultiplier: num(row.overtime_multiplier) || 1.25,
    status: text(row.status).toLowerCase() === "inactive" ? "inactive" : "active",
    notes: text(row.notes),
  }));
}

export async function savePayProfile(input: Record<string, unknown>) {
  const employeeId = text(input.employeeId);
  const baseType = text(input.baseType) as BaseType;
  const baseRate = centavos(num(input.baseRate));
  const hoursPerDay = num(input.hoursPerDay) || 8;
  const overtimeMultiplier = num(input.overtimeMultiplier) || 1.25;
  if (!(await getEmployees()).some((employee) => employee.id === employeeId)) throw new Error("Select a registered employee.");
  if (!["daily", "monthly", "none"].includes(baseType)) throw new Error("Choose daily rate, monthly salary, or no base pay.");
  if (baseType !== "none" && !(baseRate > 0)) throw new Error("Enter a base rate greater than zero.");
  if (hoursPerDay < 1 || hoursPerDay > 24) throw new Error("Hours per day must be between 1 and 24.");
  if (overtimeMultiplier < 1 || overtimeMultiplier > 5) throw new Error("Overtime multiplier must be between 1 and 5.");
  const values = {
    base_type: baseType, base_rate: baseType === "none" ? 0 : baseRate, commission_eligible: Boolean(input.commissionEligible), hours_per_day: hoursPerDay, overtime_multiplier: overtimeMultiplier,
    status: text(input.status) === "inactive" ? "inactive" : "active", notes: text(input.notes) || null, updated_at: new Date().toISOString(),
  };
  // One row per employee: a second save at the same moment updates it instead of adding another.
  await currentDb().insert(profilesTable).values({ employee_id: employeeId, ...values, ...encodedBy() }).onConflictDoUpdate({ target: profilesTable.employee_id, set: values });
  return { employeeId };
}

// ---------- Runs, lines, adjustments ----------

export type PayrollRun = {
  id: string; periodFrom: string; periodTo: string; payDate: string; status: string; settings: PayrollSettings;
  employeeCount: number; grossTotal: number; deductionsTotal: number; netTotal: number;
  preparedByUserId: string; preparedByName: string; preparedAt: string; approvedByName: string; approvedAt: string;
  paidAt: string; cashAccount: string; paymentReference: string; cashTransactionId: string; branch: string; voidReason: string; remarks: string;
};

function readRun(row: typeof runsTable.$inferSelect): PayrollRun {
  let stored: unknown = row.settings_json;
  if (typeof stored === "string") { try { stored = JSON.parse(stored); } catch { stored = {}; } }
  return {
    id: row.payroll_id, periodFrom: text(row.period_from), periodTo: text(row.period_to), payDate: text(row.pay_date), status: text(row.status),
    settings: { ...defaultPayrollSettings, ...((stored ?? {}) as Partial<PayrollSettings>) },
    employeeCount: num(row.employee_count), grossTotal: num(row.gross_total), deductionsTotal: num(row.deductions_total), netTotal: num(row.net_total),
    preparedByUserId: text(row.prepared_by_user_id), preparedByName: text(row.prepared_by_name), preparedAt: text(row.prepared_at), approvedByName: text(row.approved_by_name), approvedAt: text(row.approved_at),
    paidAt: text(row.paid_at), cashAccount: text(row.cash_account), paymentReference: text(row.payment_reference), cashTransactionId: text(row.cash_transaction_id), branch: text(row.branch), voidReason: text(row.void_reason), remarks: text(row.remarks),
  };
}

type StoredLine = PayrollLine & { id: string; runId: string; status: string };

function readLine(row: typeof linesTable.$inferSelect): StoredLine {
  return {
    id: row.payroll_line_id, runId: row.payroll_id, employeeId: row.employee_id, employeeName: text(row.employee_name), roles: text(row.roles),
    baseType: text(row.base_type) as BaseType, baseRate: num(row.base_rate), dailyRate: num(row.daily_rate), hourlyRate: num(row.hourly_rate),
    daysPaid: num(row.days_paid), leaveDays: num(row.leave_days), absentDays: num(row.absent_days), basePay: num(row.base_pay),
    overtimeHours: num(row.overtime_hours), overtimePay: num(row.overtime_pay), lateMinutes: num(row.late_minutes), lateDeduction: num(row.late_deduction),
    undertimeMinutes: num(row.undertime_minutes), undertimeDeduction: num(row.undertime_deduction), absenceDeduction: num(row.absence_deduction),
    commission: num(row.commission), commissionIds: text(row.commission_ids).split(",").map((id) => id.trim()).filter(Boolean), earnedIncentive: num(row.earned_incentive_reference), status: text(row.line_status) || "active",
  };
}

const lineRow = (runId: string, line: PayrollLine) => ({
  payroll_line_id: createReadableId("PYL") + Math.random().toString(36).slice(2, 5).toUpperCase(), payroll_id: runId, employee_id: line.employeeId, employee_name: line.employeeName, roles: line.roles,
  base_type: line.baseType, base_rate: line.baseRate, daily_rate: line.dailyRate, hourly_rate: line.hourlyRate, days_paid: line.daysPaid, leave_days: line.leaveDays, absent_days: line.absentDays,
  base_pay: line.basePay, overtime_hours: line.overtimeHours, overtime_pay: line.overtimePay, late_minutes: line.lateMinutes, late_deduction: line.lateDeduction, undertime_minutes: line.undertimeMinutes,
  undertime_deduction: line.undertimeDeduction, absence_deduction: line.absenceDeduction, commission: line.commission, commission_ids: line.commissionIds.join(", "),
  earned_incentive_reference: String(line.earnedIncentive), line_status: "active", ...encodedBy(),
});

function readAdjustment(row: typeof adjustmentsTable.$inferSelect) {
  return { id: row.adjustment_id, runId: row.payroll_id, employeeId: row.employee_id, kind: (text(row.kind) === "Deduction" ? "Deduction" : "Addition") as Adjustment["kind"], category: text(row.category), amount: num(row.amount), reason: text(row.reason), status: text(row.status) || "active" };
}

export async function getPayrollOverview() {
  const [runRows, profiles, employees, accounts, branches, programs] = await Promise.all([currentDb().select().from(runsTable), getPayProfiles(), getEmployees(), getCashAccounts(), getBranches(), getPrograms()]);
  return {
    runs: runRows.map(readRun).sort((a, b) => b.periodFrom.localeCompare(a.periodFrom) || b.id.localeCompare(a.id)),
    profiles,
    employees: employees.filter((employee) => employee.status.toLowerCase() === "active").map((employee) => ({ id: employee.id, name: employee.name, branch: employee.branch, roles: employee.roles })),
    // Every employee's primary branch (inactive ones too, who may still be on an older payroll), for the branch filter.
    employeeBranches: Object.fromEntries(employees.map((employee) => [employee.id, employee.branch])),
    cashAccounts: accounts.filter((account) => account.status === "active").map((account) => account.name),
    branches: branches.filter((branch) => branch.status === "active").map((branch) => branch.name),
    adjustmentCategories: ADJUSTMENT_CATEGORIES,
    programs: programs.filter((program) => program.status === "active").map((program) => ({ id: program.id, code: program.code, name: program.name, basePay: program.basePay })),
  };
}

/** A run with its active lines, adjustments and totals; `lock` holds the run's row until the transaction ends. */
async function readRunDetail(runId: string, db: Queryable, lock = false) {
  const query = db.select().from(runsTable).where(eq(runsTable.payroll_id, text(runId)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new Error("Payroll run not found.");
  const [lineRows, adjustmentRows] = await Promise.all([
    db.select().from(linesTable).where(and(eq(linesTable.payroll_id, row.payroll_id), eq(linesTable.line_status, "active"))),
    db.select().from(adjustmentsTable).where(and(eq(adjustmentsTable.payroll_id, row.payroll_id), eq(adjustmentsTable.status, "active"))),
  ]);
  const lines = lineRows.map(readLine).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const adjustments = adjustmentRows.map(readAdjustment);
  return { run: readRun(row), lines, adjustments, totals: runTotals(lines, adjustments) };
}

export function getPayrollRun(runId: string) {
  return readRunDetail(runId, currentDb());
}

/** Earned incentive reference: gross less company remittance on remitted collections, by accountable employee. */
async function earnedIncentives(from: string, to: string) {
  // Summed by the database for the period only (reading all 60,000 collections took several seconds; October 10, 2026).
  // A blank company share (imported rows) means no incentive was recorded, not that the whole amount was incentive.
  const result = await getDb().execute(sql`select coalesce(accountable_employee_id, '') as employee_id,
      sum(greatest(0, coalesce(amount_collected, 0) - remittance_amount))::float8 as earned
    from collections
    where lower(coalesce(status, '')) = 'posted' and remittance_status = 'Remitted' and remittance_amount is not null
      and or_date between ${from}::date and ${to}::date
    group by 1`);
  const rowsOfResult = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ employee_id: string; earned: number }>;
  return new Map(rowsOfResult.map((row) => [text(row.employee_id), centavos(Number(row.earned) || 0)] as const));
}

/** Pending commissions, read in the caller's transaction so a claim made a moment ago is seen. */
async function pendingCommissions(db: Queryable) {
  return (await db.select().from(commissionsTable).where(eq(commissionsTable.status, "Pending"))).map((row) => ({
    id: row.commission_id, employeeId: text(row.employee_id), employeeName: text(row.employee_name), periodFrom: text(row.period_from), periodTo: text(row.period_to),
    grossIncentive: num(row.gross_incentive), fidelityDeduction: num(row.fidelity_deduction), netCommission: num(row.net_commission), status: text(row.status), paidAt: text(row.paid_at), referenceNumber: text(row.reference_number), remarks: text(row.remarks),
  }));
}

/** Attendance and incentives are read before the transaction; commissions and other runs' claims inside it (`db`). */
async function calculateLines(run: { id: string; periodFrom: string; periodTo: string; settings: PayrollSettings }, db: Queryable, prepared: Awaited<ReturnType<typeof prepareInputs>>) {
  const [commissions, claimedRows] = await Promise.all([
    pendingCommissions(db),
    // A commission may only be claimed by one live run; voided runs release theirs.
    db.select({ ids: linesTable.commission_ids }).from(linesTable).innerJoin(runsTable, eq(runsTable.payroll_id, linesTable.payroll_id))
      .where(and(eq(linesTable.line_status, "active"), ne(runsTable.status, "Void"), ne(runsTable.payroll_id, run.id))),
  ]);
  const claimed = new Set(claimedRows.flatMap((row) => text(row.ids).split(",").map((id) => id.trim()).filter(Boolean)));
  const { employees, profiles, attendance, incentives } = prepared;
  const active = new Map(profiles.filter((profile) => profile.status === "active").map((profile) => [profile.employeeId, profile]));
  const payable = employees.filter((employee) => employee.status.toLowerCase() === "active" && active.has(employee.id));
  const missingProfiles = employees.filter((employee) => employee.status.toLowerCase() === "active" && !active.has(employee.id)).map((employee) => employee.name);
  const computed = payable.map((employee) => computePayrollLine({
    employeeId: employee.id, employeeName: employee.name, roles: employee.roles.join(", "),
    profile: active.get(employee.id)!,
    attendance: attendance.filter((record) => record.employeeId === employee.id),
    commissions: commissions.filter((item) => item.employeeId === employee.id && item.periodTo <= run.periodTo && !claimed.has(item.id)),
    earnedIncentive: incentives.get(employee.id) ?? 0,
    settings: run.settings, from: run.periodFrom, to: run.periodTo,
  }));
  return { computed, missingProfiles };
}

/** What a calculation reads that no payroll action changes; read before the transaction so it stays short. */
async function prepareInputs(periodFrom: string, periodTo: string) {
  // Finished days with no clock-in become Absent first, so they are deducted like any recorded absence.
  await closeFinishedAttendanceDaysQuietly();
  const [employees, profiles, attendance, incentives] = await Promise.all([getEmployees(), getPayProfiles(), getAttendanceRecordsForRange(periodFrom, periodTo), earnedIncentives(periodFrom, periodTo)]);
  return { employees, profiles, attendance, incentives };
}

function readSettings(input: Record<string, unknown>): PayrollSettings {
  const source = (input.settings ?? {}) as Record<string, unknown>;
  const flag = (key: keyof PayrollSettings) => (key in source ? Boolean(source[key]) : defaultPayrollSettings[key]) as boolean;
  return {
    baseMethod: source.baseMethod === "scheduled" ? "scheduled" : "attendance",
    includeOvertime: flag("includeOvertime"), deductLate: flag("deductLate"), deductUndertime: flag("deductUndertime"),
    payApprovedLeave: flag("payApprovedLeave"), deductAbsences: flag("deductAbsences"), includeCommissions: flag("includeCommissions"),
  };
}

const stamp = () => new Date().toISOString();

/** Stores the run's employee count and totals from its active lines and adjustments, in the caller's transaction. */
async function storeRunTotals(runId: string, tx: Queryable) {
  const detail = await readRunDetail(runId, tx);
  await tx.update(runsTable).set({ employee_count: detail.lines.length, gross_total: detail.totals.gross, deductions_total: detail.totals.deductions, net_total: detail.totals.net, updated_at: stamp() })
    .where(eq(runsTable.payroll_id, runId));
  return detail;
}

/** Locks a run that must still be Draft, or throws. */
async function lockedDraft(runId: string, tx: Queryable) {
  const detail = await readRunDetail(runId, tx, true);
  if (detail.run.status !== "Draft") throw new Error("Only Draft payroll runs can be changed.");
  return detail;
}

export async function createPayrollRun(input: Record<string, unknown>) {
  const actor = getEncoder();
  const periodFrom = text(input.periodFrom), periodTo = text(input.periodTo), payDate = text(input.payDate);
  if (!datePattern.test(periodFrom) || !datePattern.test(periodTo) || periodFrom > periodTo) throw new Error("Choose a valid pay period.");
  if (payDate && !datePattern.test(payDate)) throw new Error("Enter a valid pay date.");
  const settings = readSettings(input);
  const prepared = await prepareInputs(periodFrom, periodTo);
  return inTransaction(async (tx) => {
    await lockPayroll(tx);
    const [overlap] = await tx.select().from(runsTable).where(and(ne(runsTable.status, "Void"), sql`${runsTable.period_from} <= ${periodTo}::date and ${periodFrom}::date <= ${runsTable.period_to}`)).limit(1);
    if (overlap) throw new Error(`Payroll ${overlap.payroll_id} (${text(overlap.period_from)} to ${text(overlap.period_to)}) already covers part of this period. Void it first or choose another period.`);
    const id = createReadableId("PAY");
    const { computed, missingProfiles } = await calculateLines({ id, periodFrom, periodTo, settings }, tx, prepared);
    if (!computed.length) throw new Error("No active employee has a pay setup yet. Add pay rates first.");
    const totals = runTotals(computed, []);
    await tx.insert(runsTable).values({
      payroll_id: id, period_from: periodFrom, period_to: periodTo, pay_date: payDate || null, status: "Draft", settings_json: settings, employee_count: computed.length,
      gross_total: totals.gross, deductions_total: totals.deductions, net_total: totals.net, prepared_by_user_id: actor.userId, prepared_by_name: actor.name, prepared_at: actor.encodedAt,
      remarks: text(input.remarks) || null, updated_at: actor.encodedAt, ...encodedBy(),
    });
    await tx.insert(linesTable).values(computed.map((line) => lineRow(id, line)));
    return { id, missingProfiles };
  });
}

export async function recalculatePayrollRun(runId: string, input: Record<string, unknown>) {
  const { run } = await getPayrollRun(runId);
  const prepared = await prepareInputs(run.periodFrom, run.periodTo);
  return inTransaction(async (tx) => {
    await lockPayroll(tx);
    const { run: current, lines } = await lockedDraft(runId, tx);
    const settings = input.settings ? readSettings(input) : current.settings;
    const { computed, missingProfiles } = await calculateLines({ ...current, settings }, tx, prepared);
    // Previous lines stay as "replaced" for the audit trail.
    if (lines.length) await tx.update(linesTable).set({ line_status: "replaced" }).where(inArray(linesTable.payroll_line_id, lines.map((line) => line.id)));
    if (computed.length) await tx.insert(linesTable).values(computed.map((line) => lineRow(runId, line)));
    await tx.update(runsTable).set({ settings_json: settings }).where(eq(runsTable.payroll_id, runId));
    await storeRunTotals(runId, tx);
    return { id: runId, missingProfiles };
  });
}

export async function addPayrollAdjustment(runId: string, input: Record<string, unknown>) {
  const employeeId = text(input.employeeId), kind = text(input.kind), category = text(input.category), amount = centavos(num(input.amount));
  let reason = text(input.reason);
  if (kind !== "Addition" && kind !== "Deduction") throw new Error("Choose an addition or a deduction.");
  if (!(ADJUSTMENT_CATEGORIES[kind] as readonly string[]).includes(category)) throw new Error(`Choose a ${kind.toLowerCase()} category.`);
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
  if (reason.length < 3 || reason.length > 300) throw new Error("Explain the reason for this adjustment (3–300 characters).");
  if (category === COMPANY_PROGRAM_CATEGORY) {
    const program = (await getPrograms()).find((item) => item.id === text(input.programId));
    if (!program) throw new Error("Select the company program being deducted.");
    reason = `${program.code} - ${program.name}: ${reason}`;
  }
  return inTransaction(async (tx) => {
    const { lines } = await lockedDraft(runId, tx);
    if (!lines.some((line) => line.employeeId === employeeId)) throw new Error("Select an employee in this payroll.");
    const id = createReadableId("PAJ");
    await tx.insert(adjustmentsTable).values({ adjustment_id: id, payroll_id: runId, employee_id: employeeId, kind, category, amount, reason, status: "active", ...encodedBy() });
    await storeRunTotals(runId, tx);
    return { id };
  });
}

export async function removePayrollAdjustment(runId: string, adjustmentId: string) {
  return inTransaction(async (tx) => {
    await lockedDraft(runId, tx);
    const removed = await tx.update(adjustmentsTable).set({ status: "removed" })
      .where(and(eq(adjustmentsTable.adjustment_id, text(adjustmentId)), eq(adjustmentsTable.payroll_id, runId), eq(adjustmentsTable.status, "active"))).returning({ id: adjustmentsTable.adjustment_id });
    if (!removed.length) throw new Error("Adjustment not found.");
    await storeRunTotals(runId, tx);
    return { id: adjustmentId };
  });
}

export async function approvePayrollRun(runId: string, isAdministrator: boolean) {
  const actor = getEncoder();
  return inTransaction(async (tx) => {
    const detail = await lockedDraft(runId, tx);
    if (!detail.lines.length) throw new Error("This payroll has no employees.");
    // Maker-checker: a second person approves, except an Administrator (same rule as remittances).
    if (detail.run.preparedByUserId === actor.userId && !isAdministrator) throw new Error("Another Finance user or an Administrator must approve a payroll you prepared.");
    await storeRunTotals(runId, tx);
    await tx.update(runsTable).set({ status: "Approved", approved_by_user_id: actor.userId, approved_by_name: actor.name, approved_at: actor.encodedAt, updated_at: actor.encodedAt }).where(eq(runsTable.payroll_id, runId));
    return { id: runId };
  });
}

/**
 * Records the payment: the run's one cash outflow, its commissions marked Paid, and the run marked Paid, all in one
 * transaction on the locked run. A second Mark paid waits for the first and then finds the run already Paid, so the
 * cash ledger can never get the payroll twice.
 */
export async function payPayrollRun(runId: string, input: Record<string, unknown>) {
  const actor = getEncoder();
  const account = text(input.cashAccount), branch = text(input.branch), reference = text(input.paymentReference);
  if (!(await getCashAccounts()).some((item) => item.name === account && item.status === "active")) throw new Error("Choose the cash account the payroll was paid from.");
  if (!branch) throw new Error("Choose the branch the payroll is charged to.");
  return inTransaction(async (tx) => {
    const { run, lines, totals } = await readRunDetail(runId, tx, true);
    if (run.status === "Paid") throw new Error("This payroll is already paid.");
    if (run.status !== "Approved") throw new Error("Approve the payroll before recording payment.");
    const paidOn = text(input.payDate) || run.payDate;
    if (!datePattern.test(paidOn)) throw new Error("Enter the pay date.");
    // One outflow in the cash ledger for the whole run; payslips carry the per-employee detail.
    const cash = totals.net > 0
      ? await createCashTransaction({ date: paidOn, direction: "outflow", category: "Payroll", description: `Payroll ${run.periodFrom} to ${run.periodTo} (${lines.length} employees)`, amount: totals.net, branch, account, referenceType: "Payroll", referenceId: runId, remarks: reference })
      : { id: "" };
    const commissionIds = [...new Set(lines.flatMap((line) => line.commissionIds))];
    if (commissionIds.length) {
      await tx.update(commissionsTable).set({ status: "Paid", paid_at: actor.encodedAt, reference_number: `${runId}${reference ? ` · ${reference}` : ""}` })
        .where(and(inArray(commissionsTable.commission_id, commissionIds), ne(commissionsTable.status, "Paid")));
    }
    await tx.update(runsTable).set({ pay_date: paidOn, status: "Paid", paid_at: actor.encodedAt, cash_account: account, payment_reference: reference || null, cash_transaction_id: cash.id || null, branch, updated_at: actor.encodedAt })
      .where(eq(runsTable.payroll_id, runId));
    return { id: runId, cashTransactionId: cash.id };
  });
}

export async function voidPayrollRun(runId: string, reason: string) {
  const actor = getEncoder();
  if (text(reason).length < 3) throw new Error("Enter the reason for voiding this payroll.");
  return inTransaction(async (tx) => {
    const { run } = await readRunDetail(runId, tx, true);
    if (!["Draft", "Approved"].includes(run.status)) throw new Error("Paid payroll cannot be voided here; record a correcting cash transaction instead.");
    await tx.update(runsTable).set({ status: "Void", void_reason: `${text(reason)} (${actor.name})`, updated_at: actor.encodedAt }).where(eq(runsTable.payroll_id, runId));
    return { id: runId };
  });
}

/**
 * Removes a Draft payroll that was made by mistake: its run, every calculated line, and every adjustment are deleted
 * together (each deleted row is kept in the Audit Log). Approved payroll is voided instead; Paid payroll is corrected
 * with a cash transaction.
 */
export async function deletePayrollRun(runId: string) {
  return inTransaction(async (tx) => {
    const { run } = await readRunDetail(runId, tx, true);
    if (run.status !== "Draft") throw new Error("Only a Draft payroll can be deleted. Void an Approved payroll instead.");
    await tx.delete(adjustmentsTable).where(eq(adjustmentsTable.payroll_id, run.id));
    await tx.delete(linesTable).where(eq(linesTable.payroll_id, run.id));
    await tx.delete(runsTable).where(eq(runsTable.payroll_id, run.id));
    return { id: run.id };
  });
}
