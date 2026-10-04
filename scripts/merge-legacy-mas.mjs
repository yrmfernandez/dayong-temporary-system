// Merges employees registered twice under two spellings of one MAS name (old data wrote some names both ways).
//   node scripts/merge-legacy-mas.mjs            dry run: what would change
//   node scripts/merge-legacy-mas.mjs --apply    rename, merge branches, delete the duplicate employee
// For each pair the duplicate's spelling is renamed to the kept spelling in every MAS name column (Member programs mas,
// Sales mas, Remittances mas, Collections mas / original_mas / accountable_name, Fidelity mas_name, Member Transfers
// from_mas / to_mas), the kept employee receives every branch either had (primary = the branch with most accounts), and
// the duplicate's Employees and Employee Branches rows are deleted. It refuses a duplicate whose Employee ID is used
// anywhere else. Each merge is summarized in Record Corrections. Only employee names are printed.
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
const quoted = (title) => `'${title.replace(/'/g, "''")}'`;
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

// [duplicate spelling, kept spelling]
const MERGES = [
  ["Alburo, M.", "Alburo, Merafe"],
  ["Arot, f.", "Arot, F."],
  ["Gotib, A.", "Gotib, Annabelle"],
  ["Grado, C.", "Grado, Carlos"],
  ["Jumawid, R.", "Jumawid, Rufina"],
  ["Lucido, N.", "Lucido, Nenita"],
  ["Nagliba, M.", "Nagliba, Marissa"],
  ["Colast, C.", "Colaste, C."],
];
const NAME_COLUMNS = { "Member programs": ["mas"], Sales: ["mas"], Remittances: ["mas"], Collections: ["mas", "original_mas", "accountable_name"], Fidelity: ["mas_name"], "Member Transfers": ["from_mas", "to_mas"] };
const ID_HEADER = /employee[_ ]?id$/i;

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const sheetIds = new Map(metadata.data.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
const titles = [...sheetIds.keys()].filter((title) => !/^Legacy Pending|^Audit Log$/.test(title));
const headers = new Map((await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: titles.map((title) => `${quoted(title)}!1:1`) })).data.valueRanges.map((range, index) => [titles[index], (range.values?.[0] ?? []).map(text)]));
const [employees, assignments, branchRows, enrollments] = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Employees'!A:E", "'Employee Branches'!A:C", "'Branches'!A:B", "'Member programs'!A:G"] })).data.valueRanges.map((range) => range.values ?? []);
const byName = new Map(employees.slice(1).map((row, index) => [text(row[1]), { id: text(row[0]), row: index + 2 }]));
const branchName = new Map(branchRows.slice(1).map((row) => [text(row[0]), text(row[1])]));
const branchId = new Map(branchRows.slice(1).map((row) => [text(row[1]).toUpperCase(), text(row[0])]));

// Name columns to scan, read once.
const nameTargets = Object.entries(NAME_COLUMNS).flatMap(([title, names]) => names.map((name) => ({ title, col: (headers.get(title) ?? []).indexOf(name) })).filter((item) => item.col >= 0));
const nameValues = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: nameTargets.map((item) => `${quoted(item.title)}!${column(item.col)}:${column(item.col)}`) })).data.valueRanges;
// Every Employee ID column, to be sure a duplicate's ID is not used elsewhere.
const idTargets = titles.flatMap((title) => (headers.get(title) ?? []).map((header, col) => ({ title, col, header })).filter((item) => ID_HEADER.test(item.header) && item.title !== "Employees" && item.title !== "Employee Branches"));
const idValues = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: idTargets.map((item) => `${quoted(item.title)}!${column(item.col)}:${column(item.col)}`) })).data.valueRanges;

