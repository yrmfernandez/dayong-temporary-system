import { getEncoder } from "@/lib/encoder-context";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEmployees } from "@/lib/employees";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";
import { buildOperationalReport } from "@/lib/reports";

/**
 * Audits of each Entry Clerk's report: one per clerk per day, week (Monday to Sunday), month, or year (Entry Clerks only;
 * other roles are never audited here). HR and Administrators prepare and edit an audit; only an Administrator approves it.
 * An approved audit is locked until an Administrator reopens it with a reason. Sheets "Daily Audits", "Weekly Audits",
 * "Monthly Audits" and "Yearly Audits" share one layout (A:M business columns + encoder identity); report_date (B) holds
 * the first day of the period.
 */
export const AUDIT_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];
const SHEETS: Record<AuditPeriod, string> = { daily: "Daily Audits", weekly: "Weekly Audits", monthly: "Monthly Audits", yearly: "Yearly Audits" };
const rangeOf = (period: AuditPeriod) => `'${SHEETS[period]}'!A:Q`;
export const asAuditPeriod = (value: unknown): AuditPeriod => ((AUDIT_PERIODS as readonly string[]).includes(String(value)) ? value as AuditPeriod : "daily");
export const AUDIT_RESULTS = ["Balanced", "With findings"] as const;
export type AuditStatus = "Not started" | "Draft" | "Approved";

const text = (value: unknown) => String(value ?? "").trim();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const shift = (date: string, days: number) => { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + days); return day.toISOString().slice(0, 10); };

