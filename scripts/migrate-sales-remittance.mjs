// Remittances for New Sales: a MAS remits new sales on their own slip, separate from collections.
//   npm run sheets:sales-remittance              dry run
//   npm run sheets:sales-remittance -- --apply   add the headers
// Additive only: Sales AJ remittance_status, AK linked_remittance_id, AL accountable_employee_id (after the encoder
// columns), and Remittances Z remittance_type ("Collections" or "New Sales"; blank reads as Collections).
// Existing sales rows are marked "Needs Historical Review" so they are not counted as cash owed without checking.
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

const plan = { Sales: { after: [34, "encoded_at"], headers: { 35: "remittance_status", 36: "linked_remittance_id", 37: "accountable_employee_id" } }, Remittances: { after: [24, ""], headers: { 25: "remittance_type" } } };
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const requests = [], valueUpdates = [], lines = [];
for (const [title, { after, headers }] of Object.entries(plan)) {
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
  if (!properties) throw new Error(`${title} sheet not found.`);
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A:AZ` })).data.values ?? [];
  const header = rows[0] ?? [];
  if (after[1] && String(header[after[0]] ?? "").trim() !== after[1]) throw new Error(`${title} ${column(after[0])}1 is "${header[after[0]] ?? ""}", expected "${after[1]}". Nothing changed.`);
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
  if (title === "Sales") {
    const unreviewed = rows.slice(1).map((row, i) => ({ row, number: i + 2 })).filter(({ row }) => String(row[0] ?? "").trim() && !String(row[35] ?? "").trim());
    for (const { number } of unreviewed) valueUpdates.push({ range: `Sales!AJ${number}`, values: [["Needs Historical Review"]] });
    if (unreviewed.length) lines.push(`Mark ${unreviewed.length} existing sale(s) "Needs Historical Review".`);
  }
}
lines.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
