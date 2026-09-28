// Program age restriction headers: Programs!N1:P1.
//   npm run sheets:program-age              dry run
//   npm run sheets:program-age -- --apply   write the headers
// Additive only. Existing programs read as "no age restriction" until edited.
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

const expected = { 12: "pay_balance_total", 13: "age_restricted", 14: "min_age", 15: "max_age" };
const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Programs!1:1" })).data.values?.[0] ?? [];
if (header[12] !== expected[12]) throw new Error(`Programs M1 is "${header[12] ?? ""}", expected "${expected[12]}". Run the program rules migration first.`);

const missing = [13, 14, 15].filter((index) => header[index] !== expected[index]);
for (const index of missing) if (String(header[index] ?? "").trim()) throw new Error(`Programs column ${index + 1} header is "${header[index]}", expected "${expected[index]}".`);
if (!missing.length) { console.log("Programs N1:P1 already hold age_restricted, min_age, max_age."); process.exit(0); }

console.log("Add Programs N1:P1 = age_restricted, min_age, max_age.");
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write these headers."); process.exit(0); }
await sheets.spreadsheets.values.update({ spreadsheetId, range: "Programs!N1:P1", valueInputOption: "RAW", requestBody: { values: [["age_restricted", "min_age", "max_age"]] } });
console.log("Applied.");
