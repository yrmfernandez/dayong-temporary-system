// Company expense form fields for the Expense Register.
//   npm run sheets:expense-fields              dry run
//   npm run sheets:expense-fields -- --apply   add the Expenses attachment and approver headers
// Additive only: two new trailing Expenses headers after the encoder columns (V attachments, W approved_by).
// Existing expenses read as no attachments recorded and no approver recorded.
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const spreadsheetId = process.env.GOOGLE_SHEET_ID?.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? process.env.GOOGLE_SHEET_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const headers = { 21: "attachments", 22: "approved_by" };
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const expenses = metadata.data.sheets.find((sheet) => sheet.properties.title === "Expenses")?.properties;
if (!expenses) throw new Error("Expenses sheet not found. Run npm run sheets:finance -- --apply first.");
const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Expenses!1:1" })).data.values?.[0] ?? [];
if (String(header[20] ?? "").trim() !== "encoded_at") throw new Error(`Expenses U1 is "${header[20] ?? ""}", expected "encoded_at"; run the encoder tracking migration first.`);

const plan = [], requests = [], valueUpdates = [];
for (const [index, name] of Object.entries(headers)) {
  const current = String(header[index] ?? "").trim();
  if (current === name) { plan.push(`Expenses ${column(Number(index))}1 already "${name}".`); continue; }
  if (current) throw new Error(`Expenses ${column(Number(index))}1 is "${current}", expected "${name}". Nothing changed.`);
  if ((expenses.gridProperties?.columnCount ?? 0) <= Number(index)) {
    requests.push({ appendDimension: { sheetId: expenses.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - (expenses.gridProperties?.columnCount ?? 0) } });
    expenses.gridProperties = { ...expenses.gridProperties, columnCount: Number(index) + 1 };
  }
  valueUpdates.push({ range: `Expenses!${column(Number(index))}1`, values: [[name]] });
  plan.push(`Add Expenses ${column(Number(index))}1 "${name}".`);
}

plan.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
