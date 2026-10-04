/**
 * Copies every Google Sheets tab into the PostgreSQL database (docs/supabase-migration-plan.md, phase 3).
 *
 *   node scripts/copy-sheets-to-postgres.mjs                 dry run: read, convert and report; writes nothing
 *   node scripts/copy-sheets-to-postgres.mjs --apply --yes   replace all table data in DIRECT_DATABASE_URL's database
 *
 * The load is one transaction: every table is emptied and refilled, then row counts and money totals are compared with
 * the sheets, and any difference undoes the whole load. Reports name tables, columns and row numbers only, never cell
 * values. The three legacy tabs stay in Google Sheets (decision 2) and are not read.
 *
 * A date that cannot be read (for example a year typed with 3 digits) in an optional column is left blank and its
 * original text is kept in copy_exceptions for correction later. Every other conversion problem stops the copy.
 */
import nextEnv from "@next/env";
import { google } from "googleapis";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--yes");

const LEGACY_TABS = new Set(["Legacy Pending NS", "Legacy Pending COLL", "Legacy Repairs"]);
/** Old employee IDs confirmed by the owner on October 4, 2026. */
const EMPLOYEE_ID_MAP = new Map([["DPE-0001", "MD-2026-0001"], ["DPE-0007", "MD-2026-0004"]]);
/** Sheet column names that differ from the table's. */
const RENAMED_COLUMNS = { audit_log: { sheet: "table_name" } };
/** Parents before children, so every link points to a row that is already there. */
const LOAD_ORDER = [
  "branches", "employees", "employee_branches", "roles", "users", "user_roles", "system_settings", "holidays", "remittance_methods",
  "program_categories", "programs", "program_incentives", "members", "member_programs", "member_transfers", "remittances", "sales",
  "beneficiaries", "collections", "remittance_collections", "receipt_photos", "cash_accounts", "expenses", "cash_transactions",
  "vendor_payables", "bank_deposits", "fidelity", "commissions", "attendance", "leave_requests", "pay_profiles", "payroll_runs",
  "payroll_lines", "payroll_adjustments", "report_remarks", "report_notes", "daily_audits", "weekly_audits", "monthly_audits",
  "yearly_audits", "record_corrections", "audit_log", "copy_exceptions",
];
/** Tables the copy fills itself rather than from a tab. */
const NOT_FROM_TABS = new Set(["copy_exceptions"]);
/** Sheet columns with no table column: the photo itself moves to Supabase Storage. */
const IGNORED_SHEET_COLUMNS = new Set(["receipt_photos.chunk_count", "receipt_photos.photo_data_1", "receipt_photos.photo_data_2", "receipt_photos.photo_data_3", "receipt_photos.photo_data_4"]);
/** Columns the copy fills itself or the database computes. */
const DERIVED = new Set(["collections.or_key", "collections.legacy_duplicate", "sales.application_key", "sales.legacy_duplicate", "receipt_photos.storage_path"]);

const tableName = (tab) => tab.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const entryKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const blank = (value) => value === undefined || value === null || String(value).trim() === "";

// ---------------------------------------------------------------- value conversion

