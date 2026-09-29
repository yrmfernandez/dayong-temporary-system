import { canAccessPath, type AccessContext } from "@/lib/access-control";
import { getEncoder } from "@/lib/encoder-context";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getUserAccounts } from "@/lib/master-data-crud";
import { createReadableId } from "@/lib/readable-id";
import { buildOperationalReport } from "@/lib/reports";
import { getRoles } from "@/lib/roles";

/**
 * Daily Audit: one audit per employee per day, covering everyone whose roles can open the Daily Report.
 * HR and Administrators prepare and edit an audit; only an Administrator approves it. An approved audit is locked
 * until an Administrator reopens it with a reason. Sheet "Daily Audits" (A:M business columns + encoder identity).
 */
const RANGE = "'Daily Audits'!A:Q";
export const AUDIT_RESULTS = ["Balanced", "With findings"] as const;
export type AuditStatus = "Not started" | "Draft" | "Approved";

const text = (value: unknown) => String(value ?? "").trim();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type AuditFigures = {
  accounts: number; gross: number; incentives: number; fidelity: number; penalty: number; expectedRemittance: number;
  sales: Array<{ program: string; branch: string; accounts: number; gross: number }>;
  collections: Array<{ program: string; branch: string; accounts: number; gross: number; expectedRemittance: number }>;
};

export type DailyAudit = {
  id: string; rowNumber: number; date: string; employeeId: string; employeeName: string; status: AuditStatus;
  figures: AuditFigures | null; findings: string; result: string;
  approvedByName: string; approvedAt: string; reopenReason: string; updatedAt: string; preparedBy: string;
};

async function auditRows() {
  try { return (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: RANGE })).data.values ?? []; }
  catch { throw new Error("Run npm run sheets:audit-transfers -- --apply to create the Daily Audits sheet."); }
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

/** Active sign-in accounts whose roles can open the Daily Report (Reports), i.e. the people audited each day. */
export async function auditedEmployees() {
  const [accounts, roles] = await Promise.all([getUserAccounts(), getRoles()]);
  const byName = new Map(roles.map((role) => [role.name.trim().toLowerCase(), role]));
  return accounts.filter((account) => account.status.toLowerCase() === "active").filter((account) => {
    const own = account.roles.map((name) => byName.get(name.trim().toLowerCase())).filter((role): role is NonNullable<typeof role> => Boolean(role && role.status === "active"));
    const context: AccessContext = {
      roleNames: own.map((role) => role.name),
      permissions: { manageUsers: own.some((role) => role.manageUsers), manageAttendance: own.some((role) => role.manageAttendance), viewAttendanceReports: own.some((role) => role.viewAttendanceReports) },
      rolePages: Object.fromEntries(own.filter((role) => role.pages).map((role) => [role.name.trim().toLowerCase(), role.pages as string[]])),
    };
    return canAccessPath(context, "/reports/daily");
  }).map((account) => ({ employeeId: account.employeeId, name: account.fullName }));
}

/** The employee's Daily Report for the date: what they encoded, as the Daily Report shows it with the Encoder filter. */
async function figuresFor(date: string, name: string): Promise<AuditFigures> {
  const report = await buildOperationalReport(date, date, { encoder: name });
  return {
    accounts: report.summary.accounts, gross: report.summary.gross, incentives: report.summary.incentives, fidelity: report.summary.fidelity,
    penalty: report.summary.penalty, expectedRemittance: report.summary.net,
    sales: report.sales.map((line) => ({ program: line.programName, branch: line.branch, accounts: line.accounts, gross: line.gross })),
    collections: report.collections.map((line) => ({ program: line.programName, branch: line.branch, accounts: line.accounts, gross: line.gross, expectedRemittance: line.expectedRemittance })),
  };
}

