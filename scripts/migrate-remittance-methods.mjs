// Remittance methods for Collections and member enrollments.
//   npm run sheets:remittance-methods              dry run
//   npm run sheets:remittance-methods -- --apply   create the tab, seed defaults, add Collections columns
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

const title = "Remittance Methods";
const legacyTitle = "Payment Methods";
const headers = ["remittance_method_id", "method_name", "is_cash", "requires_reference", "status", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"];
const migratedAt = new Date().toISOString();
const seed = [
  ["PMT-CASH", "Cash", true, false, "active"],
  ["PMT-BANK-TRANSFER", "Bank Transfer", false, true, "active"],
  ["PMT-BANK-DEPOSIT", "Bank Deposit", false, true, "active"],
  ["PMT-GCASH", "GCash", false, true, "active"],
].map((row) => [...row, "migration", "migration", "Remittance methods migration", migratedAt]);
const collectionHeaders = { 33: "remittance_method", 34: "payment_reference" };
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const existing = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties
  ?? metadata.data.sheets.find((sheet) => sheet.properties.title === legacyTitle)?.properties;
const collections = metadata.data.sheets.find((sheet) => sheet.properties.title === "Collections")?.properties;
const memberPrograms = metadata.data.sheets.find((sheet) => sheet.properties.title === "Member programs")?.properties;
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
  const currentTitle = existing.title;
  const current = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${currentTitle}'!1:1` })).data.values?.[0] ?? [];
  const compatible = current[0] === "payment_method_id" || current[0] === "remittance_method_id";
  if (current.length && (!compatible || headers.slice(1).some((header, index) => current[index + 1] !== header))) throw new Error(`${currentTitle} headers do not match the expected schema.`);
  if (currentTitle === legacyTitle) {
    requests.push({ updateSheetProperties: { properties: { sheetId: existing.sheetId, title }, fields: "title" } });
    plan.push(`Rename "${legacyTitle}" to "${title}".`);
  }
  if (current[0] !== headers[0]) valueUpdates.push({ range: `'${title}'!A1`, values: [[headers[0]]] });
  plan.push(`Use "${title}" as the remittance-method master list.`);
}

const collectionHeader = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Collections!1:1" })).data.values?.[0] ?? [];
if (String(collectionHeader[32] ?? "").trim() === "") throw new Error("Collections column AG (accountable role) is missing; run the remittance migration first.");
for (const [index, name] of Object.entries(collectionHeaders)) {
  const current = String(collectionHeader[index] ?? "").trim();
  if (current === name) { plan.push(`Collections ${column(Number(index))}1 already "${name}".`); continue; }
  if (Number(index) === 33 && current === "payment_method") {
    valueUpdates.push({ range: `Collections!${column(Number(index))}1`, values: [[name]] });
    plan.push(`Rename Collections ${column(Number(index))}1 to "${name}".`);
    continue;
  }
  if (current) throw new Error(`Collections ${column(Number(index))}1 is "${current}", expected "${name}".`);
  if ((collections.gridProperties?.columnCount ?? 0) <= Number(index)) {
    requests.push({ appendDimension: { sheetId: collections.sheetId, dimension: "COLUMNS", length: Number(index) + 1 - (collections.gridProperties?.columnCount ?? 0) } });
    collections.gridProperties = { ...collections.gridProperties, columnCount: Number(index) + 1 };
  }
  valueUpdates.push({ range: `Collections!${column(Number(index))}1`, values: [[name]] });
  plan.push(`Add Collections ${column(Number(index))}1 "${name}".`);
}

if (memberPrograms) {
  const memberProgramHeader = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Member programs'!H1" })).data.values?.[0]?.[0] ?? "";
  if (["payment_method", "mode_of_payment"].includes(String(memberProgramHeader).trim())) {
    valueUpdates.push({ range: "'Member programs'!H1", values: [["remittance_method"]] });
    plan.push('Rename Member programs H1 to "remittance_method".');
  } else if (memberProgramHeader !== "remittance_method") {
    throw new Error(`Member programs H1 is "${memberProgramHeader}", expected "remittance_method".`);
  }
}

plan.forEach((line) => console.log(line));
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
if (valueUpdates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: valueUpdates } });
console.log("Applied.");
