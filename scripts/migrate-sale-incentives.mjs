// New Sales incentives and MAS Fidelity.
//   npm run sheets:sale-incentives              dry run
//   npm run sheets:sale-incentives -- --apply   add the headers
// Additive only:
//   Programs Q new_sale_incentive_type, R new_sale_incentive_amount (used by programs with a registration fee)
//   Sales AO mas_incentive, AP remittance_amount, AQ fidelity_amount (fidelity on the batch's first sale)
// Sales saved earlier read as no incentive: their remittance is the full amount paid, as before.
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
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const plans = [
  { title: "Programs", after: [15, "max_age"], headers: { 16: "new_sale_incentive_type", 17: "new_sale_incentive_amount" } },
  { title: "Sales", after: [39, "penalty_note"], headers: { 40: "mas_incentive", 41: "remittance_amount", 42: "fidelity_amount" } },
];

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const lines = [], requests = [], valueUpdates = [];
for (const plan of plans) {
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === plan.title)?.properties;
  if (!properties) throw new Error(`${plan.title} sheet not found.`);
  const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${plan.title}!1:1` })).data.values?.[0] ?? [];
  const [afterIndex, afterName] = plan.after;
  if (String(header[afterIndex] ?? "").trim() !== afterName) throw new Error(`${plan.title} ${column(afterIndex)}1 is "${header[afterIndex] ?? ""}", expected "${afterName}". Run the earlier migrations first. Nothing changed.`);
  let columnCount = properties.gridProperties?.columnCount ?? 0;
  for (const [index, name] of Object.entries(plan.headers)) {
    const current = String(header[index] ?? "").trim();
    if (current === name) { lines.push(`${plan.title} ${column(Number(index))}1 already "${name}".`); continue; }
    if (current) throw new Error(`${plan.title} ${column(Number(index))}1 is "${current}", expected "${name}". Nothing changed.`);
    if (columnCount <= Number(index)) {
      requests.push({ appendDimension: { sheetId: properties.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - columnCount } });
      columnCount = Number(index) + 1;
    }
    valueUpdates.push({ range: `${plan.title}!${column(Number(index))}1`, values: [[name]] });
    lines.push(`Add ${plan.title} ${column(Number(index))}1 "${name}".`);
  }
}

lines.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
