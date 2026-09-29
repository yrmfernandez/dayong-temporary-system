import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { recordCorrection } from "@/lib/record-corrections";
import { columnName, encoderSheets, quotedSheet, trackingHeaders } from "@/lib/encoder-schema";
import { AUDIT_SHEET, type AuditChanges } from "@/lib/audit-log";

type Row = unknown[];
const t = (value: unknown) => String(value ?? "").trim();
const join = (...parts: unknown[]) => parts.map(t).filter(Boolean).join(" · ");
const peso = (value: unknown) => (Number(value) ? `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "");

// How each tracked sheet appears in Entry History. Every sheet in encoderSheets is listed even without an entry
// here (it falls back to its first columns), so newly tracked modules show up automatically.
const describe: Record<string, { module?: string; detail: (r: Row) => string; editable?: (r: Row) => Record<string, unknown> }> = {
  Sales: { module: "New Sales", detail: (r) => join(`${t(r[7])} ${t(r[6])}`, r[21], r[28] && `App ${t(r[28])}`, peso(r[26])),
    editable: (r) => ({ applicationNumber: t(r[28]), amountPaid: Number(r[26] ?? 0), notes: t(r[27]) }) },
  Collections: { detail: (r) => join(r[4], r[5], r[8] && `OR ${t(r[8])}`, peso(r[10])),
    editable: (r) => ({ orNumber: t(r[8]), orDate: t(r[9]), amountCollected: Number(r[10] ?? 0), remittanceStatus: t(r[28]) }) },
  Remittances: { detail: (r) => join(r[1], r[2], r[4]) },
  "Remittance Collections": { module: "Remittance Links", detail: (r) => join(`${t(r[2])} → ${t(r[1])}`, peso(r[3])) },
  Members: { detail: (r) => join(r[1], `${t(r[3])} ${t(r[2])}`) },
  "Member programs": { module: "Member Programs", detail: (r) => join(r[2], r[3], r[5], r[6]) },
  Beneficiaries: { detail: (r) => join(`${t(r[4])} ${t(r[3])}`, r[8], r[1] && `of ${t(r[1])}`) },
  Expenses: { detail: (r) => join(r[2], r[3], peso(r[4]), r[7]) },
  "Cash Transactions": { detail: (r) => join(r[2], r[3], peso(r[5]), r[6]) },
  "Cash Accounts": { detail: (r) => join(r[1], r[2]) },
  "Vendor Payables": { detail: (r) => join(r[3], r[5], peso(r[6])) },
  Commissions: { detail: (r) => join(r[2], `${t(r[3])} to ${t(r[4])}`, peso(r[7])) },
  Fidelity: { detail: (r) => join(r[2], r[5], peso(r[7])) },
  Employees: { detail: (r) => join(r[1], r[3]) },
  "Employee Branches": { module: "Branch Assignments", detail: (r) => join(r[1], r[2] && `→ ${t(r[2])}`) },
  Branches: { detail: (r) => join(r[1], r[2]) },
  Programs: { detail: (r) => join(r[1], r[2]) },
  "Program Incentives": { detail: (r) => join(r[1], r[2], r[3] && `months ${t(r[3])}–${t(r[4])}`) },
  Users: { module: "User Accounts", detail: (r) => join(r[1], r[2], r[4]) }, // never r[3]: password hash
  "User Roles": { detail: (r) => join(r[0], r[1] && `role ${t(r[1])}`) },
  Attendance: { detail: (r) => join(r[1], r[2], r[10]) },
  "Leave Requests": { detail: (r) => join(r[1], r[2], `${t(r[3])} to ${t(r[4])}`, r[6]) },
  "Record Corrections": { detail: (r) => join(r[1], r[2], r[3]) },
  "Report Remarks": { detail: (r) => join(r[3], `${t(r[1])} to ${t(r[2])}`, r[5]) },
  "Remittance Methods": { detail: (r) => join(r[1], r[4]) },
  "Pay Profiles": { detail: (r) => join(r[0], r[1], r[2]) },
  "Payroll Runs": { module: "Payroll", detail: (r) => join(`${t(r[1])} to ${t(r[2])}`, r[4], peso(r[9])) },
  "Payroll Lines": { detail: (r) => join(r[1], r[3]) },
  "Payroll Adjustments": { detail: (r) => join(r[1], r[2], r[3], r[4], peso(r[5])) },
};

const sources = encoderSheets.map((sheet) => ({
  title: sheet.title,
  module: describe[sheet.title]?.module ?? sheet.title,
  range: `${quotedSheet(sheet.title)}!A:${columnName(sheet.columns + trackingHeaders(sheet.title).length)}`,
  // Tracking columns follow the business columns: user ID, employee ID, name, timestamp.
  user: sheet.columns + 2, at: sheet.columns + 3,
  detail: describe[sheet.title]?.detail ?? ((r: Row) => join(r[1], r[2])),
  editable: describe[sheet.title]?.editable,
}));
const HISTORY_LIMIT = 2000;
const moduleOf = (title: string) => describe[title]?.module ?? title;
const label = (header: string) => header.replace(/_/g, " ");

/** One Audit Log row as a history entry: what changed for an edit, what the record was for a delete. */
function auditEntry(row: Row, rowNumber: number) {
  const title = t(row[3]), action = t(row[2]) === "Deleted" ? "Deleted" : "Edited";
  let detail = "";
  try {
    const parsed = JSON.parse(t(row[6])) as AuditChanges;
    if ("changes" in parsed) detail = Object.entries(parsed.changes).map(([header, [before, after]]) => `${label(header)}: ${before || "(blank)"} → ${after || "(blank)"}`).join("; ");
    else detail = (describe[title]?.detail ?? ((r: Row) => join(r[1], r[2])))(parsed.row);
  } catch { detail = t(row[6]).slice(0, 300); }
  return { key: `${AUDIT_SHEET}!${rowNumber}`, action, id: t(row[4]) || `row ${t(row[5])}`, module: moduleOf(title), detail, encodedBy: t(row[9]), encodedAt: t(row[1]), data: null };
}

// The Audit Log sheet is created by the first edit or delete; until then there is nothing to add.
async function auditEntries() {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${quotedSheet(AUDIT_SHEET)}!A:J` });
    return (response.data.values ?? []).slice(1).map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) => t(row[0])).map(({ row, rowNumber }) => auditEntry(row, rowNumber));
  } catch (error) {
    // A missing sheet is a 400 "Unable to parse range"; anything else is worth knowing about.
    if (!(typeof error === "object" && error && "code" in error && Number(error.code) === 400)) console.error("History: could not read the Audit Log.", error);
    return [];
  }
}

