// Batch-level extras entered while encoding, stored on the batch's first row so a remittance counts them once.
//   npm run sheets:batch-extras              dry run
//   npm run sheets:batch-extras -- --apply   add the headers
// Additive only: Collections AL fidelity_amount (MAS Fidelity set aside from the batch's incentives), and
// Sales AM penalty_amount, AN penalty_note (a remittance penalty on a New Sales batch, like Collections AJ:AK).
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
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const plan = {
  Collections: { after: [36, "penalty_note"], headers: { 37: "fidelity_amount" } },
  Sales: { after: [37, "accountable_employee_id"], headers: { 38: "penalty_amount", 39: "penalty_note" } },
};
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const requests = [], valueUpdates = [], lines = [];
for (const [title, { after, headers }] of Object.entries(plan)) {
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
  if (!properties) throw new Error(`${title} sheet not found.`);
  const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!1:1` })).data.values?.[0] ?? [];
  if (String(header[after[0]] ?? "").trim() !== after[1]) throw new Error(`${title} ${column(after[0])}1 is "${header[after[0]] ?? ""}", expected "${after[1]}"; run the earlier migrations first. Nothing changed.`);
  for (const [index, name] of Object.entries(headers)) {
    const current = String(header[index] ?? "").trim();
    if (current === name) { lines.push(`${title} ${column(Number(index))}1 already "${name}".`); continue; }
    if (current) throw new Error(`${title} ${column(Number(index))}1 is "${current}", expected "${name}". Nothing changed.`);
    if ((properties.gridProperties?.columnCount ?? 0) <= Number(index)) {
      requests.push({ appendDimension: { sheetId: properties.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - (properties.gridProperties?.columnCount ?? 0) } });
      properties.gridProperties = { ...properties.gridProperties, columnCount: Number(index) + 1 };
    }
    valueUpdates.push({ range: `'${title}'!${column(Number(index))}1`, values: [[name]] });
    lines.push(`Add ${title} ${column(Number(index))}1 "${name}".`);
  }
}
lines.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
