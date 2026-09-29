import { getAttendanceRecordsForRange } from "@/lib/attendance-data";
import { getEncoder } from "@/lib/encoder-context";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEmployees } from "@/lib/employees";
import { createCashTransaction } from "@/lib/finance-data";
import { getCashAccounts, getCommissions, payCommission } from "@/lib/finance-operations";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import {
  ADJUSTMENT_CATEGORIES, COMPANY_PROGRAM_CATEGORY, computePayrollLine, defaultPayrollSettings, runTotals,
  type Adjustment, type BaseType, type PayProfile, type PayrollLine, type PayrollSettings,
} from "@/lib/payroll-calc";
import { createReadableId } from "@/lib/readable-id";

/*
 * Sheets (npm run sheets:payroll), business columns then encoder identity:
 *   Pay Profiles        A:I  one row per employee (current rate; each payroll line snapshots the rate it used)
 *   Payroll Runs        A:X  one row per pay period
 *   Payroll Lines       A:X  one row per employee per calculation; recalculation marks old lines "replaced"
 *   Payroll Adjustments A:H  additions/deductions with a required reason; removal keeps the row
 */
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value) || 0;
const bool = (value: unknown) => ["yes", "true", "1"].includes(text(value).toLowerCase()) || value === true;
const centavos = (value: number) => Math.round(value * 100) / 100;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function rows(range: string) {
  return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" })).data.values ?? [];
}
async function write(range: string, values: unknown[][]) {
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range, valueInputOption: "RAW", requestBody: { values } });
}

// ---------- Pay profiles ----------

export async function getPayProfiles(): Promise<PayProfile[]> {
  return (await rows("'Pay Profiles'!A:I")).slice(1).filter((row) => text(row[0])).map((row) => ({
    employeeId: text(row[0]),
    baseType: (["daily", "monthly", "none"].includes(text(row[1])) ? text(row[1]) : "none") as BaseType,
    baseRate: num(row[2]),
    commissionEligible: bool(row[3]),
    hoursPerDay: num(row[4]) || 8,
    overtimeMultiplier: num(row[5]) || 1.25,
    status: text(row[6]).toLowerCase() === "inactive" ? "inactive" : "active",
    notes: text(row[7]),
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
  const values = [baseType, baseType === "none" ? 0 : baseRate, Boolean(input.commissionEligible), hoursPerDay, overtimeMultiplier, text(input.status) === "inactive" ? "inactive" : "active", text(input.notes), new Date().toISOString()];
  const data = await rows("'Pay Profiles'!A:A");
  const index = data.slice(1).findIndex((row) => text(row[0]) === employeeId);
  if (index >= 0) await write(`'Pay Profiles'!B${index + 2}:I${index + 2}`, [values]);
  else await appendEncodedRows({ range: "'Pay Profiles'!A:I", requestBody: { values: [[employeeId, ...values]] } });
  return { employeeId };
}

// ---------- Runs, lines, adjustments ----------

export type PayrollRun = {
  id: string; rowNumber: number; periodFrom: string; periodTo: string; payDate: string; status: string; settings: PayrollSettings;
  employeeCount: number; grossTotal: number; deductionsTotal: number; netTotal: number;
  preparedByUserId: string; preparedByName: string; preparedAt: string; approvedByName: string; approvedAt: string;
  paidAt: string; cashAccount: string; paymentReference: string; cashTransactionId: string; branch: string; voidReason: string; remarks: string;
};

function readRun(row: unknown[], index: number): PayrollRun {
  let settings = defaultPayrollSettings;
  try { settings = { ...defaultPayrollSettings, ...JSON.parse(text(row[5]) || "{}") }; } catch { /* keep defaults */ }
  return {
    id: text(row[0]), rowNumber: index + 2, periodFrom: text(row[1]), periodTo: text(row[2]), payDate: text(row[3]), status: text(row[4]), settings,
    employeeCount: num(row[6]), grossTotal: num(row[7]), deductionsTotal: num(row[8]), netTotal: num(row[9]),
    preparedByUserId: text(row[10]), preparedByName: text(row[11]), preparedAt: text(row[12]), approvedByName: text(row[14]), approvedAt: text(row[15]),
    paidAt: text(row[16]), cashAccount: text(row[17]), paymentReference: text(row[18]), cashTransactionId: text(row[19]), branch: text(row[20]), voidReason: text(row[21]), remarks: text(row[22]),
  };
}

type StoredLine = PayrollLine & { id: string; runId: string; rowNumber: number; status: string };

function readLine(row: unknown[], index: number): StoredLine {
  return {
    id: text(row[0]), runId: text(row[1]), rowNumber: index + 2, employeeId: text(row[2]), employeeName: text(row[3]), roles: text(row[4]),
    baseType: text(row[5]) as BaseType, baseRate: num(row[6]), dailyRate: num(row[7]), hourlyRate: num(row[8]),
    daysPaid: num(row[9]), leaveDays: num(row[10]), absentDays: num(row[11]), basePay: num(row[12]),
    overtimeHours: num(row[13]), overtimePay: num(row[14]), lateMinutes: num(row[15]), lateDeduction: num(row[16]),
    undertimeMinutes: num(row[17]), undertimeDeduction: num(row[18]), absenceDeduction: num(row[19]),
    commission: num(row[20]), commissionIds: text(row[21]).split(",").map((id) => id.trim()).filter(Boolean), earnedIncentive: num(row[22]), status: text(row[23]) || "active",
  };
}

const lineValues = (id: string, runId: string, line: PayrollLine) => [
  id, runId, line.employeeId, line.employeeName, line.roles, line.baseType, line.baseRate, line.dailyRate, line.hourlyRate,
  line.daysPaid, line.leaveDays, line.absentDays, line.basePay, line.overtimeHours, line.overtimePay, line.lateMinutes, line.lateDeduction,
  line.undertimeMinutes, line.undertimeDeduction, line.absenceDeduction, line.commission, line.commissionIds.join(", "), line.earnedIncentive, "active",
];

async function loadPayroll() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: ["'Payroll Runs'!A:X", "'Payroll Lines'!A:X", "'Payroll Adjustments'!A:H"],
    valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING",
  });
  const [runRows, lineRows, adjustmentRows] = response.data.valueRanges?.map((range) => range.values ?? []) ?? [[], [], []];
  const runs = runRows.slice(1).map(readRun).filter((run) => run.id);
  const lines = lineRows.slice(1).map(readLine).filter((line) => line.id);
  const adjustments = adjustmentRows.slice(1).map((row, index) => ({
    id: text(row[0]), rowNumber: index + 2, runId: text(row[1]), employeeId: text(row[2]), kind: (text(row[3]) === "Deduction" ? "Deduction" : "Addition") as Adjustment["kind"],
    category: text(row[4]), amount: num(row[5]), reason: text(row[6]), status: text(row[7]) || "active",
  })).filter((item) => item.id);
  return { runs, lines, adjustments };
}

