import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Branches'!A:Q", "'Employee Branches'!A:C"] });
const branches = response.data.valueRanges?.[0]?.values ?? [];
const assignments = response.data.valueRanges?.[1]?.values ?? [];
const used = new Set();
let highest = branches.slice(1).reduce((max, row) => Math.max(max, Number(/^BR-(\d+)$/.exec(String(row[0] ?? "").trim())?.[1] ?? 0)), 0);
const changes = [];
for (let index = 1; index < branches.length; index++) {
  const id = String(branches[index][0] ?? "").trim();
  if (!id || !used.has(id)) { if (id) used.add(id); continue; }
  let replacement;
  do replacement = `BR-${String(++highest).padStart(4, "0")}`; while (used.has(replacement));
  used.add(replacement);
  changes.push({ row: index + 1, oldId: id, newId: replacement, name: String(branches[index][1] ?? ""), territory: String(branches[index][2] ?? "") });
}
console.log(JSON.stringify({ duplicates: changes, assignmentCounts: Object.fromEntries(changes.map((change) => [change.oldId, assignments.slice(1).filter((row) => String(row[2] ?? "").trim() === change.oldId).length])) }, null, 2));
if (apply && changes.length) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: changes.map((change) => ({ range: `'Branches'!A${change.row}`, values: [[change.newId]] })) } });
  console.log(`Reassigned ${changes.length} duplicate branch ID(s). Existing ambiguous employee assignments were left on the original ID for manual review.`);
}
