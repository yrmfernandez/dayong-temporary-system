import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat, normalizeEmployeeId } from "@/lib/employee-id";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { recordCorrection } from "@/lib/record-corrections";

/**
 * Changes an Employee ID everywhere it is used, for example to replace a temporary LEG-… ID with the real one.
 *
 * Every tab's header row is scanned for Employee ID columns (headers ending in "employee_id" or "Employee ID":
 * employee_id, accountable_employee_id, encoded_by_employee_id, "Encoded By Employee ID", mas_employee_id, …), and
 * each cell holding the old ID is rewritten, including Users (so the person signs in with the new ID). Report Notes
 * keys start with the ID and are rewritten too. The Audit Log is history and keeps the old ID; the change itself is
 * logged there (each edited row) and summarized in Record Corrections. Record IDs that merely contain the old ID
 * (e.g. EBA-…, ATT-…) are left as they are: they are labels, not links.
 */
const SKIP = new Set(["Audit Log", "Legacy Pending NS", "Legacy Pending COLL"]);
const ID_HEADER = /employee[_ ]?id$/i;
const BATCH = 200;
const text = (value: unknown) => String(value ?? "").trim();
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

  const metadata = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties.title" });
  const titles = (metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "").filter((title) => title && !SKIP.has(title));
  const headerRanges = (await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: titles.map((title) => `${quoted(title)}!1:1`) })).data.valueRanges ?? [];
  const targets = titles.flatMap((title, index) => (headerRanges[index]?.values?.[0] ?? []).map((header, col) => ({ title, col, header: text(header) })).filter((item) => ID_HEADER.test(item.header)));
  if (!targets.some((item) => item.title === "Employees")) throw new Error("The Employees sheet has no employee_id column.");

  // Read only the ID columns, then find every cell with the old ID (and refuse an ID someone already uses).
  const columns = (await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: targets.map((item) => `${quoted(item.title)}!${column(item.col)}:${column(item.col)}`), valueRenderOption: "UNFORMATTED_VALUE" })).data.valueRanges ?? [];
  const taken = targets.some((item, index) => (item.title === "Employees" || item.title === "Users") && (columns[index]?.values ?? []).slice(1).some((row) => text(row[0]).toUpperCase() === newId));
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
  if (!cells.some((cell) => cell.title === "Employees")) throw new Error("Employee not found.");

  // Employees first, so a failure part-way never leaves references pointing at an employee that does not exist.
  cells.sort((a, b) => Number(b.title === "Employees") - Number(a.title === "Employees"));
  for (let start = 0; start < cells.length; start += BATCH) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "RAW", data: cells.slice(start, start + BATCH).map(({ range, values }) => ({ range, values })) } });
  }
  const bySheet: Record<string, number> = {};
  for (const cell of cells) bySheet[cell.title] = (bySheet[cell.title] ?? 0) + 1;
  await recordCorrection("Employees", newId, reason, { employeeId: oldId }, { employeeId: newId, cellsChanged: bySheet });
  return { oldId, newId, changed: cells.length, bySheet };
}