export async function getPayrollOverview() {
  const [{ runs }, profiles, employees, accounts, branches, programs] = await Promise.all([loadPayroll(), getPayProfiles(), getEmployees(), getCashAccounts(), getBranches(), getPrograms()]);
  return {
    runs: runs.sort((a, b) => b.periodFrom.localeCompare(a.periodFrom) || b.id.localeCompare(a.id)),
    profiles,
    employees: employees.filter((employee) => employee.status.toLowerCase() === "active").map((employee) => ({ id: employee.id, name: employee.name, roles: employee.roles })),
    cashAccounts: accounts.filter((account) => account.status === "active").map((account) => account.name),
    branches: branches.filter((branch) => branch.status === "active").map((branch) => branch.name),
    adjustmentCategories: ADJUSTMENT_CATEGORIES,
    programs: programs.filter((program) => program.status === "active").map((program) => ({ id: program.id, code: program.code, name: program.name, basePay: program.basePay })),
  };
}

export async function getPayrollRun(runId: string) {
  const { runs, lines, adjustments } = await loadPayroll();
  const run = runs.find((item) => item.id === runId);
  if (!run) throw new Error("Payroll run not found.");
  const activeLines = lines.filter((line) => line.runId === runId && line.status === "active").sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const activeAdjustments = adjustments.filter((item) => item.runId === runId && item.status === "active");
  return { run, lines: activeLines, adjustments: activeAdjustments, totals: runTotals(activeLines, activeAdjustments) };
}

/** Earned incentive reference: gross less company remittance on remitted collections, by accountable employee. */
async function earnedIncentives(from: string, to: string) {
  const collections = await rows("'Collections'!A:AE");
  const byEmployee = new Map<string, number>();
  for (const row of collections.slice(1)) {
    const orDate = text(row[9]).slice(0, 10);
    if (!text(row[0]) || text(row[19]).toLowerCase() !== "posted" || text(row[28]) !== "Remitted" || orDate < from || orDate > to) continue;
    const employeeId = text(row[30]);
    byEmployee.set(employeeId, centavos((byEmployee.get(employeeId) ?? 0) + Math.max(0, num(row[10]) - num(row[26]))));
  }
  return byEmployee;
}

