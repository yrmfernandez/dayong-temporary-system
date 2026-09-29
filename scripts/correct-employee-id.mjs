// Moves every reference to one Employee ID onto another, e.g. after a sign-in ID was corrected in Users.
//   node scripts/correct-employee-id.mjs MD-2026-0002 MD-2026-0004            dry run
//   node scripts/correct-employee-id.mjs MD-2026-0002 MD-2026-0004 --apply    write the changes
// Changes exact-match cells in every sheet except the Audit Log (history stays as recorded), then appends one
// Audit Log "Edited" entry per changed row. Refuses if the new ID already belongs to a different employee record.
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const [from, to] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!from || !to || from === to) throw new Error("Usage: node scripts/correct-employee-id.mjs <old ID> <new ID> [--apply]");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const quoted = (title) => `'${title.replace(/'/g, "''")}'`;
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };
const clean = (value) => String(value ?? "").replace(/^'/, "").trim();

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
const titles = metadata.data.sheets.map((sheet) => sheet.properties.title).filter((title) => title !== "Audit Log");
const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: titles.map((title) => `${quoted(title)}!A:BZ`) });
const tables = Object.fromEntries(titles.map((title, index) => [title, response.data.valueRanges[index].values ?? []]));

const updates = [], changedRows = [];
for (const [title, rows] of Object.entries(tables)) {
  const header = rows[0] ?? [];
  rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const columns = row.map((cell, index) => (clean(cell) === from ? index : -1)).filter((index) => index >= 0);
    if (!columns.length) return;
    for (const index of columns) updates.push({ range: `${quoted(title)}!${column(index)}${rowIndex + 1}`, values: [[to]] });
    changedRows.push({ title, row: rowIndex + 1, recordId: clean(row[0]), changes: Object.fromEntries(columns.map((index) => [header[index] || `Column ${column(index)}`, [from, to]])) });
  });
}
// Two employee records must never end up sharing an ID.
const renamesEmployee = (tables.Employees ?? []).slice(1).some((row) => clean(row[0]) === from);
if (renamesEmployee && (tables.Employees ?? []).slice(1).some((row) => clean(row[0]) === to)) throw new Error(`${to} already has its own employee record. Nothing changed.`);
for (const item of changedRows) console.log(`${item.title} row ${item.row} (${item.recordId}): ${Object.keys(item.changes).join(", ")}`);
console.log(`${updates.length} cell(s) in ${changedRows.length} row(s) change from ${from} to ${to}.`);
if (!updates.length) process.exit(0);
if (!apply) { console.log("Dry run only. Re-run with --apply to write these changes."); process.exit(0); }

await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates } });
const now = new Date().toISOString();
await sheets.spreadsheets.values.append({
  spreadsheetId, range: "'Audit Log'!A:J", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
  requestBody: { values: changedRows.map((item, index) => [`AUD-${now.replace(/\D/g, "").slice(0, 17)}-${String(index + 1).padStart(3, "0")}-idfx`, now, "Edited", item.title, item.recordId, item.row, JSON.stringify({ changes: item.changes }), "system", "", `Employee ID correction (${from} → ${to})`]) },
});
console.log("Applied and recorded in the Audit Log.");