/** The audited span of the period containing `date`: its first day (the audit's report_date) and its last day. */
export function periodSpan(period: AuditPeriod, date: string) {
  if (!datePattern.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Choose a valid audit date.");
  if (period === "weekly") { const start = shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)); return { start, end: shift(start, 6) }; }
  if (period === "monthly") { const start = `${date.slice(0, 7)}-01`; return { start, end: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10) }; }
  if (period === "yearly") return { start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` };
  return { start: date, end: date };
}

export type AuditFigures = {
  accounts: number; gross: number; incentives: number; fidelity: number; penalty: number; expectedRemittance: number;
  sales: Array<{ program: string; branch: string; accounts: number; gross: number }>;
  collections: Array<{ program: string; branch: string; accounts: number; gross: number; expectedRemittance: number }>;
  /** Weekly, monthly and yearly audits: how the clerk's daily audits in the period stand. */
  dailyAudits?: { approved: number; balanced: number; withFindings: number; drafts: number };
};

export type DailyAudit = {
  id: string; rowNumber: number; date: string; employeeId: string; employeeName: string; status: AuditStatus;
  figures: AuditFigures | null; findings: string; result: string;
  approvedByName: string; approvedAt: string; reopenReason: string; updatedAt: string; preparedBy: string;
};

async function auditRows(period: AuditPeriod = "daily") {
  try { return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: rangeOf(period) })).data.values ?? []; }
  catch { throw new Error(period === "daily" ? "Run npm run sheets:audit-transfers -- --apply to create the Daily Audits sheet." : "Run npm run sheets:period-audits -- --apply to create the Weekly, Monthly and Yearly Audits sheets."); }
}

function readAudit(row: unknown[], index: number): DailyAudit {
  let figures: AuditFigures | null = null;
  try { figures = text(row[5]) ? JSON.parse(text(row[5])) as AuditFigures : null; } catch { figures = null; }
  return {
    id: text(row[0]), rowNumber: index + 2, date: text(row[1]), employeeId: text(row[2]), employeeName: text(row[3]),
    status: text(row[4]) === "Approved" ? "Approved" : "Draft", figures, findings: text(row[6]), result: text(row[7]),
    approvedByName: text(row[9]), approvedAt: text(row[10]), reopenReason: text(row[11]), updatedAt: text(row[12]), preparedBy: text(row[15]),
  };
}

/**
 * Active employees with the Entry Clerk role: the only people audited. `branch` is their primary branch (for display);
 * `branches` is every branch they are assigned to, primary first, so a clerk counts for each branch they serve.
 */
export async function auditedEmployees() {
  const [employees, branches] = await Promise.all([getEmployees(), getBranches()]);
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  return employees
    .filter((employee) => employee.status.toLowerCase() === "active" && employee.roles.some((role) => role.trim().toLowerCase() === "entry clerk"))
    .map((employee) => {
      const assigned = employee.branchIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
      return { employeeId: employee.id, name: employee.name, branch: employee.branch || assigned[0] || "", branches: [...new Set([employee.branch, ...assigned].filter(Boolean))] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The employee's report for the period: what they encoded, as the Daily to Yearly Reports show it with the Encoder filter.
 * Longer periods also count the clerk's daily audits inside the period.
 */
async function figuresFor(period: AuditPeriod, date: string, employee: { name: string; employeeId: string }): Promise<AuditFigures> {
  const { start, end } = periodSpan(period, date);
  const [report, dailyRows] = await Promise.all([buildOperationalReport(start, end, { encoder: employee.name }), period === "daily" ? Promise.resolve([]) : auditRows("daily")]);
  const daily = dailyRows.slice(1).map(readAudit).filter((audit) => audit.id && audit.employeeId === employee.employeeId && audit.date >= start && audit.date <= end);
  const approved = daily.filter((audit) => audit.status === "Approved");
  return {
    ...(period === "daily" ? {} : { dailyAudits: { approved: approved.length, balanced: approved.filter((audit) => audit.result === "Balanced").length, withFindings: approved.filter((audit) => audit.result === "With findings").length, drafts: daily.length - approved.length } }),
    accounts: report.summary.accounts, gross: report.summary.gross, incentives: report.summary.incentives, fidelity: report.summary.fidelity,
    penalty: report.summary.penalty, expectedRemittance: report.summary.net,
    sales: report.sales.map((line) => ({ program: line.programName, branch: line.branch, accounts: line.accounts, gross: line.gross })),
    collections: report.collections.map((line) => ({ program: line.programName, branch: line.branch, accounts: line.accounts, gross: line.gross, expectedRemittance: line.expectedRemittance })),
  };
}

export async function getDailyAudits(day: string, period: AuditPeriod = "daily") {
  const date = periodSpan(period, day).start;
  const [employees, rows] = await Promise.all([auditedEmployees(), auditRows(period)]);
  const saved = rows.slice(1).map(readAudit).filter((audit) => audit.id && audit.date === date);
  return Promise.all(employees.map(async (employee) => {
    const audit = saved.find((item) => item.employeeId === employee.employeeId);
    // Approved audits show the figures they were approved on; open ones show the current report.
    const figures = audit?.status === "Approved" && audit.figures ? audit.figures : await figuresFor(period, date, employee);
    return { employeeId: employee.employeeId, employeeName: employee.name, branch: employee.branch, status: (audit?.status ?? "Not started") as AuditStatus, audit: audit ?? null, figures };
  }));
}

async function findAudit(period: AuditPeriod, date: string, employeeId: string) {
  const rows = await auditRows(period);
  return rows.slice(1).map(readAudit).find((audit) => audit.id && audit.date === date && audit.employeeId === employeeId) ?? null;
}

/** HR or an Administrator saves the audit's findings and result. Approved audits are locked. */
export async function saveDailyAudit(input: { date: string; employeeId: string; findings: string; result: string; period?: AuditPeriod }) {
  const period = input.period ?? "daily";
  const date = periodSpan(period, text(input.date)).start, employeeId = text(input.employeeId), findings = text(input.findings), result = text(input.result);
  if (!(AUDIT_RESULTS as readonly string[]).includes(result)) throw new Error("Choose Balanced or With findings.");
  if (result === "With findings" && findings.length < 3) throw new Error("Describe the findings.");
  if (findings.length > 2000) throw new Error("Findings must be 2,000 characters or fewer.");
  const employee = (await auditedEmployees()).find((item) => item.employeeId === employeeId);
  if (!employee) throw new Error("Only active Entry Clerks are audited.");
  const existing = await findAudit(period, date, employeeId);
  if (existing?.status === "Approved") throw new Error("This audit is approved and locked. An Administrator must reopen it first.");
  const figures = JSON.stringify(await figuresFor(period, date, employee));
  const now = new Date().toISOString();
  if (existing) {
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEETS[period]}'!E${existing.rowNumber}:M${existing.rowNumber}`, valueInputOption: "RAW",
      requestBody: { values: [["Draft", figures, findings, result, "", "", "", existing.reopenReason, now]] } });
    return { id: existing.id, status: "Draft" as const };
  }
  const id = createReadableId("AUD");
  await appendEncodedRows({ range: rangeOf(period), valueInputOption: "RAW", requestBody: { values: [[id, date, employeeId, employee.name, "Draft", figures, findings, result, "", "", "", "", now]] } });
  return { id, status: "Draft" as const };
}