export async function getDailyAudits(date: string) {
  if (!datePattern.test(date)) throw new Error("Choose a valid audit date.");
  const [employees, rows] = await Promise.all([auditedEmployees(), auditRows()]);
  const saved = rows.slice(1).map(readAudit).filter((audit) => audit.id && audit.date === date);
  return Promise.all(employees.map(async (employee) => {
    const audit = saved.find((item) => item.employeeId === employee.employeeId);
    // Approved audits show the figures they were approved on; open ones show the current report.
    const figures = audit?.status === "Approved" && audit.figures ? audit.figures : await figuresFor(date, employee.name);
    return { employeeId: employee.employeeId, employeeName: employee.name, status: (audit?.status ?? "Not started") as AuditStatus, audit: audit ?? null, figures };
  }));
}

async function findAudit(date: string, employeeId: string) {
  const rows = await auditRows();
  return rows.slice(1).map(readAudit).find((audit) => audit.id && audit.date === date && audit.employeeId === employeeId) ?? null;
}

/** HR or an Administrator saves the audit's findings and result. Approved audits are locked. */
export async function saveDailyAudit(input: { date: string; employeeId: string; findings: string; result: string }) {
  const date = text(input.date), employeeId = text(input.employeeId), findings = text(input.findings), result = text(input.result);
  if (!datePattern.test(date)) throw new Error("Choose a valid audit date.");
  if (!(AUDIT_RESULTS as readonly string[]).includes(result)) throw new Error("Choose Balanced or With findings.");
  if (result === "With findings" && findings.length < 3) throw new Error("Describe the findings.");
  if (findings.length > 2000) throw new Error("Findings must be 2,000 characters or fewer.");
  const employee = (await auditedEmployees()).find((item) => item.employeeId === employeeId);
  if (!employee) throw new Error("This employee does not have Daily Report access to audit.");
  const existing = await findAudit(date, employeeId);
  if (existing?.status === "Approved") throw new Error("This audit is approved and locked. An Administrator must reopen it first.");
  const figures = JSON.stringify(await figuresFor(date, employee.name));
  const now = new Date().toISOString();
  if (existing) {
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Daily Audits'!E${existing.rowNumber}:M${existing.rowNumber}`, valueInputOption: "RAW",
      requestBody: { values: [["Draft", figures, findings, result, "", "", "", existing.reopenReason, now]] } });
    return { id: existing.id, status: "Draft" as const };
  }
  const id = createReadableId("AUD");
  await appendEncodedRows({ range: RANGE, valueInputOption: "RAW", requestBody: { values: [[id, date, employeeId, employee.name, "Draft", figures, findings, result, "", "", "", "", now]] } });
  return { id, status: "Draft" as const };
}

/** Only an Administrator approves (locks the figures) or reopens (with a reason) an audit. */
export async function decideDailyAudit(input: { date: string; employeeId: string; decision: "approve" | "reopen"; reason?: string }) {
  const actor = getEncoder();
  const audit = await findAudit(text(input.date), text(input.employeeId));
  if (!audit) throw new Error("Save the audit before approving it.");
  const now = new Date().toISOString();
  if (input.decision === "approve") {
    if (audit.status === "Approved") throw new Error("This audit is already approved.");
    const figures = JSON.stringify(await figuresFor(audit.date, audit.employeeName));
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Daily Audits'!E${audit.rowNumber}:M${audit.rowNumber}`, valueInputOption: "RAW",
      requestBody: { values: [["Approved", figures, audit.findings, audit.result, actor.userId, actor.name, now, audit.reopenReason, now]] } });
    return { id: audit.id, status: "Approved" as const };
  }
  const reason = text(input.reason);
  if (audit.status !== "Approved") throw new Error("Only an approved audit can be reopened.");
  if (reason.length < 3) throw new Error("Give a reason for reopening the audit.");
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `'Daily Audits'!E${audit.rowNumber}:M${audit.rowNumber}`, valueInputOption: "RAW",
    requestBody: { values: [["Draft", JSON.stringify(audit.figures), audit.findings, audit.result, "", "", "", reason, now]] } });
  return { id: audit.id, status: "Draft" as const };
}
