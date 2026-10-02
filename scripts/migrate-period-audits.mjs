// Weekly, Monthly and Yearly audits of each Entry Clerk's report, alongside Daily Audits.
//   npm run sheets:period-audits              dry run
//   npm run sheets:period-audits -- --apply   create the sheets
// Additive only: creates "Weekly Audits", "Monthly Audits" and "Yearly Audits" with the same columns as "Daily Audits"
// (report_date holds the first day of the week, month or year).
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

const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Daily Audits'!1:1" })).data.values?.[0] ?? [];
if (header[0] !== "audit_id" || header.length < 17) throw new Error("Daily Audits headers are missing. Run npm run sheets:audit-transfers -- --apply first.");
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const missing = ["Weekly Audits", "Monthly Audits", "Yearly Audits"].filter((title) => !metadata.data.sheets.some((sheet) => sheet.properties.title === title));
if (!missing.length) { console.log("Weekly, Monthly and Yearly Audits already exist."); process.exit(0); }
console.log(`Create ${missing.join(", ")} with the Daily Audits columns.`);
if (!apply) { console.log("Dry run only. Re-run with -- --apply."); process.exit(0); }
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { rowCount: 200, columnCount: header.length, frozenRowCount: 1 } } } })) } });
for (const title of missing) await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${title}'!A1`, valueInputOption: "RAW", requestBody: { values: [header] } });
console.log("Applied.");