const MANILA_OFFSET_MS = 8 * 3_600_000;
const pad = (n) => String(n).padStart(2, "0");
/** Sheets serial number (days since 1899-12-30, Manila wall time) → epoch milliseconds. */
const serialToMs = (serial) => Math.round((serial - 25569) * 86_400_000) - MANILA_OFFSET_MS;
const manilaDate = (ms) => { const d = new Date(ms + MANILA_OFFSET_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const validDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;

function toMoment(value) {
  if (typeof value === "number") return new Date(serialToMs(value)).toISOString();
  const text = String(value).trim();
  if (validDate(text)) return new Date(Date.parse(`${text}T00:00:00+08:00`)).toISOString();
  // Without a zone, a time is Manila time; with Z or an offset it is used as given.
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(" ", "T")}+08:00`;
  const ms = Date.parse(zoned);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) || Number.isNaN(ms)) throw new Error("not a date and time");
  return new Date(ms).toISOString();
}

function toDay(value) {
  if (typeof value === "number") return manilaDate(serialToMs(value));
  const text = String(value).trim();
  if (validDate(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return manilaDate(Date.parse(toMoment(text)));
  throw new Error("not a YYYY-MM-DD date");
}

function convert(value, column) {
  switch (column.type) {
    case "text": return typeof value === "number" ? String(value) : String(value).trim();
    case "integer": {
      const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
      if (!Number.isInteger(number)) throw new Error("not a whole number");
      return number;
    }
    case "numeric": case "double precision": {
      const number = typeof value === "number" ? value : Number(String(value).replace(/[,₱\s]/g, "").replace(/^PHP/i, ""));
      if (!Number.isFinite(number)) throw new Error("not a number");
      if (column.type === "numeric" && Math.abs(Math.round(number * 100) - number * 100) > 1e-6) throw new Error("more than 2 decimal places");
      return number;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const text = String(value).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(text)) return true;
      if (["false", "no", "n", "0"].includes(text)) return false;
      throw new Error("not true/false");
    }
    case "date": return toDay(value);
    case "timestamp with time zone": return toMoment(value);
    case "jsonb": {
      if (typeof value !== "string") return value;
      try { return JSON.parse(value); } catch { throw new Error("not valid JSON"); }
    }
    default: throw new Error(`unsupported column type ${column.type}`);
  }
}

/** Value used when the cell is blank: null, or the column's default for required true/false columns. */
function blankValue(column) {
  if (column.nullable) return null;
  if (column.type === "boolean") return false;
  throw new Error("required but blank");
}

// ---------------------------------------------------------------- read

const spreadsheetId = (process.env.GOOGLE_SHEET_ID ?? "").match(/\/d\/([\w-]+)/)?.[1] ?? process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
if (!process.env.DIRECT_DATABASE_URL) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL ?? "")?.[1] ?? "unknown";

const columnRows = await sql`
  select table_name, column_name, data_type, is_nullable = 'YES' as nullable, is_generated = 'ALWAYS' as generated
  from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`;
const tables = new Map();
for (const row of columnRows) {
  if (!tables.has(row.table_name)) tables.set(row.table_name, []);
  tables.get(row.table_name).push({ name: row.column_name, type: row.data_type, nullable: row.nullable, generated: row.generated });
}

const tabs = (await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" })).data.sheets.map((sheet) => sheet.properties.title);
const copied = tabs.filter((tab) => !LEGACY_TABS.has(tab));
const problems = [];
const notes = [];
const problem = (table, message) => problems.push(`[${table}] ${message}`);

for (const tab of copied) if (!tables.has(tableName(tab))) problem(tableName(tab), `tab "${tab}" has no table`);
for (const table of tables.keys()) if (!NOT_FROM_TABS.has(table) && !copied.some((tab) => tableName(tab) === table)) notes.push(`[${table}] no tab; left empty`);

const keyRows = await sql`
  select tc.table_name, kcu.column_name from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position`;
const primaryKeys = new Map();
for (const row of keyRows) primaryKeys.set(row.table_name, [...(primaryKeys.get(row.table_name) ?? []), row.column_name]);
const exceptions = [];

const values = [];
for (let start = 0; start < copied.length; start += 10) {
  const batch = copied.slice(start, start + 10);
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: batch.map((tab) => `'${tab.replace(/'/g, "''")}'`), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  values.push(...response.data.valueRanges);
}

// ---------------------------------------------------------------- convert

