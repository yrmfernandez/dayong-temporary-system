// Ways of payment for Collections.
//   npm run sheets:payment-methods              dry run
//   npm run sheets:payment-methods -- --apply   create the tab, seed defaults, add Collections columns
// Additive only: a new tab plus two new trailing Collections headers (AH, AI). Existing rows are untouched;
// collections saved before this change read as Cash.
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

const title = "Payment Methods";
const headers = ["payment_method_id", "method_name", "is_cash", "requires_reference", "status", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"];
const migratedAt = new Date().toISOString();
const seed = [
  ["PMT-CASH", "Cash", true, false, "active"],
  ["PMT-BANK-TRANSFER", "Bank Transfer", false, true, "active"],
  ["PMT-BANK-DEPOSIT", "Bank Deposit", false, true, "active"],
  ["PMT-GCASH", "GCash", false, true, "active"],
].map((row) => [...row, "migration", "migration", "Payment methods migration", migratedAt]);
const collectionHeaders = { 33: "payment_method", 34: "payment_reference" };
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const existing = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
const collections = metadata.data.sheets.find((sheet) => sheet.properties.title === "Collections")?.properties;
if (!collections) throw new Error("Collections sheet not found.");

const plan = [];
const requests = [];
const valueUpdates = [];

if (!existing) {
  const used = new Set(metadata.data.sheets.map((sheet) => sheet.properties.sheetId));
  let sheetId = 93002026; while (used.has(sheetId)) sheetId++;
  requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { rowCount: 200, columnCount: headers.length, frozenRowCount: 1 } } } });
  valueUpdates.push({ range: `'${title}'!A1:I${seed.length + 1}`, values: [headers, ...seed] });
  plan.push(`Create "${title}" with ${seed.map((row) => row[1]).join(", ")}.`);
} else {
  const current = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!1:1` })).data.values?.[0] ?? [];
  if (current.length && headers.some((header, index) => current[index] !== header)) throw new Error(`${title} headers do not match the expected schema.`);
  plan.push(`"${title}" already exists; leaving its rows as they are.`);
}

const collectionHeader = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Collections!1:1" })).data.values?.[0] ?? [];
if (String(collectionHeader[32] ?? "").trim() === "") throw new Error("Collections column AG (accountable role) is missing; run the remittance migration first.");
for (const [index, name] of Object.entries(collectionHeaders)) {
  const current = String(collectionHeader[index] ?? "").trim();
  if (current === name) { plan.push(`Collections ${column(Number(index))}1 already "${name}".`); continue; }
  if (current) throw new Error(`Collections ${column(Number(index))}1 is "${current}", expected "${name}".`);
  if ((collections.gridProperties?.columnCount ?? 0) <= Number(index)) {
    requests.push({ appendDimension: { sheetId: collections.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - (collections.gridProperties?.columnCount ?? 0) } });
    collections.gridProperties = { ...collections.gridProperties, columnCount: Number(index) + 1 };
  }
  valueUpdates.push({ range: `Collections!${column(Number(index))}1`, values: [[name]] });
  plan.push(`Add Collections ${column(Number(index))}1 "${name}".`);
}

plan.forEach((line) => console.log(line));
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
