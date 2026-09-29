// Names Employees column C for what it holds: the employee's primary branch.
//   npm run sheets:primary-branch              dry run
//   npm run sheets:primary-branch -- --apply   rename the header
// Only header C1 changes ("branch" -> "primary_branch"); values stay branch names. Also reports employees whose
// primary branch is not one of their assigned branches, since the app now requires that.
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
const text = (value) => String(value ?? "").replace(/^'/, "").trim();

const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["Employees!A:C", "'Employee Branches'!A:C", "Branches!A:B"] });
const [employees, links, branches] = response.data.valueRanges.map((range) => range.values ?? []);
const header = text(employees[0]?.[2]);
const names = new Map(branches.slice(1).map((row) => [text(row[0]), text(row[1])]));
for (const row of employees.slice(1).filter((item) => text(item[0]))) {
  const assigned = links.slice(1).filter((link) => text(link[1]) === text(row[0])).map((link) => names.get(text(link[2]))).filter(Boolean);
  if (text(row[2]) && assigned.length && !assigned.includes(text(row[2]))) console.log(`Review: ${text(row[0])} ${text(row[1])} has primary branch "${text(row[2])}" but is assigned to ${assigned.join(", ")}.`);
}
if (header === "primary_branch") { console.log('Employees C1 is already "primary_branch". Nothing to do.'); process.exit(0); }
if (header !== "branch") throw new Error(`Employees C1 is "${header}", expected "branch". Nothing changed.`);
console.log('Rename Employees C1 "branch" -> "primary_branch".');
if (!apply) { console.log("Dry run only. Re-run with -- --apply to write this change."); process.exit(0); }
await sheets.spreadsheets.values.update({ spreadsheetId, range: "Employees!C1", valueInputOption: "RAW", requestBody: { values: [["primary_branch"]] } });
console.log("Applied.");
