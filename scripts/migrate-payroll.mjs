// Payroll tabs.
//   npm run sheets:payroll              dry run
//   npm run sheets:payroll -- --apply   create any missing tab with its headers
// Additive only: creates new tabs; existing tabs must already match these headers.
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

const definitions = [
  { title: "Pay Profiles", headers: ["employee_id", "base_type", "base_rate", "commission_eligible", "hours_per_day", "overtime_multiplier", "status", "notes", "updated_at", ...tracking] },
  { title: "Payroll Runs", headers: ["payroll_id", "period_from", "period_to", "pay_date", "status", "settings_json", "employee_count", "gross_total", "deductions_total", "net_total", "prepared_by_user_id", "prepared_by_name", "prepared_at", "approved_by_user_id", "approved_by_name", "approved_at", "paid_at", "cash_account", "payment_reference", "cash_transaction_id", "branch", "void_reason", "remarks", "updated_at", ...tracking] },
  { title: "Payroll Lines", headers: ["payroll_line_id", "payroll_id", "employee_id", "employee_name", "roles", "base_type", "base_rate", "daily_rate", "hourly_rate", "days_paid", "leave_days", "absent_days", "base_pay", "overtime_hours", "overtime_pay", "late_minutes", "late_deduction", "undertime_minutes", "undertime_deduction", "absence_deduction", "commission", "commission_ids", "earned_incentive_reference", "line_status", ...tracking] },
  { title: "Payroll Adjustments", headers: ["adjustment_id", "payroll_id", "employee_id", "kind", "category", "amount", "reason", "status", ...tracking] },
];

const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const existing = new Map(metadata.data.sheets.map((sheet) => [sheet.properties.title, sheet.properties]));
const used = new Set([...existing.values()].map((properties) => properties.sheetId));
let nextId = 94002026;
const requests = [], values = [];

for (const definition of definitions) {
  if (existing.has(definition.title)) {
    const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${definition.title}'!1:1` })).data.values?.[0] ?? [];
    if (definition.headers.some((name, index) => header[index] !== name)) throw new Error(`${definition.title} exists but its headers differ from the payroll schema.`);
    console.log(`${definition.title}: already present.`);
    continue;
  }
  while (used.has(nextId)) nextId++;
  const sheetId = nextId++; used.add(sheetId);
  requests.push({ addSheet: { properties: { sheetId, title: definition.title, gridProperties: { rowCount: 1000, columnCount: definition.headers.length, frozenRowCount: 1 } } } });
  values.push({ range: `'${definition.title}'!A1:${column(definition.headers.length - 1)}1`, values: [definition.headers] });
  console.log(`${definition.title}: create with ${definition.headers.length} columns.`);
}

if (!requests.length) { console.log("Payroll tabs already match the schema."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to create these tabs."); process.exit(0); }
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: values } });
console.log("Applied.");
