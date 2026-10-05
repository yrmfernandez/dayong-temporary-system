import { eq, sql } from "drizzle-orm";

import { currentDb, inTransaction, schema } from "@/lib/db";
import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat, normalizeEmployeeId } from "@/lib/employee-id";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { recordCorrection } from "@/lib/record-corrections";

/**
 * Changes an Employee ID everywhere it is used, for example to replace a temporary LEG-… ID with the real one.
 *
 * In the database, the employee row's new ID carries into every linked table (ON UPDATE CASCADE), and every other
 * column ending in employee_id (who saved a row, who received or decided a remittance) is rewritten in the same
 * transaction. The audit_log keeps the old ID as history. The tabs below cover what is still in Google Sheets.
 *
 * Every tab's header row is scanned for Employee ID columns (headers ending in "employee_id" or "Employee ID":
 * employee_id, accountable_employee_id, encoded_by_employee_id, "Encoded By Employee ID", mas_employee_id, …), and
 * each cell holding the old ID is rewritten, including Users (so the person signs in with the new ID). Report Notes
 * keys start with the ID and are rewritten too. The Audit Log is history and keeps the old ID; the change itself is
 * logged there (each edited row) and summarized in Record Corrections. Record IDs that merely contain the old ID
 * (e.g. EBA-…, ATT-…) are left as they are: they are labels, not links.
 */
const SKIP = new Set(["Audit Log", "Legacy Pending NS", "Legacy Pending COLL"]);
// Tabs that moved to the database: their sheet copies are no longer used, so they are left as they are.
const IN_DATABASE = new Set(["Employees", "Employee Branches", "Branches", "Programs", "Program Incentives", "Program Categories", "Remittance Methods", "Members", "Member programs", "Member Transfers", "Sales", "Beneficiaries", "Collections"]);
const ID_HEADER = /employee[_ ]?id$/i;
const BATCH = 200;
const text = (value: unknown) => String(value ?? "").trim();
/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;
function column(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

export async function changeEmployeeId(oldIdRaw: string, newIdRaw: string, reason = "Employee ID corrected") {
  const oldId = text(oldIdRaw), newId = normalizeEmployeeId(newIdRaw);
  if (!oldId) throw new Error("Choose the employee.");
  if (!isEmployeeIdFormat(newId)) throw new Error(EMPLOYEE_ID_FORMAT_MESSAGE);
  if (newId === oldId.toUpperCase()) return { oldId, newId, changed: 0, bySheet: {} as Record<string, number> };

  const db = currentDb();
  const [employee] = await db.select({ id: schema.employees.employee_id }).from(schema.employees).where(sql`upper(${schema.employees.employee_id}) = ${oldId.toUpperCase()}`);
  if (!employee) throw new Error("Employee not found.");
  const [clash] = await db.select({ id: schema.employees.employee_id }).from(schema.employees).where(eq(schema.employees.employee_id, newId));
  if (clash) throw new Error(`Employee ID ${newId} is already used by another employee or account.`);

  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  const titles = (metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "").filter((title) => title && !SKIP.has(title) && !IN_DATABASE.has(title));
  const headerRanges = (await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: titles.map((title) => `${quoted(title)}!1:1`) })).data.valueRanges ?? [];
  const targets = titles.flatMap((title, index) => (headerRanges[index]?.values?.[0] ?? []).map((header, col) => ({ title, col, header: text(header) })).filter((item) => ID_HEADER.test(item.header)));

  // Read only the ID columns, then find every cell with the old ID (and refuse an ID someone already uses).
  const columns = (await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: targets.map((item) => `${quoted(item.title)}!${column(item.col)}:${column(item.col)}`), valueRenderOption: "UNFORMATTED_VALUE" })).data.valueRanges ?? [];
  const taken = targets.some((item, index) => item.title === "Users" && (columns[index]?.values ?? []).slice(1).some((row) => text(row[0]).toUpperCase() === newId));
  if (taken) throw new Error(`Employee ID ${newId} is already used by another employee or account.`);
  const cells: Array<{ range: string; values: string[][]; title: string }> = [];
  targets.forEach((item, index) => (columns[index]?.values ?? []).forEach((row, rowIndex) => {
    if (rowIndex > 0 && text(row[0]).toUpperCase() === oldId.toUpperCase()) cells.push({ title: item.title, range: `${quoted(item.title)}!${column(item.col)}${rowIndex + 1}`, values: [[newId]] });
  }));
  // Report Notes rows are keyed "<employee>|<kind>|<start>".
  if (titles.includes("Report Notes")) {
    const keys = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Report Notes'!A:A" })).data.values ?? [];
    keys.forEach((row, rowIndex) => { const key = text(row[0]); if (rowIndex > 0 && key.startsWith(`${oldId}|`)) cells.push({ title: "Report Notes", range: `'Report Notes'!A${rowIndex + 1}`, values: [[`${newId}${key.slice(oldId.length)}`]] }); });
  }
  // The database first, in one transaction: the employee row (linked tables follow), then every other employee_id column.
  const bySheet: Record<string, number> = {};
  await inTransaction(async (tx) => {
    await tx.update(schema.employees).set({ employee_id: newId }).where(eq(schema.employees.employee_id, employee.id));
    bySheet.employees = 1;
    const columns = rowsOf<{ table_name: string; column_name: string }>(await tx.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name like '%employee\\_id' and table_name not in ('employees', 'audit_log')`));
    for (const { table_name: table, column_name: column } of columns) {
      const count = rowsOf(await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${newId} where ${sql.identifier(column)} = ${employee.id} returning 1`)).length;
      if (count) bySheet[table] = (bySheet[table] ?? 0) + count;
    }
    const noteCount = rowsOf(await tx.execute(sql`update report_notes set note_key = ${newId} || substr(note_key, ${employee.id.length + 1}) where note_key like ${`${employee.id}|%`} returning 1`)).length;
    if (noteCount) bySheet.report_notes = noteCount;
  });

  for (let start = 0; start < cells.length; start += BATCH) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: cells.slice(start, start + BATCH).map(({ range, values }) => ({ range, values })) } });
  }
  for (const cell of cells) bySheet[cell.title] = (bySheet[cell.title] ?? 0) + 1;
  await recordCorrection("Employees", newId, reason, { employeeId: oldId }, { employeeId: newId, cellsChanged: bySheet });
  return { oldId, newId, changed: Object.values(bySheet).reduce((sum, count) => sum + count, 0), bySheet };
}
