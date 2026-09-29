// Pure payroll calculation: no Sheets access, so it can be tested and previewed safely.

/** Attendance is Monday–Saturday (lib/attendance.ts), so monthly salaries convert with the 313-day factor. */
export const WORKING_DAYS_PER_YEAR = 313;

export type BaseType = "daily" | "monthly" | "none";

export type PayProfile = {
  employeeId: string;
  baseType: BaseType;
  /** Daily rate, or monthly salary when baseType is "monthly". */
  baseRate: number;
  /** MAS and other commission earners; commissions come from the Commissions records. */
  commissionEligible: boolean;
  hoursPerDay: number;
  overtimeMultiplier: number;
  status: "active" | "inactive";
  notes: string;
};

export type PayrollSettings = {
  /** attendance: days present × daily rate. scheduled: every Mon–Sat in the period × daily rate. */
  baseMethod: "attendance" | "scheduled";
  includeOvertime: boolean;
  deductLate: boolean;
  deductUndertime: boolean;
  payApprovedLeave: boolean;
  /** Scheduled method only: deduct recorded Absent/AWOL (and unpaid leave) days. */
  deductAbsences: boolean;
  includeCommissions: boolean;
};

export const defaultPayrollSettings: PayrollSettings = {
  baseMethod: "attendance", includeOvertime: true, deductLate: true, deductUndertime: true,
  payApprovedLeave: true, deductAbsences: true, includeCommissions: true,
};

export type AttendanceDay = { status: string; overtimeHours: number; lateMinutes: number; undertimeMinutes: number; leaveApprovalStatus: string };
export type CommissionItem = { id: string; netCommission: number };

export type PayrollLine = {
  employeeId: string;
  employeeName: string;
  roles: string;
  baseType: BaseType;
  baseRate: number;
  dailyRate: number;
  hourlyRate: number;
  daysPaid: number;
  leaveDays: number;
  absentDays: number;
  basePay: number;
  overtimeHours: number;
  overtimePay: number;
  lateMinutes: number;
  lateDeduction: number;
  undertimeMinutes: number;
  undertimeDeduction: number;
  absenceDeduction: number;
  commission: number;
  commissionIds: string[];
  /** Reference only: incentives earned on remitted collections in the period. */
  earnedIncentive: number;
};

export type Adjustment = { id: string; employeeId: string; kind: "Addition" | "Deduction"; category: string; amount: number; reason: string };

/** A deduction for the employee's own enrollment in a company program; it names the program in its reason. */
export const COMPANY_PROGRAM_CATEGORY = "Company program";

// Categories offered per kind. Older rows may hold retired names ("Loan repayment", "Other") and still display as recorded.
export const ADJUSTMENT_CATEGORIES = {
  Addition: [
    "Performance bonus", "Sales / production bonus", "13th month pay", "Holiday / special day pay", "Allowance",
    "Attendance incentive", "Salary adjustment / back pay", "Management discretion", "Other addition",
  ],
  Deduction: [
    "SSS contribution", "PhilHealth contribution", "Pag-IBIG (HDMF) contribution", "Withholding tax",
    "SSS loan", "Pag-IBIG loan", COMPANY_PROGRAM_CATEGORY, "Cash advance", "Company loan repayment",
    "Shortage / accountability", "Attendance deduction", "Other deduction",
  ],
} as const satisfies Record<Adjustment["kind"], readonly string[]>;

const centavos = (value: number) => Math.round(value * 100) / 100;

export function dailyRateOf(profile: Pick<PayProfile, "baseType" | "baseRate">) {
  if (profile.baseType === "daily") return centavos(profile.baseRate);
  if (profile.baseType === "monthly") return centavos(profile.baseRate * 12 / WORKING_DAYS_PER_YEAR);
  return 0;
}

/** Monday–Saturday dates between from and to (inclusive, YYYY-MM-DD). */
export function scheduledWorkingDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let days = 0;
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) if (day.getUTCDay() !== 0) days++;
  return days;
}

