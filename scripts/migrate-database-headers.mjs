import fs from "node:fs";
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const definition = JSON.parse(fs.readFileSync(new URL("../config/sheet-database-schema.json", import.meta.url), "utf8"));
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const options = { timeout: 30000, retry: false };

function snakeCase(value) {
  return String(value ?? "").trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
function quoted(title) { return `'${title.replaceAll("'", "''")}'`; }
function columnName(index) {
  let name = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

try {
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
  const ranges = definition.tables.map(({ sheet }) => `${quoted(sheet)}!1:1`);
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: "FORMULA" }, options);
  const data = [];
  for (const [index, table] of definition.tables.entries()) {
    const current = response.data.valueRanges?.[index]?.values?.[0] ?? [];
    if (!current.length) throw new Error(`${table.sheet} has no header row.`);
    const last = current.findLastIndex((header) => String(header ?? "").trim() !== "");
    const headers = current.slice(0, last + 1).map((header, column) => column === 0 ? table.primaryKey : snakeCase(header));
    const blank = headers.findIndex((header) => !header);
    if (blank >= 0) throw new Error(`${table.sheet} has a blank header in column ${columnName(blank + 1)}.`);
    const duplicate = headers.find((header, column) => headers.indexOf(header) !== column);
    if (duplicate) throw new Error(`${table.sheet} has duplicate canonical header ${duplicate}.`);
    if (headers.some((header) => !new RegExp(definition.conventions.headerPattern).test(header))) throw new Error(`${table.sheet} has an invalid canonical header.`);
    const changed = headers.filter((header, column) => header !== current[column]).length;
    console.log(`${table.sheet}: ${headers.length} headers, ${changed} rename(s)`);
    if (changed) data.push({ range: `${quoted(table.sheet)}!A1:${columnName(headers.length)}1`, values: [headers] });
  }
  if (!apply) console.log(`Dry run passed. ${data.length} sheet(s) need canonical headers. Use --apply to rename row 1 only.`);
  else if (!data.length) console.log("All registered sheets already use canonical headers.");
  else {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } }, options);
    console.log(`Renamed headers in ${data.length} sheet(s). Data rows, validation, notes, and formatting were not changed.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
