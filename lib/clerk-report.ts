import { sql } from "drizzle-orm";

import { getCashBegEdits, getDeposits, getReportNotes, type BankDeposit } from "@/lib/clerk-cash";
import { getDb } from "@/lib/db";
import { periodSpan, type AuditPeriod } from "@/lib/daily-audit";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { expectedByMas, type Expected } from "@/lib/mas-expected";
import { getEntriesForRange, type DayEntry } from "@/lib/todays-entries";

/**
 * An Entry Clerk's own report for a day, week (Monday to Sunday), month or year, in the company's report layout:
 *
 * - New Sales and Collections sections (MAS or period rows: Accts, Gross, Inc, Net, Fid/bond) from what the clerk
 *   encoded in the period, by the date encoded.
 * - Expenses / Other Cash Out (expenses the clerk encoded) and Cash Flow Transactions (cash the clerk forwarded to the
 *   bank, lib/clerk-cash.ts).
 * - The cash summary: Cash Beg/Pending COH (the cash received that the clerk typed for this report, else zero), Sales
 *   Net, Collection
 *   Net, Fidelity Bond, Penalty (since October 12, 2026), Pending cash to be encoded, Total Cash In; Expenses, Cash forwarded to bank, Total Cash Out;
 *   Remaining Cash on Hand = Total Cash In - Total Cash Out.
 * - The clerk's remarks, and the per-MAS summary sheet (New Member and Collection by Marketing Account Staff), whose
 *   CVE (%) columns compare each MAS's collections with what their accounts owed in the period (lib/mas-expected.ts).
 *
 * The clerk sees only their own; Report Review and Audits open any clerk's.
 */
export const COMPANY = { name: "D' SAN ROQUE DAYONG PROVIDERS, INC.", address: "Prk. 4 Eco City Heights, Nalum, Baliok Davao City", secRegNo: "CN201966149" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"];
const ENTRY_LIMIT = 1000;

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: number) => Math.round(value * 100) / 100;
const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });
const longDate = (date: string) => `${MONTHS[parts(date).month - 1]} ${parts(date).day}, ${parts(date).year}`;
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}/${date.slice(0, 4)}`;

/**
 * Week of the month as the company's sheets count it (owner, October 12, 2026): weeks start Monday and week N is the
 * week of the month's Nth Monday (October 12, 2026 is the 2ND WEEK; September 30, 2026 the 4TH). Days before the
 * month's first Monday belong to week 1.
 */
export function weekOfMonth(date: string) {
  const firstWeekday = (new Date(`${date.slice(0, 7)}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const firstMonday = firstWeekday === 0 ? 1 : 8 - firstWeekday;
  return Math.max(1, Math.floor((parts(date).day - firstMonday) / 7) + 1);
}

function headings(kind: AuditPeriod, start: string, end: string) {
  const month = MONTHS[parts(start).month - 1];
  if (kind === "daily") return { reportName: "DAILY REPORT", dateLine: `${weekday(start)}, ${longDate(start)}`, weekLine: `${ORDINALS[weekOfMonth(start) - 1]} WEEK`, summaryLabel: `${ORDINALS[weekOfMonth(start) - 1]} WEEK REPORT`, summaryWeek: longDate(start) };
  if (kind === "weekly") {
    const span = parts(start).month === parts(end).month ? `${month.toUpperCase()} ${parts(start).day}-${parts(end).day}, ${parts(end).year}` : `${longDate(start).toUpperCase()} - ${longDate(end).toUpperCase()}`;
    return { reportName: "WEEKLY REPORT", dateLine: `WEEK ${weekOfMonth(start)} ${span}`, weekLine: "", summaryLabel: `${ORDINALS[weekOfMonth(start) - 1]} WEEKLY REPORT`, summaryWeek: `${ORDINALS[weekOfMonth(start) - 1]} WEEK` };
  }
  if (kind === "monthly") return { reportName: "MONTHLY REPORT", dateLine: `${weekday(end)}, ${longDate(end)}`, weekLine: "WHOLE MONTH", summaryLabel: `WHOLE MONTH - ${month.toUpperCase()}`, summaryWeek: "WHOLE MONTH" };
  return { reportName: "YEARLY REPORT", dateLine: `January 1 - December 31, ${parts(start).year}`, weekLine: "WHOLE YEAR", summaryLabel: `WHOLE YEAR - ${parts(start).year}`, summaryWeek: "WHOLE YEAR" };
}

