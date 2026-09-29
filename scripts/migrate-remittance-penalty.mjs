// Remittance penalty for Collections batches.
//   npm run sheets:remittance-penalty              dry run
//   npm run sheets:remittance-penalty -- --apply   add the Collections penalty headers
// Additive only: two new trailing Collections headers (AJ penalty_amount, AK penalty_note). A batch's penalty is
// stored once, on its first Collection row. Existing rows read as no penalty.
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

const headers = { 35: "penalty_amount", 36: "penalty_note" };
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const collections = metadata.data.sheets.find((sheet) => sheet.properties.title === "Collections")?.properties;
if (!collections) throw new Error("Collections sheet not found.");
const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Collections!1:1" })).data.values?.[0] ?? [];
if (String(header[34] ?? "").trim() !== "payment_reference") throw new Error(`Collections AI1 is "${header[34] ?? ""}", expected "payment_reference"; run the remittance-methods migration first.`);

const plan = [], requests = [], valueUpdates = [];
for (const [index, name] of Object.entries(headers)) {
  const current = String(header[index] ?? "").trim();
  if (current === name) { plan.push(`Collections ${column(Number(index))}1 already "${name}".`); continue; }
  if (current) throw new Error(`Collections ${column(Number(index))}1 is "${current}", expected "${name}". Nothing changed.`);
  if ((collections.gridProperties?.columnCount ?? 0) <= Number(index)) {
    requests.push({ appendDimension: { sheetId: collections.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - (collections.gridProperties?.columnCount ?? 0) } });
    collections.gridProperties = { ...collections.gridProperties, columnCount: Number(index) + 1 };
  }
  valueUpdates.push({ range: `Collections!${column(Number(index))}1`, values: [[name]] });
  plan.push(`Add Collections ${column(Number(index))}1 "${name}".`);
}

plan.forEach((line) => console.log(line));
if (!requests.length && !valueUpdates.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