/** Only an Administrator approves (locks the figures) or reopens (with a reason) an audit. */
export async function decideDailyAudit(input: { date: string; employeeId: string; decision: "approve" | "reopen"; reason?: string; period?: AuditPeriod }) {
  const actor = getEncoder();
  const period = input.period ?? "daily";
  const audit = await findAudit(period, periodSpan(period, text(input.date)).start, text(input.employeeId));
  if (!audit) throw new Error("Save the audit before approving it.");
  const now = new Date().toISOString();
  if (input.decision === "approve") {
    if (audit.status === "Approved") throw new Error("This audit is already approved.");
    const figures = JSON.stringify(await figuresFor(period, audit.date, { name: audit.employeeName, employeeId: audit.employeeId }));
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEETS[period]}'!E${audit.rowNumber}:M${audit.rowNumber}`, valueInputOption: "RAW",
      requestBody: { values: [["Approved", figures, audit.findings, audit.result, actor.userId, actor.name, now, audit.reopenReason, now]] } });
    return { id: audit.id, status: "Approved" as const };
  }
  const reason = text(input.reason);
  if (audit.status !== "Approved") throw new Error("Only an approved audit can be reopened.");
  if (reason.length < 3) throw new Error("Give a reason for reopening the audit.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${SHEETS[period]}'!E${audit.rowNumber}:M${audit.rowNumber}`, valueInputOption: "RAW",
    requestBody: { values: [["Draft", JSON.stringify(audit.figures), audit.findings, audit.result, "", "", "", reason, now]] } });
  return { id: audit.id, status: "Draft" as const };
}

export type AuditSummaryFilters = { from: string; to: string; branch?: string; employeeId?: string };

/**
 * Approved audits in a date range, optionally for one branch (any branch the clerk is assigned to) and one Entry Clerk, with
 * totals and a per-clerk breakdown. Only approved audits count; drafts and missing days are reported separately.
 */
export async function getAuditSummary(filters: AuditSummaryFilters) {
  const from = text(filters.from), to = text(filters.to), branch = text(filters.branch), employeeId = text(filters.employeeId);
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) throw new Error("Choose a valid date range.");
  const [clerks, rows] = await Promise.all([auditedEmployees(), auditRows()]);
  const inScope = clerks.filter((clerk) => (!branch || clerk.branches.includes(branch)) && (!employeeId || clerk.employeeId === employeeId));
  const ids = new Set(inScope.map((clerk) => clerk.employeeId));
  const all = rows.slice(1).map(readAudit).filter((audit) => audit.id && audit.date >= from && audit.date <= to && ids.has(audit.employeeId));
  const approved = all.filter((audit) => audit.status === "Approved").sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
  const branchOf = new Map(clerks.map((clerk) => [clerk.employeeId, clerk.branch]));
  const zero = { accounts: 0, gross: 0, incentives: 0, fidelity: 0, penalty: 0, expectedRemittance: 0 };
  const add = (sum: typeof zero, figures: AuditFigures | null) => {
    for (const key of Object.keys(zero) as Array<keyof typeof zero>) sum[key] = Math.round((sum[key] + Number(figures?.[key] ?? 0)) * 100) / 100;
    return sum;
  };
  const totals = approved.reduce((sum, audit) => add(sum, audit.figures), { ...zero });
  const byClerk = inScope.map((clerk) => {
    const own = approved.filter((audit) => audit.employeeId === clerk.employeeId);
    return {
      employeeId: clerk.employeeId, name: clerk.name, branch: clerk.branch, branches: clerk.branches, approvedDays: own.length,
      balanced: own.filter((audit) => audit.result === "Balanced").length, withFindings: own.filter((audit) => audit.result === "With findings").length,
      drafts: all.filter((audit) => audit.employeeId === clerk.employeeId && audit.status !== "Approved").length,
      ...own.reduce((sum, audit) => add(sum, audit.figures), { ...zero }),
    };
  });
  return {
    from, to, branch, employeeId,
    clerks: clerks.map((clerk) => ({ employeeId: clerk.employeeId, name: clerk.name, branch: clerk.branch, branches: clerk.branches })),
    branches: [...new Set(clerks.flatMap((clerk) => clerk.branches))].sort(),
    counts: { approved: approved.length, balanced: approved.filter((audit) => audit.result === "Balanced").length, withFindings: approved.filter((audit) => audit.result === "With findings").length, drafts: all.length - approved.length },
    totals, byClerk,
    audits: approved.map((audit) => ({ date: audit.date, employeeId: audit.employeeId, employeeName: audit.employeeName, branch: branchOf.get(audit.employeeId) ?? "", result: audit.result, findings: audit.findings, approvedByName: audit.approvedByName, approvedAt: audit.approvedAt, figures: audit.figures })),
  };
}
