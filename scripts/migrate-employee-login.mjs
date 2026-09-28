// Employee ID sign-in migration.
//   npm run sheets:employee-login              dry run: prints every change
//   npm run sheets:employee-login -- --apply   writes the changes and a local backup of every replaced value
//
// 1. Renames every "... username" audit header to "... name" and replaces stored usernames with the
//    employee's full name (including Remittances received_by_name, which held usernames).
// 2. Adds the Roles encoder headers (H:K) and the page_access header (L).
// 3. Deletes the legacy Users username column. Sign-in now uses the Employee ID.
import fs from "node:fs";
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

const text = (value) => String(value ?? "").trim();
const canonical = (value) => text(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
const quoted = (title) => `'${title.replace(/'/g, "''")}'`;
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };
// encoded_by_username -> encoded_by_name, "Encoded By Username" -> "Encoded By Name".
const renameHeader = (header) => text(header).replace(/Username$/, "Name").replace(/username$/, "name");

const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title,sheetId)" });
const tabs = meta.data.sheets.map((sheet) => sheet.properties);
const data = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((tab) => quoted(tab.title)), valueRenderOption: "FORMATTED_VALUE" });
const grid = Object.fromEntries(tabs.map((tab, index) => [tab.title, data.data.valueRanges?.[index]?.values ?? []]));

// Username -> full name, from the Users sheet (before its username column is removed).
const users = grid.Users ?? [];
const usersHeader = (users[0] ?? []).map(canonical);
const usernameColumn = usersHeader.indexOf("username");
const fullNameColumn = usersHeader.indexOf("full_name");
if (fullNameColumn < 0) throw new Error("Users sheet has no full_name column.");
const names = new Map();
if (usernameColumn >= 0) for (const row of users.slice(1)) if (text(row[usernameColumn]) && text(row[fullNameColumn])) names.set(text(row[usernameColumn]).replace(/^'/, "").toLowerCase(), text(row[fullNameColumn]));
const fullNames = new Set(names.values());

const updates = [];
const backup = [];
const unmatched = new Map();
for (const tab of tabs) {
  const rows = grid[tab.title];
  const header = rows[0] ?? [];
  header.forEach((value, index) => {
    const key = canonical(value);
    const isAudit = key.endsWith("_by_username");
    const isReceiver = tab.title === "Remittances" && key === "received_by_name";
    if (!isAudit && !isReceiver) return;
    if (isAudit) {
      const renamed = renameHeader(value);
      updates.push({ range: `${quoted(tab.title)}!${column(index)}1`, values: [[renamed]] });
      backup.push({ sheet: tab.title, cell: `${column(index)}1`, before: text(value), after: renamed });
    }
    rows.slice(1).forEach((row, rowIndex) => {
      const before = text(row[index]).replace(/^'/, "");
      if (!before) return;
      const after = names.get(before.toLowerCase());
      if (!after) { if (!fullNames.has(before)) unmatched.set(`${tab.title}: ${before}`, (unmatched.get(`${tab.title}: ${before}`) ?? 0) + 1); return; }
      if (after === before) return;
      const cell = `${column(index)}${rowIndex + 2}`;
      updates.push({ range: `${quoted(tab.title)}!${cell}`, values: [[after]] });
      backup.push({ sheet: tab.title, cell, before, after });
    });
  });
}

// Roles: encoder headers over H:K and page_access in L, only where blank.
const rolesHeader = grid.Roles?.[0] ?? [];
["encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at", "page_access"].forEach((name, offset) => {
  const index = 7 + offset;
  if (!text(rolesHeader[index])) updates.push({ range: `Roles!${column(index)}1`, values: [[name]] });
  else if (canonical(rolesHeader[index]) !== name && !(name === "encoded_by_name" && canonical(rolesHeader[index]) === "encoded_by_username")) throw new Error(`Roles!${column(index)}1 is "${rolesHeader[index]}", expected ${name}.`);
});
// Roles rows written before this change stored the creator's username in J.
(grid.Roles ?? []).slice(1).forEach((row, rowIndex) => {
  const before = text(row[9]); const after = names.get(before.toLowerCase());
  if (after && after !== before) { updates.push({ range: `Roles!J${rowIndex + 2}`, values: [[after]] }); backup.push({ sheet: "Roles", cell: `J${rowIndex + 2}`, before, after }); }
});

const headerChanges = updates.filter((update) => /!\D+1$/.test(update.range));
console.log(`Header changes (${headerChanges.length}):`);
headerChanges.forEach((update) => console.log(`  ${update.range} -> ${update.values[0][0]}`));
console.log(`Username values replaced with full names: ${updates.length - headerChanges.length}`);
console.log(`Username -> name map: ${[...names].map(([username, name]) => `${username} -> ${name}`).join(", ") || "(none)"}`);
if (unmatched.size) console.log(`Left unchanged (no matching account): ${[...unmatched].map(([value, count]) => `${value} x${count}`).join("; ")}`);
console.log(usernameColumn >= 0 ? `Users column ${column(usernameColumn)} (username) will be deleted.` : "Users username column already removed.");

if (!apply) { console.log("\nDry run only. Re-run with -- --apply to write these changes."); process.exit(0); }

fs.mkdirSync("backups", { recursive: true });
const backupFile = `backups/employee-login-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(backupFile, JSON.stringify({ spreadsheetId, usernames: [...names], changes: backup }, null, 2));
console.log(`\nBackup of replaced values: ${backupFile}`);

for (let start = 0; start < updates.length; start += 500) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates.slice(start, start + 500) } });
}
if (usernameColumn >= 0) {
  const usersSheetId = tabs.find((tab) => tab.title === "Users").sheetId;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteDimension: { range: { sheetId: usersSheetId, dimension: "COLUMNS", startIndex: usernameColumn, endIndex: usernameColumn + 1 } } }] } });
}
console.log("Applied.");