async function calculateLines(run: Pick<PayrollRun, "id" | "periodFrom" | "periodTo" | "settings">) {
  const [employees, profiles, attendance, commissions, incentives, { runs, lines }] = await Promise.all([
    getEmployees(), getPayProfiles(), getAttendanceRecordsForRange(run.periodFrom, run.periodTo), getCommissions(),
    earnedIncentives(run.periodFrom, run.periodTo), loadPayroll(),
  ]);
  // A commission may only be claimed by one live run; voided runs release theirs.
  const liveRuns = new Set(runs.filter((item) => item.status !== "Void" && item.id !== run.id).map((item) => item.id));
  const claimed = new Set(lines.filter((line) => line.status === "active" && liveRuns.has(line.runId)).flatMap((line) => line.commissionIds));
  const active = new Map(profiles.filter((profile) => profile.status === "active").map((profile) => [profile.employeeId, profile]));
  const payable = employees.filter((employee) => employee.status.toLowerCase() === "active" && active.has(employee.id));
  const missingProfiles = employees.filter((employee) => employee.status.toLowerCase() === "active" && !active.has(employee.id)).map((employee) => employee.name);
  const computed = payable.map((employee) => computePayrollLine({
    employeeId: employee.id, employeeName: employee.name, roles: employee.roles.join(", "),
    profile: active.get(employee.id)!,
    attendance: attendance.filter((record) => record.employeeId === employee.id),
    commissions: commissions.filter((item) => item.employeeId === employee.id && item.status === "Pending" && item.periodTo <= run.periodTo && !claimed.has(item.id)),
    earnedIncentive: incentives.get(employee.id) ?? 0,
    settings: run.settings, from: run.periodFrom, to: run.periodTo,
  }));
  return { computed, missingProfiles };
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

export async function createPayrollRun(input: Record<string, unknown>) {
  const actor = getEncoder();
  const periodFrom = text(input.periodFrom), periodTo = text(input.periodTo), payDate = text(input.payDate);
  if (!datePattern.test(periodFrom) || !datePattern.test(periodTo) || periodFrom > periodTo) throw new Error("Choose a valid pay period.");
  if (payDate && !datePattern.test(payDate)) throw new Error("Enter a valid pay date.");
  const { runs } = await loadPayroll();
  const overlap = runs.find((run) => run.status !== "Void" && run.periodFrom <= periodTo && periodFrom <= run.periodTo);
  if (overlap) throw new Error(`Payroll ${overlap.id} (${overlap.periodFrom} to ${overlap.periodTo}) already covers part of this period. Void it first or choose another period.`);
  const settings = readSettings(input);
  const id = createReadableId("PAY");
  const { computed, missingProfiles } = await calculateLines({ id, periodFrom, periodTo, settings });
  if (!computed.length) throw new Error("No active employee has a pay setup yet. Add pay rates first.");
  const totals = runTotals(computed, []);
  await appendEncodedRows({ range: "'Payroll Runs'!A:X", requestBody: { values: [[id, periodFrom, periodTo, payDate, "Draft", JSON.stringify(settings), computed.length, totals.gross, totals.deductions, totals.net, actor.userId, actor.name, actor.encodedAt, "", "", "", "", "", "", "", "", "", text(input.remarks), actor.encodedAt]] } });
  await appendEncodedRows({ range: "'Payroll Lines'!A:X", requestBody: { values: computed.map((line) => lineValues(createReadableId("PYL"), id, line)) } });
  return { id, missingProfiles };
}

async function draftRun(runId: string) {
  const detail = await getPayrollRun(runId);
  if (detail.run.status !== "Draft") throw new Error("Only Draft payroll runs can be changed.");
  return detail;
}

async function storeRunTotals(runId: string) {
  const detail = await getPayrollRun(runId);
  const row = detail.run.rowNumber;
  await write(`'Payroll Runs'!G${row}:J${row}`, [[detail.lines.length, detail.totals.gross, detail.totals.deductions, detail.totals.net]]);
  return detail;
}

export async function recalculatePayrollRun(runId: string, input: Record<string, unknown>) {
  const { run, lines } = await draftRun(runId);
  const settings = input.settings ? readSettings(input) : run.settings;
  const { computed, missingProfiles } = await calculateLines({ ...run, settings });
  // Previous lines stay in the sheet as "replaced" for the audit trail.
  if (lines.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: lines.map((line) => ({ range: `'Payroll Lines'!X${line.rowNumber}`, values: [["replaced"]] })) } });
  if (computed.length) await appendEncodedRows({ range: "'Payroll Lines'!A:X", requestBody: { values: computed.map((line) => lineValues(createReadableId("PYL"), runId, line)) } });
  await write(`'Payroll Runs'!F${run.rowNumber}`, [[JSON.stringify(settings)]]);
  await storeRunTotals(runId);
  return { id: runId, missingProfiles };
}

