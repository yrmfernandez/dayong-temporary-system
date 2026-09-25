import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const options = { timeout: 20000, retry: false };
const headers = ["Employee ID", "Full Name", "Branch", "Operational Roles", "Employment Status", "Contact Number", "Email", "Date Hired", "Created At", "Encoded By User ID", "Encoded By Employee ID", "Encoded By Username", "Encoded At"];
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }, options);
const existing = metadata.data.sheets.find((s) => s.properties.title === "Employees")?.properties;
let current = [];
if (existing) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Employees'!A:M" }, options);
  current = response.data.values ?? [];
  if (headers.some((h, i) => current[0]?.[i] !== h)) throw new Error("Employees headers differ. Review before migration.");
}
const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Users'!A:D", "'Users'!F:H"] }, options);
const users = response.data.valueRanges[0].values ?? [];
const extra = response.data.valueRanges[1].values ?? [];
const ids = new Set(current.slice(1).map((r) => String(r[0])));
const seen = new Set();
const imports = [];
for (let i = 1; i < users.length; i++) {
  const id = String(users[i][1] ?? "").trim();
  if (!id) continue;
  if (seen.has(id)) throw new Error("Duplicate employee IDs in Users. Resolve before migration.");
  seen.add(id);
  if (ids.has(id)) continue;
  // Login status does not establish employment status. Historical fields remain blank.
  imports.push([id, String(users[i][3] ?? ""), String(extra[i]?.[2] ?? ""), "", "", "", "", "", "", "", "", "", ""]);
}
console.log(`${existing ? "Verify" : "Create"} Employees sheet; import ${imports.length} existing staff IDs. No passwords or inferred staff roles/statuses are copied.`);
if (apply) {
  const sheetId = existing?.sheetId ?? Math.max(0, ...metadata.data.sheets.map((s) => s.properties.sheetId)) + 1;
  const requests = [];
  if (!existing) {
    requests.push({ addSheet: { properties: { sheetId, title: "Employees", gridProperties: { rowCount: Math.max(1000, imports.length + 100), columnCount: 13, frozenRowCount: 1 } } } });
    requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: headers.map((v) => ({ userEnteredValue: { stringValue: v } })) }], fields: "userEnteredValue" } });
  }
  if (imports.length) requests.push({ appendCells: { sheetId, rows: imports.map((r) => ({ values: r.map((v) => ({ userEnteredValue: { stringValue: v } })) })), fields: "userEnteredValue" } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, options);
  console.log("Employees migration complete.");
}