/** The row label for a date in this kind of report: the date (day, week), Week N (month) or the month (year). */
function whenLabel(kind: AuditPeriod, date: string) {
  if (kind === "monthly") return `WEEK ${weekOfMonth(date)}`;
  if (kind === "yearly") return MONTHS[parts(date).month - 1].toUpperCase();
  return shortDate(date);
}

// penalty: charged to the MAS/Collector and collected with the batch, separate from the member's payment (October 12, 2026).
export type ReportLine = { label: string; accounts: number; gross: number; incentives: number; net: number; fidelity: number; penalty: number };
const empty = (label: string): ReportLine => ({ label, accounts: 0, gross: 0, incentives: 0, net: 0, fidelity: 0, penalty: 0 });
const addTo = (line: ReportLine, entry: DayEntry) => {
  line.accounts += 1; line.gross = round(line.gross + entry.amount); line.incentives = round(line.incentives + entry.incentive);
  line.net = round(line.gross - line.incentives); line.fidelity = round(line.fidelity + entry.fidelity); line.penalty = round(line.penalty + entry.penalty);
};
const sum = (entries: DayEntry[]) => { const line = empty("TOTAL"); for (const entry of entries) addTo(line, entry); return line; };

/** Section rows: by MAS for a day, by date for a week, by week for a month, by month for a year. */
function section(kind: AuditPeriod, entries: DayEntry[]) {
  const groups = new Map<string, ReportLine>();
  for (const entry of entries) {
    const encoded = entry.encodedAt.slice(0, 10);
    const key = kind === "daily" ? entry.person || "(no MAS)" : kind === "weekly" ? encoded : kind === "monthly" ? String(weekOfMonth(encoded)).padStart(2, "0") : encoded.slice(5, 7);
    const line = groups.get(key) ?? empty(kind === "daily" ? key : whenLabel(kind, encoded));
    addTo(line, entry);
    groups.set(key, line);
  }
  return { rows: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, line]) => line), total: sum(entries) };
}

export type ExpenseRow = { id: string; date: string; when: string; account: string; amount: number; receipt: string; purpose: string; remarks: string };

/** Posted expenses the clerk encoded on or before `to` (Expenses B date, C account, D purpose, E amount, H branch, K receipt, L status, M remarks, S encoder). */
async function clerkExpenses(employeeId: string, to: string) {
  try {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Expenses'!A:U", valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" })).data.values ?? [];
    return rows.slice(1)
      .filter((row) => text(row[0]) && text(row[18]) === employeeId && (text(row[11]) || "Posted") === "Posted" && text(row[1]).slice(0, 10) <= to)
      .map((row) => ({ id: text(row[0]), date: text(row[1]).slice(0, 10), account: text(row[2]), purpose: text(row[3]), amount: Number(row[4]) || 0, branch: text(row[7]), receipt: text(row[10]), remarks: text(row[12]) }));
  } catch {
    return [];
  }
}

/**
 * `branch` (owner, October 13, 2026): the report of one branch, for a clerk who encodes for several; "" = every branch
 * (Audits). Entries, expenses and deposits are that branch's; notes and Cash Beg are kept per branch, and the ones saved
 * before reports were split belong to the clerk's primary branch.
 */
/** Fidelity slips the clerk recorded (Fidelity handed in after encoding; lib/remittance-workflow.ts createFidelitySlip), not voided or rejected. */
async function clerkFidelitySlips(employeeId: string, from: string, to: string) {
  const result = await getDb().execute(sql`select remittance_id as id, branch, mas as "masName", accountable_employee_id as "masEmployeeId", date_remitted::text as date, coalesce(fidelity_amount, 0)::float8 as amount, status, coalesce(remarks, '') as remarks
    from remittances where remittance_type = 'Fidelity' and coalesce(received_by_employee_id, encoded_by_employee_id) = ${employeeId} and status not in ('Voided', 'Rejected')
      and date_remitted between ${from}::date and ${to}::date order by date_remitted, remittance_id`);
  return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ id: string; branch: string; masName: string; masEmployeeId: string; date: string; amount: number; status: string; remarks: string }>;
}