export async function addPayrollAdjustment(runId: string, input: Record<string, unknown>) {
  const { lines } = await draftRun(runId);
  const employeeId = text(input.employeeId), kind = text(input.kind), category = text(input.category), amount = centavos(num(input.amount));
  let reason = text(input.reason);
  if (!lines.some((line) => line.employeeId === employeeId)) throw new Error("Select an employee in this payroll.");
  if (kind !== "Addition" && kind !== "Deduction") throw new Error("Choose an addition or a deduction.");
  if (!(ADJUSTMENT_CATEGORIES[kind] as readonly string[]).includes(category)) throw new Error(`Choose a ${kind.toLowerCase()} category.`);
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
  if (reason.length < 3 || reason.length > 300) throw new Error("Explain the reason for this adjustment (3–300 characters).");
  if (category === COMPANY_PROGRAM_CATEGORY) {
    const program = (await getPrograms()).find((item) => item.id === text(input.programId));
    if (!program) throw new Error("Select the company program being deducted.");
    reason = `${program.code} - ${program.name}: ${reason}`;
  }
  const id = createReadableId("PAJ");
  await appendEncodedRows({ range: "'Payroll Adjustments'!A:H", requestBody: { values: [[id, runId, employeeId, kind, category, amount, reason, "active"]] } });
  await storeRunTotals(runId);
  return { id };
}

export async function removePayrollAdjustment(runId: string, adjustmentId: string) {
  await draftRun(runId);
  const { adjustments } = await loadPayroll();
  const adjustment = adjustments.find((item) => item.id === adjustmentId && item.runId === runId && item.status === "active");
  if (!adjustment) throw new Error("Adjustment not found.");
  await write(`'Payroll Adjustments'!H${adjustment.rowNumber}`, [["removed"]]);
  await storeRunTotals(runId);
  return { id: adjustmentId };
}

export async function approvePayrollRun(runId: string, isAdministrator: boolean) {
  const actor = getEncoder();
  const detail = await draftRun(runId);
  if (!detail.lines.length) throw new Error("This payroll has no employees.");
  // Maker-checker: a second person approves, except an Administrator (same rule as remittances).
  if (detail.run.preparedByUserId === actor.userId && !isAdministrator) throw new Error("Another Finance user or an Administrator must approve a payroll you prepared.");
  const stored = await storeRunTotals(runId);
  const row = stored.run.rowNumber;
  await write(`'Payroll Runs'!E${row}`, [["Approved"]]);
  await write(`'Payroll Runs'!N${row}:P${row}`, [[actor.userId, actor.name, actor.encodedAt]]);
  await write(`'Payroll Runs'!X${row}`, [[actor.encodedAt]]);
  return { id: runId };
}

export async function payPayrollRun(runId: string, input: Record<string, unknown>) {
  const actor = getEncoder();
  const { run, lines, totals } = await getPayrollRun(runId);
  if (run.status !== "Approved") throw new Error("Approve the payroll before recording payment.");
  const paidOn = text(input.payDate) || run.payDate;
  const account = text(input.cashAccount), branch = text(input.branch), reference = text(input.paymentReference);
  if (!datePattern.test(paidOn)) throw new Error("Enter the pay date.");
  if (!(await getCashAccounts()).some((item) => item.name === account && item.status === "active")) throw new Error("Choose the cash account the payroll was paid from.");
  if (!branch) throw new Error("Choose the branch the payroll is charged to.");
  // One outflow in the cash ledger for the whole run; payslips carry the per-employee detail.
  const cash = totals.net > 0
    ? await createCashTransaction({ date: paidOn, direction: "outflow", category: "Payroll", description: `Payroll ${run.periodFrom} to ${run.periodTo} (${lines.length} employees)`, amount: totals.net, branch, account, referenceType: "Payroll", referenceId: runId, remarks: reference })
    : { id: "" };
  for (const commissionId of lines.flatMap((line) => line.commissionIds)) await payCommission(commissionId, `${runId}${reference ? ` · ${reference}` : ""}`);
  await write(`'Payroll Runs'!D${run.rowNumber}:E${run.rowNumber}`, [[paidOn, "Paid"]]);
  await write(`'Payroll Runs'!Q${run.rowNumber}:U${run.rowNumber}`, [[actor.encodedAt, account, reference, cash.id, branch]]);
  await write(`'Payroll Runs'!X${run.rowNumber}`, [[actor.encodedAt]]);
  return { id: runId, cashTransactionId: cash.id };
}

export async function voidPayrollRun(runId: string, reason: string) {
  const actor = getEncoder();
  const { run } = await getPayrollRun(runId);
  if (!["Draft", "Approved"].includes(run.status)) throw new Error("Paid payroll cannot be voided here; record a correcting cash transaction instead.");
  if (text(reason).length < 3) throw new Error("Enter the reason for voiding this payroll.");
  await write(`'Payroll Runs'!E${run.rowNumber}`, [["Void"]]);
  await write(`'Payroll Runs'!V${run.rowNumber}:X${run.rowNumber}`, [[`${text(reason)} (${actor.name})`, run.remarks, actor.encodedAt]]);
  return { id: runId };
}
