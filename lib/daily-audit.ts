import { and, eq, sql } from "drizzle-orm";

import { currentDb, encodedBy, getDb, inTransaction, schema, type Queryable } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { createReadableId } from "@/lib/readable-id";
import { buildClerkReport } from "@/lib/clerk-report";
import { formatDate, formatMonth } from "@/lib/date-format";
import { manilaDateOf } from "@/lib/manila-date";

/**
 * Audits of each Entry Clerk's report: one per clerk per day, week (Monday to Sunday), month, or year (Entry Clerks only;
 * other roles are never audited here). HR and Administrators prepare and edit an audit; only an Administrator approves it.
 * An approved audit is locked until an Administrator reopens it with a reason. Tables daily_audits, weekly_audits,
 * monthly_audits and yearly_audits share one layout; report_date holds the first day of the period.
 *
 * Read and written directly by ID (owner, October 24, 2026; upgrade #6 phase 4, replacing Sheets-style row writes):
 * saving takes a lock on the clerk and period, so two saves at once keep one audit; approving and reopening lock the
 * audit's row and update it once.
 *
 * The clerk sees their audit on their own report, and an approved report is locked for them too (owner, October 27,
 * 2026): no expense, deposit, Fidelity, Cash Beg or notes saved on it until an Administrator allows that one report to
 * be edited again (allow-edit; lock closes it again). The audit itself stays approved with the figures it was approved on.
 */
export const AUDIT_PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];
type AuditTable = typeof schema.daily_audits;
const TABLES: Record<AuditPeriod, AuditTable> = { daily: schema.daily_audits, weekly: schema.weekly_audits as unknown as AuditTable, monthly: schema.monthly_audits as unknown as AuditTable, yearly: schema.yearly_audits as unknown as AuditTable };
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
  /** Each branch the clerk encoded for (each equal to that branch's report); the totals above are all branches. */
  byBranch?: Array<{ branch: string; accounts: number; gross: number; incentives: number; net: number; fidelity: number; penalty: number }>;
  /** Weekly, monthly and yearly audits: how the clerk's daily audits in the period stand. */
  dailyAudits?: { approved: number; balanced: number; withFindings: number; drafts: number };
};

export type DailyAudit = {
  id: string; date: string; employeeId: string; employeeName: string; status: AuditStatus;
  figures: AuditFigures | null; findings: string; result: string;
  approvedByName: string; approvedAt: string; reopenReason: string; updatedAt: string; preparedBy: string;
  /** Set while an Administrator lets the clerk edit the approved report. */
  editAllowedByName: string; editAllowedAt: string; editReason: string;
};

function readAudit(row: AuditTable["$inferSelect"]): DailyAudit {
  let figures: unknown = row.figures_json;
  // Audits saved through the Sheets layer kept the figures as JSON text.
  if (typeof figures === "string") { try { figures = figures ? JSON.parse(figures) : null; } catch { figures = null; } }
  return {
    id: row.audit_id, date: text(row.report_date), employeeId: text(row.employee_id), employeeName: text(row.employee_name),
    status: text(row.status) === "Approved" ? "Approved" : "Draft", figures: (figures ?? null) as AuditFigures | null, findings: text(row.findings), result: text(row.result),
    approvedByName: text(row.approved_by_name), approvedAt: text(row.approved_at), reopenReason: text(row.reopen_reason), updatedAt: text(row.updated_at), preparedBy: text(row.encoded_by_name),
    editAllowedByName: text(row.clerk_edit_allowed_by_name), editAllowedAt: text(row.clerk_edit_allowed_at), editReason: text(row.clerk_edit_reason),
  };
}