/** table → { columns, rows, money: column → cents } */
const loads = new Map();
copied.forEach((tab, tabIndex) => {
  const table = tableName(tab), columns = tables.get(table);
  if (!columns) return;
  const [header = [], ...rows] = values[tabIndex].values ?? [];
  const renamed = RENAMED_COLUMNS[table] ?? {};
  const names = header.map((name) => { const clean = String(name ?? "").trim(); return renamed[clean] ?? clean; });
  const byName = new Map(columns.map((column) => [column.name, column]));
  names.forEach((name, index) => {
    if (!name) { if (rows.some((row) => !blank(row[index]))) problem(table, `column ${index + 1} has data but no header`); return; }
    if (!byName.has(name) && !IGNORED_SHEET_COLUMNS.has(`${table}.${name}`)) problem(table, `sheet column ${name} has no matching table column`);
  });
  const wanted = columns.filter((column) => !column.generated && !DERIVED.has(`${table}.${column.name}`));
  const source = new Map(wanted.map((column) => [column.name, names.indexOf(column.name)]));
  const output = [];
  let skipped = 0;
  rows.forEach((row, rowIndex) => {
    if (row.every(blank)) return;
    const sheetRow = rowIndex + 2;
    if (table === "employee_branches" && String(row[names.indexOf("employee_id")] ?? "").trim() === "DPE-0007") { skipped++; return; }
    const record = {};
    const unreadable = [];
    for (const column of wanted) {
      const index = source.get(column.name);
      let cell = index >= 0 ? row[index] : undefined;
      if (column.name.endsWith("employee_id") && typeof cell === "string" && EMPLOYEE_ID_MAP.has(cell.trim())) cell = EMPLOYEE_ID_MAP.get(cell.trim());
      try { record[column.name] = blank(cell) ? blankValue(column) : convert(cell, column); }
      catch (error) {
        record[column.name] = null;
        if (column.type === "date" && column.nullable && typeof cell === "string") unreadable.push({ column: column.name, original: cell, reason: error.message, sheetRow });
        else problem(table, `row ${sheetRow}, ${column.name}: ${error.message}`);
      }
    }
    for (const item of unreadable) {
      exceptions.push({
        exception_id: `CX-${String(exceptions.length + 1).padStart(5, "0")}`,
        table_name: table,
        record_id: (primaryKeys.get(table) ?? []).map((key) => record[key] ?? "").join(":"),
        column_name: item.column,
        original_text: item.original,
        reason: `${item.reason} (sheet row ${item.sheetRow})`,
      });
    }
    output.push(record);
  });
  if (skipped) notes.push(`[${table}] ${skipped} DPE-0007 rows left out (exact copies of MD-2026-0004's assignments)`);
  loads.set(table, { columns: [...wanted.map((column) => column.name)], rows: output, moneyColumns: columns.filter((column) => column.type === "numeric").map((column) => column.name) });
});

/** Second and later copies of a number that was already duplicated keep their rows but are skipped by the unique rule. */
function flagDuplicates(table, keyOf, applies) {
  const load = loads.get(table);
  if (!load) return;
  load.columns.push("legacy_duplicate");
  const seen = new Set();
  let flagged = 0;
  for (const record of load.rows) {
    const key = keyOf(record);
    record.legacy_duplicate = Boolean(key && applies(record) && seen.has(key));
    if (record.legacy_duplicate) flagged++;
    if (key && applies(record)) seen.add(key);
  }
  notes.push(`[${table}] ${flagged} rows flagged legacy_duplicate`);
}
flagDuplicates("collections", (record) => entryKey(record.or_number), (record) => record.status === "Posted");
flagDuplicates("sales", (record) => entryKey(record.application_no), () => true);

loads.set("copy_exceptions", { columns: ["exception_id", "table_name", "record_id", "column_name", "original_text", "reason"], rows: exceptions, moneyColumns: [] });
const exceptionGroups = new Map();
for (const item of exceptions) {
  const key = `[${item.table_name}] ${item.column_name}: ${item.reason.replace(/ \(sheet row \d+\)$/, "")}`;
  exceptionGroups.set(key, [...(exceptionGroups.get(key) ?? []), /sheet row (\d+)/.exec(item.reason)[1]]);
}
for (const [key, rowNumbers] of exceptionGroups) notes.push(`${key}; left blank, original kept in copy_exceptions (${rowNumbers.length}: sheet rows ${rowNumbers.join(", ")})`);

