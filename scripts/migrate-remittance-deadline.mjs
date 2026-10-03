// Incentive deadline, late-entry reasons, and cash counts for New Sales, Collections and Remittances.
//   npm run sheets:remittance-deadline              dry run
//   npm run sheets:remittance-deadline -- --apply   add the headers
// Additive only:
//   Collections AM forfeited_incentive, AN backdate_reason, AO date_remitted (the batch's Date Remitted)
//   Sales       AR forfeited_incentive, AS backdate_reason
//   Remittances AA time_remitted, AB cash_count (bills and coins counted, e.g. "1000x3, 500x1")
// forfeited_incentive is the incentive moved into the remittance because the cash came in after the deadline.
// Existing rows read as no forfeiture, no reason, no recorded time and no count.
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

// Each new header, in column order, and the header that must sit just before it (possibly one added earlier here).
const changes = [
  { title: "Collections", index: 38, name: "forfeited_incentive", after: "fidelity_amount" },
  { title: "Collections", index: 39, name: "backdate_reason", after: "forfeited_incentive" },
  { title: "Collections", index: 40, name: "date_remitted", after: "backdate_reason" },
  { title: "Sales", index: 43, name: "forfeited_incentive", after: "fidelity_amount" },
  { title: "Sales", index: 44, name: "backdate_reason", after: "forfeited_incentive" },
  { title: "Remittances", index: 26, name: "time_remitted", after: "remittance_type" },
  { title: "Remittances", index: 27, name: "cash_count", after: "time_remitted" },
];
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const plan = [], requests = [], valueUpdates = [], headers = new Map(), columnCounts = new Map();
for (const change of changes) {
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === change.title)?.properties;
  if (!properties) throw new Error(`${change.title} sheet not found.`);
  if (!headers.has(change.title)) headers.set(change.title, [...((await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${change.title}'!1:1` })).data.values?.[0] ?? [])]);
  const header = headers.get(change.title);
  const previous = String(header[change.index - 1] ?? "").trim();
  if (previous !== change.after) throw new Error(`${change.title} ${column(change.index - 1)}1 is "${previous}", expected "${change.after}". Nothing changed.`);
  const current = String(header[change.index] ?? "").trim();
  if (current === change.name) { plan.push(`${change.title} ${column(change.index)}1 already "${change.name}".`); continue; }
  if (current) throw new Error(`${change.title} ${column(change.index)}1 is "${current}", expected "${change.name}". Nothing changed.`);
  const columnCount = columnCounts.get(change.title) ?? properties.gridProperties?.columnCount ?? 0;
  if (columnCount <= change.index) {
    requests.push({ appendDimension: { sheetId: properties.sheetId, dimension: "COLUMNS", length: change.index + 1 - columnCount } });
    columnCounts.set(change.title, change.index + 1);
  }
  header[change.index] = change.name;
  valueUpdates.push({ range: `'${change.title}'!${column(change.index)}1`, values: [[change.name]] });
  plan.push(`Add ${change.title} ${column(change.index)}1 "${change.name}".`);
}

plan.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