/** A period's audits, optionally only those from one first day to another (report_date). */
async function loadAudits(period: AuditPeriod = "daily", from = "", to = "", db: Queryable = currentDb()) {
  const table = TABLES[period];
  const rows = await db.select().from(table).where(from && to ? sql`${table.report_date} between ${from}::date and ${to}::date` : undefined);
  return rows.map(readAudit).filter((audit) => audit.id);
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
 * The clerk's own report for the period (lib/clerk-report.ts): what they encoded, exactly as they and Report Review see
 * it. Longer periods also count the clerk's daily audits inside the period.
 */
async function figuresFor(period: AuditPeriod, date: string, employee: { name: string; employeeId: string }): Promise<AuditFigures> {
  const { start, end } = periodSpan(period, date);
  const [report, dailyAudits] = await Promise.all([buildClerkReport(period, start, employee), period === "daily" ? Promise.resolve([] as DailyAudit[]) : loadAudits("daily", start, end)]);
  const daily = dailyAudits.filter((audit) => audit.employeeId === employee.employeeId);
  const approved = daily.filter((audit) => audit.status === "Approved");
  return {
    ...(period === "daily" ? {} : { dailyAudits: { approved: approved.length, balanced: approved.filter((audit) => audit.result === "Balanced").length, withFindings: approved.filter((audit) => audit.result === "With findings").length, drafts: daily.length - approved.length } }),
    accounts: report.totals.accounts, gross: report.totals.gross, incentives: report.totals.incentives, fidelity: report.totals.fidelity,
    penalty: report.checks.penalties, expectedRemittance: report.totals.net,
    sales: report.byProgram.sales.map((line) => ({ program: line.program, branch: line.branch, accounts: line.accounts, gross: line.gross })),
    collections: report.byProgram.collections,
    byBranch: report.byBranch,
  };
}

/** Employees present on any day from `from` to `to`: clocked in, or marked Present. */
async function presentEmployees(from: string, to: string) {
  const result = await getDb().execute(sql`select distinct employee_id from attendance
    where attendance_date between ${from}::date and ${to}::date and (attendance_status = 'Present' or coalesce(trim(time_in::text), '') <> '')`);
  return new Set(((Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ employee_id: string }>).map((row) => row.employee_id));
}

export async function getDailyAudits(day: string, period: AuditPeriod = "daily") {
  const { start: date, end } = periodSpan(period, day);
  const [employees, saved, present] = await Promise.all([auditedEmployees(), loadAudits(period, date, date), presentEmployees(date, end)]);
  const all = await Promise.all(employees.map(async (employee) => {
    const audit = saved.find((item) => item.employeeId === employee.employeeId);
    // Approved audits show the figures they were approved on; open ones show the current report.
    const figures = audit?.status === "Approved" && audit.figures ? audit.figures : await figuresFor(period, date, employee);
    return { employeeId: employee.employeeId, employeeName: employee.name, branch: employee.branch, status: (audit?.status ?? "Not started") as AuditStatus, audit: audit ?? null, figures };
  }));
  // Only Entry Clerks who were present (owner, October 14, 2026): clocked in or marked Present in the period, or who
  // encoded something in it (they worked), or who already have an audit for it.
  return all.filter((row) => present.has(row.employeeId) || row.figures.accounts > 0 || row.audit);
}

/** The clerk's audit for the period, locked for the rest of the caller's transaction. */
async function lockedAudit(tx: Queryable, period: AuditPeriod, date: string, employeeId: string) {
  const table = TABLES[period];
  const [row] = await tx.select().from(table).where(and(eq(table.report_date, date), eq(table.employee_id, employeeId))).orderBy(table.row_seq).limit(1).for("update");
  return row ? readAudit(row) : null;
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
  const figures = await figuresFor(period, date, employee);
  const table = TABLES[period];
  return inTransaction(async (tx) => {
    // One audit per clerk and period: a second save at the same moment waits and then updates the same audit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit:${period}:${date}:${employeeId}`}))`);
    const existing = await lockedAudit(tx, period, date, employeeId);
    if (existing?.status === "Approved") throw new Error("This audit is approved and locked. An Administrator must reopen it first.");
    const now = new Date().toISOString();
    if (existing) {
      await tx.update(table).set({ status: "Draft", figures_json: figures, findings, result, approved_by_user_id: null, approved_by_name: null, approved_at: null, updated_at: now }).where(eq(table.audit_id, existing.id));
      return { id: existing.id, status: "Draft" as const };
    }
    const id = createReadableId("AUD");
    await tx.insert(table).values({ audit_id: id, report_date: date, employee_id: employeeId, employee_name: employee.name, status: "Draft", figures_json: figures, findings, result, updated_at: now, ...encodedBy() });
    return { id, status: "Draft" as const };
  });
}

export const AUDIT_DECISIONS = ["approve", "reopen", "allow-edit", "lock"] as const;
export type AuditDecision = (typeof AUDIT_DECISIONS)[number];
const noEditAllowed = { clerk_edit_allowed_by_name: null, clerk_edit_allowed_at: null, clerk_edit_reason: null };

/**
 * Only an Administrator approves (locks the figures) or reopens (with a reason) an audit, and allows the clerk to edit
 * an approved report again (with a reason) or locks it again. Approving or reopening ends an allowance.
 */
export async function decideDailyAudit(input: { date: string; employeeId: string; decision: AuditDecision; reason?: string; period?: AuditPeriod }) {
  const actor = getEncoder();
  const period = input.period ?? "daily";
  const date = periodSpan(period, text(input.date)).start, employeeId = text(input.employeeId);
  const table = TABLES[period];
  const reason = text(input.reason);
  // The figures to lock in are worked out before the transaction; the status is checked again inside it.
  const before = await lockedAudit(currentDb(), period, date, employeeId);
  if (!before) throw new Error("Save the audit before approving it.");
  const figures = input.decision === "approve" ? await figuresFor(period, before.date, { name: before.employeeName, employeeId: before.employeeId }) : null;
  return inTransaction(async (tx) => {
    const audit = await lockedAudit(tx, period, date, employeeId);
    if (!audit) throw new Error("Save the audit before approving it.");
    const now = new Date().toISOString();
    if (input.decision === "approve") {
      if (audit.status === "Approved") throw new Error("This audit is already approved.");
      await tx.update(table).set({ status: "Approved", figures_json: figures, approved_by_user_id: actor.userId, approved_by_name: actor.name, approved_at: now, updated_at: now, ...noEditAllowed }).where(eq(table.audit_id, audit.id));
      return { id: audit.id, status: "Approved" as const };
    }
    if (input.decision === "allow-edit" || input.decision === "lock") {
      if (audit.status !== "Approved") throw new Error("Only an approved report is locked for the clerk.");
      if (input.decision === "lock") {
        if (!audit.editAllowedAt) throw new Error("This report is already locked for the clerk.");
        await tx.update(table).set({ ...noEditAllowed, updated_at: now }).where(eq(table.audit_id, audit.id));
        return { id: audit.id, status: "Approved" as const };
      }
      if (audit.editAllowedAt) throw new Error("The clerk is already allowed to edit this report.");
      if (reason.length < 3) throw new Error("Give a reason for letting the clerk edit the report.");
      await tx.update(table).set({ clerk_edit_allowed_by_name: actor.name, clerk_edit_allowed_at: now, clerk_edit_reason: reason.slice(0, 300), updated_at: now }).where(eq(table.audit_id, audit.id));
      return { id: audit.id, status: "Approved" as const };
    }
    if (audit.status !== "Approved") throw new Error("Only an approved audit can be reopened.");
    if (reason.length < 3) throw new Error("Give a reason for reopening the audit.");
    await tx.update(table).set({ status: "Draft", approved_by_user_id: null, approved_by_name: null, approved_at: null, reopen_reason: reason, updated_at: now, ...noEditAllowed }).where(eq(table.audit_id, audit.id));
    return { id: audit.id, status: "Draft" as const };
  });
}

const PERIOD_NAMES: Record<AuditPeriod, (start: string) => string> = {
  daily: (start) => `report for ${formatDate(start)}`, weekly: (start) => `report for the week of ${formatDate(start)}`,
  monthly: (start) => `report for ${formatMonth(start)}`, yearly: (start) => `report for ${start.slice(0, 4)}`,
};

/**
 * Why the clerk cannot change what falls on `date`: their audit of that day, or of the week, month or year containing it,
 * is approved and an Administrator has not allowed editing it. `from` skips the shorter periods (a week's notes belong to
 * the week, not to its days). "" when nothing locks it.
 */
export async function reportLockProblem(employeeId: string, date: string, from: AuditPeriod = "daily") {
  if (!datePattern.test(date)) return "";
  for (const period of AUDIT_PERIODS.slice(AUDIT_PERIODS.indexOf(from))) {
    const table = TABLES[period], { start } = periodSpan(period, date);
    const [row] = await currentDb().select({ allowed: table.clerk_edit_allowed_at }).from(table)
      .where(and(eq(table.employee_id, employeeId), eq(table.report_date, start), eq(table.status, "Approved"))).limit(1);
    if (row && !row.allowed) return `Your ${PERIOD_NAMES[period](start)} is approved in the audit and locked. Ask an Administrator to allow editing it.`;
  }
  return "";
}

/** The report day of something the clerk recorded, for the lock: an expense's day recorded, a deposit's date, a Fidelity slip's date. */
export async function clerkItemDay(kind: "expense" | "deposit" | "fidelity", id: string) {
  const db = currentDb();
  if (kind === "expense") {
    const [row] = await db.select({ at: sql<string>`coalesce(${schema.expenses.encoded_at}, ${schema.expenses.created_at})::text`, date: sql<string>`${schema.expenses.expense_date}::text` }).from(schema.expenses).where(eq(schema.expenses.expense_id, id)).limit(1);
    return row ? manilaDateOf(row.at) || text(row.date) : "";
  }
  if (kind === "deposit") {
    const [row] = await db.select({ date: sql<string>`${schema.bank_deposits.deposit_date}::text` }).from(schema.bank_deposits).where(eq(schema.bank_deposits.deposit_id, id)).limit(1);
    return text(row?.date);
  }
  const [row] = await db.select({ date: sql<string>`${schema.remittances.date_remitted}::text` }).from(schema.remittances).where(eq(schema.remittances.remittance_id, id)).limit(1);
  return text(row?.date);
}

/**
 * What the clerk sees of the audit of their own report: its status, and once approved the result and findings (a draft's
 * findings are not final). `lock` is why the report cannot be changed (this audit or a longer one containing it).
 */
export async function clerkAuditView(employeeId: string, period: AuditPeriod, date: string) {
  const { start } = periodSpan(period, date);
  const table = TABLES[period];
  const [[row], lock] = await Promise.all([
    currentDb().select().from(table).where(and(eq(table.employee_id, employeeId), eq(table.report_date, start))).orderBy(table.row_seq).limit(1),
    reportLockProblem(employeeId, start, period),
  ]);
  const audit = row ? readAudit(row) : null;
  const approved = audit?.status === "Approved";
  return {
    status: (audit?.status ?? "Not started") as AuditStatus, result: approved ? audit.result : "", findings: approved ? audit.findings : "",
    approvedByName: approved ? audit.approvedByName : "", approvedAt: approved ? audit.approvedAt : "",
    editAllowed: approved && audit.editAllowedAt ? { byName: audit.editAllowedByName, at: audit.editAllowedAt, reason: audit.editReason } : null,
    lock,
  };
}
export type ClerkAuditView = Awaited<ReturnType<typeof clerkAuditView>>;

export type AuditSummaryFilters = { from: string; to: string; branch?: string; employeeId?: string };

/**
 * Approved audits in a date range, optionally for one branch (any branch the clerk is assigned to) and one Entry Clerk, with
 * totals and a per-clerk breakdown. Only approved audits count; drafts and missing days are reported separately.
 */
export async function getAuditSummary(filters: AuditSummaryFilters) {
  const from = text(filters.from), to = text(filters.to), branch = text(filters.branch), employeeId = text(filters.employeeId);
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) throw new Error("Choose a valid date range.");
  const [clerks, saved] = await Promise.all([auditedEmployees(), loadAudits("daily", from, to)]);
  const inScope = clerks.filter((clerk) => (!branch || clerk.branches.includes(branch)) && (!employeeId || clerk.employeeId === employeeId));
  const ids = new Set(inScope.map((clerk) => clerk.employeeId));
  const all = saved.filter((audit) => ids.has(audit.employeeId));
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