const photos = loads.get("receipt_photos");
if (photos?.rows.length) problem("receipt_photos", `${photos.rows.length} photos need uploading to Storage; photo upload is not written yet`);
if (photos) { photos.columns.push("storage_path"); for (const record of photos.rows) record.storage_path = ""; }

const cents = (value) => Math.round(Number(value) * 100);
const expected = new Map([...loads].map(([table, load]) => [table, {
  rows: load.rows.length,
  totals: Object.fromEntries(load.moneyColumns.map((column) => [column, load.rows.reduce((sum, record) => sum + (record[column] === null || record[column] === undefined ? 0 : cents(record[column])), 0)])),
}]));

// ---------------------------------------------------------------- report

console.log(`Source: ${copied.length} tabs (legacy tabs skipped). Target: Supabase project ${projectRef}.`);
for (const table of LOAD_ORDER) if (loads.has(table)) console.log(`  ${table.padEnd(24)} ${String(loads.get(table).rows.length).padStart(7)} rows`);
for (const note of notes) console.log(`NOTE  ${note}`);
const grouped = new Map();
for (const message of problems) { const key = message.replace(/row \d+, /, "row N, "); grouped.set(key, [...(grouped.get(key) ?? []), /row (\d+)/.exec(message)?.[1]].filter(Boolean)); }
for (const [message, rowNumbers] of grouped) console.log(`ERROR ${message}${rowNumbers.length ? ` (${rowNumbers.length}: rows ${rowNumbers.slice(0, 12).join(", ")}${rowNumbers.length > 12 ? ", ..." : ""})` : ""}`);

if (problems.length) { console.log(`\n${problems.length} problem(s). Nothing was written.`); await sql.end(); process.exit(1); }
if (!APPLY) { console.log("\nDry run passed. Nothing was written. Run with --apply --yes to load the database."); await sql.end(); process.exit(0); }
if (!CONFIRMED) { console.log(`\nThis replaces ALL data in Supabase project ${projectRef}. Add --yes to confirm.`); await sql.end(); process.exit(1); }

// ---------------------------------------------------------------- load and verify

const started = Date.now();
await sql.begin(async (tx) => {
  await tx.unsafe(`truncate ${LOAD_ORDER.map((table) => `"${table}"`).join(", ")} restart identity cascade`);
  for (const table of LOAD_ORDER) {
    const load = loads.get(table);
    if (!load?.rows.length) continue;
    const size = Math.max(1, Math.floor(30_000 / load.columns.length));
    for (let start = 0; start < load.rows.length; start += size) {
      const chunk = load.rows.slice(start, start + size).map((record) => Object.fromEntries(load.columns.map((column) => [column, record[column] !== null && typeof record[column] === "object" ? tx.json(record[column]) : record[column]])));
      await tx`insert into ${tx(table)} ${tx(chunk, load.columns)}`;
    }
  }
  const mismatches = [];
  for (const [table, want] of expected) {
    const sums = Object.keys(want.totals).map((column) => `coalesce(round(sum("${column}") * 100), 0)::bigint as "${column}"`);
    const [actual] = await tx.unsafe(`select count(*)::int as __rows${sums.length ? ", " + sums.join(", ") : ""} from "${table}"`);
    if (actual.__rows !== want.rows) mismatches.push(`${table}: ${actual.__rows} rows, expected ${want.rows}`);
    for (const [column, total] of Object.entries(want.totals)) if (Number(actual[column]) !== total) mismatches.push(`${table}.${column}: total differs by ${(Number(actual[column]) - total) / 100}`);
  }
  if (mismatches.length) throw new Error(`Verification failed, load undone:\n  ${mismatches.join("\n  ")}`);
});
console.log(`\nLoaded and verified in ${Math.round((Date.now() - started) / 1000)} s: row counts and money totals match the sheets for every table.`);
await sql.end();
