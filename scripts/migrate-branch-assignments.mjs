import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const branchSheet = metadata.data.sheets.find((sheet) => sheet.properties.title === "Branches")?.properties;
if (!branchSheet) throw new Error("Branches sheet is missing.");
const assignmentsSheet = metadata.data.sheets.find((sheet) => sheet.properties.title === "Employee Branches")?.properties;
const current = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Branches'!A:P" })).data.values ?? [];
const hasTerritory = String(current[0]?.[2] ?? "").trim().toLowerCase() === "territory";
const groups = [
  ["METRO DAVAO 1", ["MATINA", "TORIL", "STA. CRUZ", "BALIOK"]],
  ["METRO DAVAO 1", ["AGDAO", "BUHANGIN", "TIBUNGCO"]],
  ["METRO DAVAO 3", ["MINTAL", "CALINAN"]],
  ["DAVNOR", ["TAGUM", "LA FILIPINA", "MACO", "PANTUKAN"]],
  ["DDO 1", ["MAWAB", "NABUNTURAN", "MARAGUSAN"]],
  ["DDO 2", ["COMPOSTELA", "MONTEVISTA", "MONKAYO"]],
  ["SURIGAO", ["HINATUAN", "TAGBINA", "BUTUAN"]],
  ["BUTUAN", ["BUTUAN", "CABADBARAN", "RTR"]],
];
const records = groups.flatMap(([territory, names]) => names.map((name) => ({ territory, name })));
console.log(`${hasTerritory ? "Territory column exists" : "Insert territory column"}; seed ${records.length} territory/branch records; ${assignmentsSheet ? "verify" : "create"} Employee Branches.`);
if (apply) {
  const requests = [];
  if (!hasTerritory) requests.push({ insertDimension: { range: { sheetId: branchSheet.sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, inheritFromBefore: false } });
  if (!assignmentsSheet) {
    const id = Math.max(...metadata.data.sheets.map((sheet) => sheet.properties.sheetId ?? 0)) + 1;
    requests.push({ addSheet: { properties: { sheetId: id, title: "Employee Branches", gridProperties: { rowCount: 2000, columnCount: 7, frozenRowCount: 1 } } } });
  }
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  if (!hasTerritory) await sheets.spreadsheets.values.update({ spreadsheetId, range: "'Branches'!C1", valueInputOption: "RAW", requestBody: { values: [["territory"]] } });
  if (!assignmentsSheet) await sheets.spreadsheets.values.update({ spreadsheetId, range: "'Employee Branches'!A1:G1", valueInputOption: "RAW", requestBody: { values: [["assignment_id", "employee_id", "branch_id", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_username", "encoded_at"]] } });
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Branches'!A:M" })).data.values ?? [];
  const duplicateIds = rows.slice(1).map((row) => String(row[0] ?? "").trim()).filter((id, index, ids) => id && ids.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`Duplicate branch IDs must be repaired before seeding: ${[...new Set(duplicateIds)].join(", ")}. Run node scripts/repair-branch-ids.mjs --apply.`);
  let highest = rows.slice(1).reduce((max, row) => Math.max(max, Number(/^BR-(\d+)$/.exec(String(row[0] ?? "").trim())?.[1] ?? 0)), 0);
  const existing = new Set(rows.slice(1).map((row) => `${String(row[2] ?? "").trim().toUpperCase()}\0${String(row[1] ?? "").trim().toUpperCase()}`));
  const additions = records.filter((record) => !existing.has(`${record.territory}\0${record.name}`)).map((record) => [`BR-${String(++highest).padStart(4, "0")}`, record.name, record.territory, "", "", "", "Philippines", "", "", "", "", "", "active", "migration", "migration", "migration", new Date().toISOString()]);
  if (additions.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Branches'!A:Q", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: additions } });
  const [allBranches, employees, assignments] = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Branches'!A:C", "'Employees'!A:C", "'Employee Branches'!A:C"] })).data.valueRanges.map((range) => range.values ?? []);
  const assigned = new Set(assignments.slice(1).map((row) => `${row[1]}\0${row[2]}`));
  const migrated = [];
  for (const employee of employees.slice(1)) {
    const employeeId = String(employee[0] ?? "").trim();
    const legacyName = String(employee[2] ?? "").trim().toUpperCase();
    const matches = allBranches.slice(1).filter((row) => String(row[1] ?? "").trim().toUpperCase() === legacyName);
    if (!employeeId || matches.length !== 1 || assigned.has(`${employeeId}\0${matches[0][0]}`)) continue;
    migrated.push([`EBA-${employeeId}-MIGRATION`, employeeId, matches[0][0], "migration", "migration", "migration", new Date().toISOString()]);
  }
  if (migrated.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Employee Branches'!A:G", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: migrated } });
  console.log(`Migration complete. Added ${additions.length} branches and migrated ${migrated.length} unambiguous employee assignments.`);
}
