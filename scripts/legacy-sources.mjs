// Loads the old (pre-system) spreadsheets for the legacy migration scripts. Each argument is a Google Sheets URL/ID,
// an .xlsx or .csv file, or a folder of them; with no arguments the git-ignored legacy-data/ folder is used.
// Returns [{ id, title, tabs: [{ title, rows, firstRow }] }] where rows[0] is the header row (found within the first
// 15 rows, so title rows above it are skipped) and firstRow is that header's 1-based row number in the sheet. Date cells come back as Date
// objects from files and as serial numbers from Google Sheets; consumers handle both.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export const LEGACY_FOLDER = "legacy-data";
const FILE_TYPES = new Set([".xlsx", ".csv"]);

function expand(args) {
  const inputs = args.length ? args : [LEGACY_FOLDER];
  return inputs.flatMap((input) => {
    if (existsSync(input) && statSync(input).isDirectory()) {
      return readdirSync(input).filter((name) => FILE_TYPES.has(extname(name).toLowerCase()) && !name.startsWith("~$")).sort().map((name) => join(input, name));
    }
    return [input];
  });
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// exceljs cell values: plain, Date, rich text, hyperlink, formula result, or error.
function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date || typeof value !== "object") return value;
  if ("result" in value) return cellValue(value.result);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return cellValue(value.text);
  if ("error" in value) return "";
  return String(value);
}

async function loadFile(path) {
  const extension = extname(path).toLowerCase();
  const title = basename(path, extension);
  if (extension === ".csv") return { id: path, title, tabs: [{ title, rows: parseCsv(readFileSync(path, "utf8").replace(/^﻿/, "")) }] };
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const tabs = workbook.worksheets.map((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: true }, (row, number) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => { values[column - 1] = cellValue(cell.value); });
      rows[number - 1] = Array.from(values, (v) => v ?? "");
    });
    return { title: sheet.name, rows: Array.from(rows, (r) => r ?? []) };
  });
  return { id: path, title, tabs };
}

async function loadGoogle(spreadsheetId, sheets, tabPrefix = "") {
  const options = { timeout: 60000, retry: false };
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" }, options);
  const tabs = [];
  for (const { properties } of meta.data.sheets) {
    if (!properties.title.startsWith(tabPrefix)) continue;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${properties.title.replace(/'/g, "''")}'`, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" }, options);
    tabs.push({ title: properties.title, rows: response.data.values ?? [] });
  }
  return { id: spreadsheetId, title: meta.data.properties.title, tabs };
}

// The header row is the first one naming the member column; tabs without it keep row 1 (and are reported or skipped).
function withHeaderRow(tab) {
  const index = tab.rows.slice(0, 15).findIndex((row) => row.some((cell) => String(cell ?? "").trim().toUpperCase().replace(/\s+/g, "") === "PH/MEMBER"));
  const start = Math.max(0, index);
  return { title: tab.title, rows: tab.rows.slice(start), firstRow: start + 1 };
}

/**
 * `getSheets` is called only when a Google Sheets source is given, so local files need no Google access.
 * `tabPrefix` limits Google Sheets sources to tabs whose title starts with it.
 */
export async function loadLegacySources(args, getSheets, { tabPrefix = "" } = {}) {
  const inputs = expand(args);
  if (!inputs.length) throw new Error(`No .xlsx or .csv files found in ${LEGACY_FOLDER}/.`);
  const sources = [];
  for (const input of inputs) {
    if (existsSync(input)) {
      if (!FILE_TYPES.has(extname(input).toLowerCase())) throw new Error(`${input}: only .xlsx and .csv files are supported (download Google Sheets as .xlsx).`);
      sources.push(await loadFile(input));
    } else sources.push(await loadGoogle(input.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? input, getSheets(), tabPrefix));
  }
  return sources.map((source) => ({ ...source, tabs: source.tabs.map(withHeaderRow) }));
}