export async function buildClerkReport(kind: AuditPeriod, date: string, clerk: { employeeId: string; name: string; branch?: string }, branch = "") {
  const { start, end } = periodSpan(kind, date);
  const sameBranch = (value: string) => !branch || text(value).toLowerCase() === branch.trim().toLowerCase();
  const primary = Boolean(branch) && text(clerk.branch).toLowerCase() === branch.trim().toLowerCase();
  // What the clerk recorded in the period; nothing before it counts (Cash Beg is typed, not carried).
  const [{ entries: history }, expensesAll, depositsAll, notes, cashBegEdits, fidelityAll] = await Promise.all([
    getEntriesForRange(start, end, "encoded", { encodedBy: clerk.employeeId }), clerkExpenses(clerk.employeeId, end),
    getDeposits(clerk.employeeId, end), getReportNotes(clerk.employeeId, kind, start, branch, primary), getCashBegEdits(clerk.employeeId),
    clerkFidelitySlips(clerk.employeeId, start, end),
  ]);
  const inPeriod = (day: string) => day >= start && day <= end;
  const encoded = history.filter((entry) => inPeriod(entry.encodedAt.slice(0, 10)));
  // Every branch the clerk encoded for in the period, for the branch choice.
  const encodedBranches = [...new Set(encoded.map((entry) => text(entry.branch)).filter(Boolean))].sort();
  const entries = encoded.filter((entry) => sameBranch(entry.branch));
  const expenses = expensesAll.filter((item) => inPeriod(item.date) && sameBranch(item.branch));
  const deposits = depositsAll.filter((item) => inPeriod(item.date) && sameBranch(item.branch));
  // Fidelity handed in after encoding (its own slips): cash received, so it is in the Fidelity Bond line.
  const fidelitySlips = fidelityAll.filter((item) => sameBranch(item.branch)).map((item) => ({ ...item, amount: Number(item.amount) || 0 }));
  const fidelityLater = round(fidelitySlips.reduce((total, item) => total + item.amount, 0));

  const sales = entries.filter((entry) => entry.kind === "New Sale"), collections = entries.filter((entry) => entry.kind === "Collection");
  const newSales = section(kind, sales), collection = section(kind, collections);

  /*
   * Cash Beg is the cash received, case by case (owner, October 13, 2026): the clerk types it for a report, with a
   * reason, and it belongs to that report only (kind and period). Without one it is zero; it is no longer calculated
   * from earlier entries, expenses and deposits, nor carried from another report.
   */
  const forBranch = (edit: { branch: string }) => (edit.branch ? sameBranch(edit.branch) && Boolean(branch) : !branch || primary);
  const ofPeriod = cashBegEdits.filter((edit) => edit.start === start && edit.kind === kind);
  // All branches: each branch's typed Cash Beg (its latest) added together, so the cash summary matches the branches.
  const perBranch = [...new Map(ofPeriod.map((edit) => [edit.branch.toLowerCase(), edit])).values()];
  const typedCashBeg = branch ? ofPeriod.filter(forBranch).at(-1) ?? null
    : perBranch.length === 1 ? perBranch[0]
    : perBranch.length ? { amount: round(perBranch.reduce((total, edit) => total + edit.amount, 0)), reason: perBranch.map((edit) => `${edit.branch || "earlier"} ₱${edit.amount}: ${edit.reason}`).join("; "), updatedAt: perBranch.map((edit) => edit.updatedAt).sort().at(-1) ?? "", updatedBy: [...new Set(perBranch.map((edit) => edit.updatedBy))].join(", "), kind, start, branch: "" } : null;
  const cashBeg = typedCashBeg ? round(typedCashBeg.amount) : 0;
  const fidelity = round(newSales.total.fidelity + collection.total.fidelity + fidelityLater);
  // Penalties are cash the clerk receives with the batch (the turnover control total includes them), so they count in.
  const penalty = round(newSales.total.penalty + collection.total.penalty);
  const totalCashIn = round(cashBeg + newSales.total.net + collection.total.net + fidelity + penalty + notes.pendingCash);
  const expenseTotal = round(expenses.reduce((total, item) => total + item.amount, 0));
  const depositTotal = round(deposits.reduce((total, item) => total + item.amount, 0));
  const totalCashOut = round(expenseTotal + depositTotal);

  // Summary sheet: New Member and Collection by Marketing Account Staff.
  const byMas = new Map<string, { name: string; sales: ReportLine; collections: ReportLine }>();
  for (const entry of entries) {
    const name = entry.person || "(no MAS)";
    const row = byMas.get(name) ?? { name, sales: empty(name), collections: empty(name) };
    addTo(entry.kind === "New Sale" ? row.sales : row.collections, entry);
    byMas.set(name, row);
  }
  const branches = [...new Set(entries.map((entry) => entry.branch).filter(Boolean))];
  // CVE (%): what each MAS was expected to collect in the period (lib/mas-expected.ts); CVE% = Collection GROSS ÷ CVE GROSS.
  const expected = await expectedByMas(start, end, branch ? [branch] : branches.length ? branches : [clerk.branch ?? ""]);
  const cveOf = (name: string, collected: number) => {
    const due: Expected = expected.get(name.trim().toLowerCase()) ?? { accounts: 0, gross: 0 };
    return { accounts: due.accounts, gross: due.gross, percent: due.gross > 0 ? round((collected / due.gross) * 100) : null };
  };
  const masRows = [...byMas.values()].sort((a, b) => a.name.localeCompare(b.name)).map((row) => ({ ...row, cve: cveOf(row.name, row.collections.gross) }));
  const cveTotal = masRows.reduce((total, row) => ({ accounts: total.accounts + row.cve.accounts, gross: round(total.gross + row.cve.gross) }), { accounts: 0, gross: 0 });

  return {
    company: COMPANY, kind, from: start, to: end, ...headings(kind, start, end),
    branch: branch || branches.join(", ") || clerk.branch || "", encodedBranches, encoder: { employeeId: clerk.employeeId, name: clerk.name },
    groupLabel: kind === "daily" ? "MAS" : kind === "weekly" ? "DATE" : kind === "monthly" ? "WEEK" : "MONTH",
    whenLabel: kind === "monthly" ? "WEEK" : kind === "yearly" ? "MONTH" : "DATE",
    newSales, collection,
    expenses: expenses.map((item): ExpenseRow => ({ ...item, when: whenLabel(kind, item.date) })), expenseTotal,
    deposits: deposits.map((item: BankDeposit) => ({ ...item, when: whenLabel(kind, item.date) })), depositTotal,
    fidelitySlips: fidelitySlips.map((item) => ({ ...item, when: whenLabel(kind, item.date) })), fidelityLater,
    /*
     * Every Fidelity received in the period (owner, October 13, 2026: its total equals the Fidelity Bond line): Fidelity
     * entered with a batch (on the batch's first entry) and Fidelity handed in after encoding (Fidelity slips, which the
     * clerk can still edit or void until approved).
     */
    fidelityReceived: [
      ...entries.filter((entry) => entry.fidelity > 0).map((entry) => ({ id: entry.id, kind: "batch" as const, masName: entry.person, branch: entry.branch, date: entry.encodedAt.slice(0, 10), when: whenLabel(kind, entry.encodedAt.slice(0, 10)), amount: entry.fidelity, status: "With the batch", remarks: entry.kind === "New Sale" ? "New Sales batch" : "Collections batch" })),
      ...fidelitySlips.map((item) => ({ id: item.id, kind: "slip" as const, masName: item.masName, branch: item.branch, date: item.date, when: whenLabel(kind, item.date), amount: item.amount, status: item.status, remarks: item.remarks || "Handed in after encoding" })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    cash: {
      cashBeg, cashBegEdit: typedCashBeg, salesNet: newSales.total.net, collectionNet: collection.total.net, fidelity, penalty, pendingCash: notes.pendingCash, totalCashIn,
      expenses: expenseTotal, forwardedToBank: depositTotal, totalCashOut, remainingCashOnHand: round(totalCashIn - totalCashOut), totals: totalCashIn,
    },
    notes,
    masSummary: { title: `REPORT FOR ${MONTHS[parts(start).month - 1].toUpperCase()} ${parts(start).year}`, rows: masRows, total: { sales: sum(sales), collections: sum(collections),
      cve: { ...cveTotal, percent: cveTotal.gross > 0 ? round((sum(collections).gross / cveTotal.gross) * 100) : null } } },
    // Kept for audits, which store these totals with their findings.
    totals: { accounts: entries.length, gross: round(newSales.total.gross + collection.total.gross), incentives: round(newSales.total.incentives + collection.total.incentives), net: round(newSales.total.net + collection.total.net), fidelity },
    checks: {
      penalties: round(entries.reduce((total, entry) => total + entry.penalty, 0)),
      forfeitedIncentives: round(entries.reduce((total, entry) => total + entry.forfeitedIncentive, 0)),
      remitted: round(entries.filter((entry) => entry.remittanceStatus === "Remitted").reduce((total, entry) => total + entry.remittanceAmount, 0)),
      notYetRemitted: round(entries.filter((entry) => entry.remittanceStatus !== "Remitted").reduce((total, entry) => total + entry.remittanceAmount, 0)),
      withPhoto: entries.filter((entry) => entry.photoId).length,
      withDateWarnings: entries.filter((entry) => entry.warnings.length).length,
      entryCount: entries.length,
    },
    byProgram: { sales: byProgram(sales), collections: byProgram(collections) },
    byBranch: byBranch(entries, fidelitySlips),
    entries: entries.slice(0, ENTRY_LIMIT), entriesTruncated: entries.length > ENTRY_LIMIT,
  };
}
export type ClerkReport = Awaited<ReturnType<typeof buildClerkReport>>;

/**
 * Per branch (owner, October 13, 2026: Audits show each branch, each line equal to that branch's own report): accounts,
 * gross, incentives, net (gross - incentives, the audit's expected remittance), Fidelity (with Fidelity slips) and penalties.
 */
export type BranchFigures = { branch: string; accounts: number; gross: number; incentives: number; net: number; fidelity: number; penalty: number };
function byBranch(entries: DayEntry[], fidelitySlips: Array<{ branch: string; amount: number }>) {
  const groups = new Map<string, BranchFigures>();
  const group = (name: string) => { const key = text(name).toLowerCase(); const found = groups.get(key) ?? { branch: text(name) || "(no branch)", accounts: 0, gross: 0, incentives: 0, net: 0, fidelity: 0, penalty: 0 }; groups.set(key, found); return found; };
  for (const entry of entries) {
    const line = group(entry.branch);
    line.accounts += 1; line.gross = round(line.gross + entry.amount); line.incentives = round(line.incentives + entry.incentive);
    line.net = round(line.gross - line.incentives); line.fidelity = round(line.fidelity + entry.fidelity); line.penalty = round(line.penalty + entry.penalty);
  }
  for (const slip of fidelitySlips) { const line = group(slip.branch); line.fidelity = round(line.fidelity + slip.amount); }
  return [...groups.values()].sort((a, b) => a.branch.localeCompare(b.branch));
}

function byProgram(entries: DayEntry[]) {
  const groups = new Map<string, { program: string; branch: string; accounts: number; gross: number; expectedRemittance: number }>();
  for (const entry of entries) {
    const key = `${entry.program}\u0000${entry.branch}`;
    const group = groups.get(key) ?? { program: entry.program, branch: entry.branch, accounts: 0, gross: 0, expectedRemittance: 0 };
    group.accounts += 1; group.gross = round(group.gross + entry.amount); group.expectedRemittance = round(group.expectedRemittance + entry.remittanceAmount);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.program.localeCompare(b.program) || a.branch.localeCompare(b.branch));
}