export async function GET() {
  const user = await getSessionUser();
  const finance = user?.roleNames.some((role) => role.trim().toLowerCase() === "finance");
  if (!(await canManageUsers()) && !finance) return Response.json({ success: false, message: "Administrator or Finance access is required." }, { status: 403 });
  try {
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: sources.map((source) => source.range), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
    // Every saved row is listed; rows saved before encoder tracking existed show "Not recorded" and sort last.
    const all = sources.flatMap((source, index) => (response.data.valueRanges?.[index]?.values ?? []).slice(1)
      .map((row, rowIndex) => ({ row, rowNumber: rowIndex + 2 }))
      .filter(({ row }) => t(row[0]))
      .map(({ row, rowNumber }) => ({ key: `${source.title}!${rowNumber}`, action: "Created", id: t(row[0]), module: source.module, detail: source.detail(row), encodedBy: t(row[source.user]).replace(/^'/, ""), encodedAt: t(row[source.at]), data: source.editable ? source.editable(row) : null })))
      .concat(await auditEntries())
      .sort((a, b) => b.encodedAt.localeCompare(a.encodedAt) || a.module.localeCompare(b.module));
    return Response.json({ success: true, entries: all.slice(0, HISTORY_LIMIT), total: all.length, modules: [...new Set(sources.map((source) => source.module))].sort(), canCorrect: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load history." }, { status: 500 }); }
}
export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    const body = await request.json(); const id = String(body.id ?? "").trim(), moduleName = String(body.module ?? ""), reason = String(body.reason ?? "").trim();
    if (!id || !reason) throw new Error("Record and correction reason are required.");
    const isSale = moduleName === "New Sales", sheet = isSale ? "Sales" : moduleName === "Collections" ? "Collections" : "";
    if (!sheet) throw new Error("Only New Sales and Collections can be corrected here.");
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${sheet}'!A:AI`, valueRenderOption: "UNFORMATTED_VALUE" });
    const rows = response.data.values ?? [], index = rows.slice(1).findIndex((row) => String(row[0] ?? "").trim() === id);
    if (index < 0) throw new Error("Record not found."); const rowNumber = index + 2, row = rows[index + 1];
    if (!isSale && !["", "Outstanding"].includes(String(row[28] ?? ""))) throw new Error("A Collection linked to a Remittance must be corrected through reconciliation, not direct editing.");
    const before = isSale ? { applicationNumber: row[28], amountPaid: row[26], notes: row[27] } : { orNumber: row[8], orDate: row[9], amountCollected: row[10] };
    const amount = Number(isSale ? body.amountPaid : body.amountCollected); if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount greater than zero.");
    const after = isSale ? { applicationNumber: String(body.applicationNumber ?? "").trim(), amountPaid: amount, notes: String(body.notes ?? "").trim() } : { orNumber: String(body.orNumber ?? "").trim(), orDate: String(body.orDate ?? "").trim(), amountCollected: amount };
    if (isSale && !after.applicationNumber) throw new Error("Application number is required.");
    if (!isSale && (!after.orNumber || !/^\d{4}-\d{2}-\d{2}$/.test(after.orDate))) throw new Error("Valid OR number and OR date are required.");
    const data = isSale ? [{ range: `'Sales'!AA${rowNumber}:AC${rowNumber}`, values: [[after.amountPaid, after.notes, after.applicationNumber]] }] : [{ range: `'Collections'!I${rowNumber}:K${rowNumber}`, values: [[after.orNumber, after.orDate, after.amountCollected]] }];
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data } });
    await recordCorrection(moduleName, id, reason, before, after);
    return Response.json({ success: true, message: `${moduleName} record corrected and audited.` });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct record." }, { status: 400 }); }
});


