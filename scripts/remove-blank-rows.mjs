// Removes blank rows left inside tables by the old "delete = clear the row" behavior.
//   npm run sheets:remove-blank-rows              dry run
//   npm run sheets:remove-blank-rows -- --apply   delete the blank rows
//   add --with-leftovers                          also delete rows that have no ID in column A (printed in the dry run)
// Completely empty rows above the last data row are removed. Rows with values but no ID (leftovers of the old partial
// clear, e.g. a deleted program's K:M settings) are only removed with --with-leftovers. Rows below the data are kept.
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const withLeftovers = process.argv.includes("--with-leftovers");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const quoted = (title) => `'${title.replace(/'/g, "''")}'`;
const filled = (cell) => String(cell ?? "").trim() !== "";

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const list = metadata.data.sheets.map((sheet) => sheet.properties).filter((properties) => properties.title !== "Audit Log");
const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: list.map((properties) => `${quoted(properties.title)}!A:ZZ`) });
const requests = [];
let total = 0;
response.data.valueRanges.forEach((range, index) => {
  const { title, sheetId } = list[index];
  const rows = range.values ?? [];
  const last = rows.findLastIndex((row) => row.some(filled));
  const blank = [], noId = [];
  for (let row = 1; row < last; row += 1) {
    const cells = rows[row] ?? [];
    if (!cells.some(filled)) blank.push(row);
    else if (!filled(cells[0])) noId.push(row + 1);
  }
  for (const row of noId) console.log(`${title}: row ${row} has no ID in column A: ${JSON.stringify(rows[row - 1])} - ${withLeftovers ? "will be removed" : "kept (use --with-leftovers to remove)"}`);
  if (withLeftovers) blank.push(...noId.map((row) => row - 1));
  if (!blank.length) return;
  total += blank.length;
  console.log(`${title}: remove ${blank.length} blank row(s): ${blank.map((row) => row + 1).join(", ")}`);
  // Bottom-up so each index is still correct when its turn comes.
  for (const row of blank.sort((a, b) => b - a)) requests.push({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: row, endIndex: row + 1 } } });
});

if (!requests.length) { console.log("No blank rows inside any table."); process.exit(0); }
if (!apply) { console.log(`Dry run only: ${total} blank row(s). Re-run with -- --apply to delete them.`); process.exit(0); }
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
console.log(`Applied: removed ${total} blank row(s).`);