export function computePayrollLine(input: {
  employeeId: string; employeeName: string; roles: string;
  profile: PayProfile; attendance: AttendanceDay[]; commissions: CommissionItem[]; earnedIncentive: number;
  settings: PayrollSettings; from: string; to: string;
}): PayrollLine {
  const { profile, attendance, settings } = input;
  const hasBase = profile.baseType !== "none" && profile.baseRate > 0;
  const dailyRate = hasBase ? dailyRateOf(profile) : 0;
  const hourlyRate = hasBase && profile.hoursPerDay > 0 ? dailyRate / profile.hoursPerDay : 0;
  const present = attendance.filter((day) => day.status === "Present");
  const approvedLeave = attendance.filter((day) => day.status === "Leave" && day.leaveApprovalStatus.toLowerCase() === "approved").length;
  const unpaidLeave = attendance.filter((day) => day.status === "Leave").length - (settings.payApprovedLeave ? approvedLeave : 0);
  const absences = attendance.filter((day) => day.status === "Absent" || day.status === "AWOL").length;
  const leaveDays = settings.payApprovedLeave ? approvedLeave : 0;

  let daysPaid = 0, basePay = 0, absentDays = 0, absenceDeduction = 0;
  if (hasBase && settings.baseMethod === "attendance") {
    daysPaid = present.length + leaveDays;
    basePay = daysPaid * dailyRate;
    absentDays = absences;
  } else if (hasBase) {
    daysPaid = scheduledWorkingDays(input.from, input.to);
    basePay = daysPaid * dailyRate;
    absentDays = absences + unpaidLeave;
    // Only recorded absences are deducted; days with no attendance row are not assumed absent.
    if (settings.deductAbsences) absenceDeduction = Math.min(basePay, absentDays * dailyRate);
  }

  const overtimeHours = centavos(present.reduce((sum, day) => sum + day.overtimeHours, 0));
  const lateMinutes = present.reduce((sum, day) => sum + day.lateMinutes, 0);
  const undertimeMinutes = present.reduce((sum, day) => sum + day.undertimeMinutes, 0);
  const overtimePay = hasBase && settings.includeOvertime ? overtimeHours * hourlyRate * profile.overtimeMultiplier : 0;
  const lateDeduction = hasBase && settings.deductLate ? lateMinutes * hourlyRate / 60 : 0;
  const undertimeDeduction = hasBase && settings.deductUndertime ? undertimeMinutes * hourlyRate / 60 : 0;
  const commissions = profile.commissionEligible && settings.includeCommissions ? input.commissions : [];

  return {
    employeeId: input.employeeId, employeeName: input.employeeName, roles: input.roles,
    baseType: profile.baseType, baseRate: centavos(profile.baseRate), dailyRate, hourlyRate: centavos(hourlyRate),
    daysPaid, leaveDays, absentDays, basePay: centavos(basePay),
    overtimeHours, overtimePay: centavos(overtimePay),
    lateMinutes, lateDeduction: centavos(lateDeduction),
    undertimeMinutes, undertimeDeduction: centavos(undertimeDeduction),
    absenceDeduction: centavos(absenceDeduction),
    commission: centavos(commissions.reduce((sum, item) => sum + item.netCommission, 0)),
    commissionIds: commissions.map((item) => item.id),
    earnedIncentive: centavos(input.earnedIncentive),
  };
}

/** Earnings, deductions, and net pay for one line including its adjustments. Net pay never goes below zero. */
export function lineTotals(line: PayrollLine, adjustments: Adjustment[]) {
  const own = adjustments.filter((item) => item.employeeId === line.employeeId);
  const additions = centavos(own.filter((item) => item.kind === "Addition").reduce((sum, item) => sum + item.amount, 0));
  const adjustmentDeductions = centavos(own.filter((item) => item.kind === "Deduction").reduce((sum, item) => sum + item.amount, 0));
  const gross = centavos(line.basePay + line.overtimePay + line.commission + additions);
  const deductions = centavos(line.lateDeduction + line.undertimeDeduction + line.absenceDeduction + adjustmentDeductions);
  return { additions, adjustmentDeductions, gross, deductions, net: Math.max(0, centavos(gross - deductions)), shortfall: Math.max(0, centavos(deductions - gross)) };
}

export function runTotals(lines: PayrollLine[], adjustments: Adjustment[]) {
  return lines.reduce((sum, line) => {
    const totals = lineTotals(line, adjustments);
    return { gross: centavos(sum.gross + totals.gross), deductions: centavos(sum.deductions + totals.deductions), net: centavos(sum.net + totals.net) };
  }, { gross: 0, deductions: 0, net: 0 });
}
