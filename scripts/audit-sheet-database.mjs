import fs from "node:fs";
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());

const definition = JSON.parse(
  fs.readFileSync(new URL("../config/sheet-database-schema.json", import.meta.url), "utf8"),
);
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const options = { timeout: 30000, retry: false };

function snakeCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function quoted(title) {
  return `'${title.replaceAll("'", "''")}'`;
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function typeOf(value) {
  const text = String(value).trim();
  if (text.startsWith("=")) return "formula";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return "number";
  if (/^(?:true|false)$/i.test(text)) return "boolean";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "date";
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return "timestamp";
  if (/^[{[]/.test(text)) {
    try { JSON.parse(text); return "json"; } catch { /* ordinary text */ }
  }
  return "text";
}

function matches(pattern, name) {
  const expression = `^${pattern.replaceAll("*", ".*")}$`;
  return new RegExp(expression).test(name);
}

function expectedType(name) {
  const match = Object.entries(definition.columnTypes).find(([pattern]) => matches(pattern, name));
  return match?.[1];
}

function validType(value, expected) {
  const observed = typeOf(value);
  if (expected === "text") return observed === "text";
  if (expected === "integer") return observed === "number" && Number.isInteger(Number(value));
  return observed === expected;
}

const errors = [];
const warnings = [];
const mappings = [];
const add = (target, sheet, message) => target.push(`[${sheet}] ${message}`);

try {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title),merges)",
  }, options);
  const byTitle = new Map((metadata.data.sheets ?? []).map((sheet) => [sheet.properties?.title, sheet]));
  const configured = definition.tables.filter(({ sheet }) => byTitle.has(sheet));
  const values = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: configured.map(({ sheet }) => `${quoted(sheet)}!A:ZZ`),
    valueRenderOption: "FORMULA",
  }, options);

  for (const table of definition.tables) {
    const sheet = byTitle.get(table.sheet);
    if (!sheet) {
      add(errors, table.sheet, "required sheet is missing");
      continue;
    }
    if ((sheet.merges ?? []).length) add(errors, table.sheet, `${sheet.merges.length} merged range(s) found`);

    const configuredIndex = configured.findIndex(({ sheet: title }) => title === table.sheet);
    const rows = values.data.valueRanges?.[configuredIndex]?.values ?? [];
    const headers = rows[0] ?? [];
    if (headers[0] !== table.firstHeader) {
      add(errors, table.sheet, `first header is ${JSON.stringify(headers[0] ?? "")}; registry expects ${JSON.stringify(table.firstHeader)}`);
    }
    const canonical = headers.map((header, index) => index === 0 ? table.primaryKey : snakeCase(header));
    const collisions = canonical.filter((name, index) => name && canonical.indexOf(name) !== index);
    if (collisions.length) add(errors, table.sheet, `headers collide after snake_case conversion: ${[...new Set(collisions)].join(", ")}`);
    if (canonical.some((name) => name && !new RegExp(definition.conventions.headerPattern).test(name))) {
      add(errors, table.sheet, "one or more canonical headers are not valid lowercase database names");
    }
    mappings.push({ sheet: table.sheet, table: table.table, columns: canonical });

    const dataRows = rows.slice(1);
    const occupied = dataRows.map((row) => row.some(isPresent));
    const last = occupied.lastIndexOf(true);
    for (let index = 0; index <= last; index++) {
      if (!occupied[index]) add(errors, table.sheet, `blank row ${index + 2} splits the table`);
    }

    const keyIndexes = (table.compositeKey ?? [table.primaryKey]).map((key) => canonical.indexOf(key));
    if (keyIndexes.some((index) => index < 0)) add(errors, table.sheet, "primary-key column mapping is missing");
    const keys = new Map();
    for (let index = 0; index <= last; index++) {
      const row = dataRows[index] ?? [];
      const rowNumber = index + 2;
      const key = keyIndexes.map((column) => String(row[column] ?? "").trim()).join("::");
      if (!key || key.includes("::") && key.split("::").some((part) => !part)) {
        add(errors, table.sheet, `row ${rowNumber} has a blank primary-key value`);
      } else if (keys.has(key)) {
        add(errors, table.sheet, `duplicate primary key ${JSON.stringify(key)} at rows ${keys.get(key)} and ${rowNumber}`);
      } else {
        keys.set(key, rowNumber);
      }

      for (let column = 0; column < canonical.length; column++) {
        const value = row[column];
        if (!isPresent(value)) continue;
        const expected = expectedType(canonical[column]);
        if (expected && !validType(value, expected)) {
          add(warnings, table.sheet, `row ${rowNumber}, ${canonical[column]} expected ${expected}; found ${typeOf(value)}`);
        }
      }
    }
  }

  const report = {
    auditedAt: new Date().toISOString(),
    spreadsheetId: "configured",
    ready: errors.length === 0,
    errors,
    warnings,
    canonicalMappings: mappings,
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Sheets database audit: ${errors.length} error(s), ${warnings.length} warning(s)`);
    for (const issue of errors) console.log(`ERROR ${issue}`);
    for (const issue of warnings.slice(0, 100)) console.log(`WARN  ${issue}`);
    if (warnings.length > 100) console.log(`WARN  ${warnings.length - 100} more warning(s); use --json for the complete report`);
    console.log("Canonical lowercase header mappings are included with --json.");
  }
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
