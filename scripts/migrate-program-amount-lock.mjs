// Program rule: can the amount be edited on New Sales / Collections?
//   npm run sheets:program-amount-lock              dry run
//   npm run sheets:program-amount-lock -- --apply   add the headers and set every program to FALSE
// Adds Programs T new_sale_amount_editable and U collection_amount_editable, then writes FALSE (locked, the default)
// on every program row where the cell is still blank. Values an administrator already set are left alone.
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

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === "Programs")?.properties;
if (!properties) throw new Error("Programs sheet not found.");
const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Programs!A:U" })).data.values ?? [];
const header = rows[0] ?? [];
if (String(header[18] ?? "").trim() !== "category_id") throw new Error(`Programs S1 is "${header[18] ?? ""}", expected "category_id". Run npm run sheets:program-categories first.`);
const names = ["new_sale_amount_editable", "collection_amount_editable"];
for (const [offset, name] of names.entries()) {
  const current = String(header[19 + offset] ?? "").trim();
  if (current && current !== name) throw new Error(`Programs ${offset ? "U" : "T"}1 is "${current}", expected "${name}". Nothing changed.`);
}

const requests = [], data = [];
if ((properties.gridProperties?.columnCount ?? 0) < 21) requests.push({ appendDimension: { sheetId: properties.sheetId, dimension: "COLUMNS", length: 21 - (properties.gridProperties?.columnCount ?? 0) } });
if (String(header[19] ?? "").trim() !== names[0] || String(header[20] ?? "").trim() !== names[1]) data.push({ range: "Programs!T1:U1", values: [names] });
let programs = 0;
rows.slice(1).forEach((row, index) => {
  if (!String(row[0] ?? "").trim()) return;
  programs++;
  const blank = (cell) => String(cell ?? "").trim() === "";
  if (blank(row[19]) || blank(row[20])) data.push({ range: `Programs!T${index + 2}:U${index + 2}`, values: [[blank(row[19]) ? "FALSE" : row[19], blank(row[20]) ? "FALSE" : row[20]]] });
});

console.log(`${programs} programs. ${data.some((item) => item.range === "Programs!T1:U1") ? "Add the T:U headers. " : "Headers present. "}${data.filter((item) => item.range !== "Programs!T1:U1").length} program row(s) to set to FALSE.`);
if (!requests.length && !data.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these changes."); process.exit(0); }
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
console.log("Applied.");
