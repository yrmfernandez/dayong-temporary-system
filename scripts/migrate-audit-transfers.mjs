// Creates the sheets for Daily Audit and member transfers (additive; existing sheets are only checked).
//   npm run sheets:audit-transfers              dry run
//   npm run sheets:audit-transfers -- --apply   create the sheets
// Daily Audits: one row per employee per day, prepared by HR/Admin and approved by Admin.
// Member Transfers: one row per program enrollment moved to another employee in the same branch.
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const tracking = ["encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"];
const plan = {
  "Daily Audits": ["audit_id", "report_date", "employee_id", "employee_name", "status", "figures_json", "findings", "result", "approved_by_user_id", "approved_by_name", "approved_at", "reopen_reason", "updated_at", ...tracking],
  "Member Transfers": ["transfer_id", "enrollment_id", "member_id", "member_number", "program_id", "branch", "from_mas", "to_mas", "to_employee_id", "reason", ...tracking],
};

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const used = new Set(metadata.data.sheets.map((sheet) => sheet.properties.sheetId));
const requests = [], values = [];
for (const [title, headers] of Object.entries(plan)) {
  const existing = metadata.data.sheets.find((sheet) => sheet.properties.title === title);
  if (existing) {
    const current = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!1:1` })).data.values?.[0] ?? [];
    if (headers.some((header, index) => String(current[index] ?? "").trim() !== header)) throw new Error(`${title} exists with different headers. Nothing changed.`);
    console.log(`${title} already exists with the expected headers.`);
    continue;
  }
  let sheetId = 94002026; while (used.has(sheetId)) sheetId++; used.add(sheetId);
  requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { rowCount: 500, columnCount: headers.length, frozenRowCount: 1 } } } });
  values.push({ range: `'${title}'!A1`, values: [headers] });
  console.log(`Create "${title}" (${headers.length} columns).`);
}
if (!requests.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to create them."); process.exit(0); }
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: values } });
console.log("Applied.");