const now = new Date().toISOString();
const renames = [], newAssignments = [], primaries = [], deleteEmployeeRows = [], deleteAssignmentRows = [], corrections = [];
for (const [from, to] of MERGES) {
  const dup = byName.get(from), kept = byName.get(to);
  if (!dup || !kept) { console.log(`skip ${from} → ${to}: ${!dup ? "duplicate" : "kept"} employee not found`); continue; }
  const usedAt = idTargets.filter((_, index) => (idValues[index]?.values ?? []).slice(1).some((row) => text(row[0]) === dup.id)).map((item) => `${item.title}.${item.header}`);
  if (usedAt.length) { console.log(`skip ${from} → ${to}: ${dup.id} is used in ${usedAt.join(", ")}`); continue; }
  const cells = [];
  nameTargets.forEach((item, index) => (nameValues[index]?.values ?? []).forEach((row, rowIndex) => { if (rowIndex > 0 && text(row[0]) === from) cells.push({ range: `${quoted(item.title)}!${column(item.col)}${rowIndex + 1}`, values: [[to]], title: item.title }); }));
  renames.push(...cells);
  // Branches: the union, and the primary where the merged name has the most accounts.
  const keptBranches = new Set(assignments.slice(1).filter((row) => text(row[1]) === kept.id).map((row) => text(row[2])));
  const dupBranches = assignments.slice(1).filter((row) => text(row[1]) === dup.id).map((row) => text(row[2]));
  const missing = [...new Set(dupBranches)].filter((id) => !keptBranches.has(id));
  missing.forEach((id, index) => newAssignments.push([`EBA-${kept.id}-M${String(index + 1).padStart(2, "0")}`, kept.id, id, "system", "", "Legacy merge", now]));
  const counts = new Map();
  for (const row of enrollments.slice(1)) if ([from, to].includes(text(row[6]))) counts.set(text(row[5]).toUpperCase(), (counts.get(text(row[5]).toUpperCase()) ?? 0) + 1);
  const primary = [...counts.entries()].sort((a, b) => b[1] - a[1]).find(([name]) => branchId.has(name))?.[0] ?? "";
  if (primary) primaries.push({ range: `'Employees'!C${kept.row}`, values: [[primary]] });
  deleteEmployeeRows.push(dup.id);
  deleteAssignmentRows.push(dup.id);
  const bySheet = {}; cells.forEach((cell) => { bySheet[cell.title] = (bySheet[cell.title] ?? 0) + 1; });
  corrections.push([`COR-MERGE-${kept.id}-${dup.id}`, "Employees", kept.id, `Merged duplicate spelling ${from} (${dup.id}) into ${to}`, JSON.stringify({ employeeId: dup.id, name: from }), JSON.stringify({ employeeId: kept.id, name: to, renamed: bySheet, branchesAdded: missing.map((id) => branchName.get(id) ?? id), primary }), now, "system", "", "Legacy merge", now]);
  console.log(`${from} (${dup.id}) → ${to} (${kept.id}): ${cells.length} name cell(s) ${JSON.stringify(bySheet)} · +${missing.length} branch(es) · primary ${primary || "unchanged"}`);
}
console.log(`\n${corrections.length} merge(s); ${renames.length} cells renamed; ${newAssignments.length} branch assignment(s) added; ${deleteEmployeeRows.length} duplicate employee(s) to delete.`);
if (!apply) { console.log("Dry run only. Re-run with --apply."); process.exit(0); }
if (!corrections.length) process.exit(0);

for (let start = 0; start < renames.length; start += 1000) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: renames.slice(start, start + 1000).map(({ range, values }) => ({ range, values })) } });
}
if (primaries.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: primaries } });
if (newAssignments.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Employee Branches'!A:G", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: newAssignments } });
// Delete the duplicates' rows, found again now, bottom-up so each index stays valid.
const fresh = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Employees'!A:A", "'Employee Branches'!B:B"] })).data.valueRanges.map((range) => range.values ?? []);
const doomed = new Set(deleteEmployeeRows);
const rowsToDelete = (title, values) => values.map((row, index) => ({ index, id: text(row[0]) })).filter((item) => item.index > 0 && doomed.has(item.id)).sort((a, b) => b.index - a.index)
  .map((item) => ({ deleteDimension: { range: { sheetId: sheetIds.get(title), dimension: "ROWS", startIndex: item.index, endIndex: item.index + 1 } } }));
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [...rowsToDelete("Employee Branches", fresh[1]), ...rowsToDelete("Employees", fresh[0])] } });
await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Record Corrections'!A:K", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: corrections } });
console.log("Merged.");
