// Registers in Employees every MAS named on program accounts who is not an employee yet (mostly old-data MAS).
//   node scripts/register-legacy-mas.mjs            dry run: lists who would be registered
//   node scripts/register-legacy-mas.mjs --apply    write the Employees and Employee Branches rows
// Each gets a temporary ID LEG-YYYY-NNNN (edit it to the real Employee ID later in Employees; every reference follows),
// the exact name written on their accounts (collections can only be encoded when the names match), the role MAS,
// status active, every branch where they have accounts (primary = the one with the most), and no sign-in account.
// Labels that are not people ("Others", "DTO", "...-DTO") are skipped. Only employee names are printed.
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
const NOT_PEOPLE = /^(others|dto)$|-dto$/i;

const [enrollments, employees, branchRows, users] = (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Member programs'!A:G", "'Employees'!A:B", "'Branches'!A:B", "'Users'!A:B"] })).data.valueRanges.map((range) => range.values ?? []);
const known = new Set(employees.slice(1).map((row) => text(row[1]).toLowerCase()));
const branchIds = new Map(branchRows.slice(1).map((row) => [text(row[1]).toUpperCase(), text(row[0])]));

// MAS name → branch → number of accounts.
const people = new Map();
const skipped = new Map();
for (const row of enrollments.slice(1)) {
  const mas = text(row[6]), branch = text(row[5]).toUpperCase();
  if (!text(row[0]) || !mas || known.has(mas.toLowerCase())) continue;
  if (NOT_PEOPLE.test(mas)) { skipped.set(mas, (skipped.get(mas) ?? 0) + 1); continue; }
  const branches = people.get(mas) ?? new Map();
  branches.set(branch, (branches.get(branch) ?? 0) + 1);
  people.set(mas, branches);
}

const year = new Date().getFullYear();
const usedIds = new Set([...employees.slice(1).map((row) => text(row[0]).toUpperCase()), ...users.slice(1).map((row) => text(row[1]).toUpperCase())]);
let next = 1;
const nextId = () => { let id; do { id = `LEG-${year}-${String(next++).padStart(4, "0")}`; } while (usedIds.has(id)); usedIds.add(id); return id; };

const now = new Date().toISOString();
const identity = ["system", "", "Legacy import", now];
const employeeRows = [], assignmentRows = [], unknownBranches = new Set();
const plan = [...people.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, branches]) => {
  const ranked = [...branches.entries()].sort((a, b) => b[1] - a[1]);
  const ids = ranked.map(([branch]) => branchIds.get(branch)).filter(Boolean);
  ranked.filter(([branch]) => !branchIds.has(branch)).forEach(([branch]) => unknownBranches.add(branch));
  const id = nextId();
  const primary = ranked.find(([branch]) => branchIds.has(branch))?.[0] ?? "";
  employeeRows.push([id, name, primary, "MAS", "active", "", "", "", now, ...identity]);
  ids.forEach((branchId, index) => assignmentRows.push([`EBA-${id}-${String(index + 1).padStart(2, "0")}`, id, branchId, ...identity]));
  return `${id}  ${name}  · primary ${primary || "(none)"} · ${ranked.length} branch(es) · ${ranked.reduce((sum, [, count]) => sum + count, 0)} account(s)`;
});

plan.forEach((line) => console.log(line));
console.log(`\n${plan.length} MAS to register; ${assignmentRows.length} branch assignments.`);
if (skipped.size) console.log(`Skipped (not people): ${[...skipped].map(([name, count]) => `${name} (${count})`).join(", ")}`);
if (unknownBranches.size) console.log(`Branch names not in Branches (not assigned): ${[...unknownBranches].join(", ")}`);
if (!apply) { console.log("Dry run only. Re-run with --apply to register them."); process.exit(0); }
await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Employees'!A:M", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: employeeRows } });
await sheets.spreadsheets.values.append({ spreadsheetId, range: "'Employee Branches'!A:G", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: assignmentRows } });
console.log("Registered.");
