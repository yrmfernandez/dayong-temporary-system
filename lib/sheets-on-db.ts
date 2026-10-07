import { sql, type SQL } from "drizzle-orm";

import { getDb, inTransaction, type Queryable } from "@/lib/db";

/**
 * The Google Sheets API, answered from PostgreSQL. Each sheet tab is a table with the same columns in the same order
 * (checked October 5, 2026), and row_seq keeps the rows in the order they were added, so code written for Sheets
 * ("'Remittances'!B5:C5", append to "Collections!A:AO", delete rows 4 to 6) reads and writes the same data here.
 *
 * lib/google-sheets.ts sends every tab listed in SHEET_TITLES here; the Legacy Pending tabs stay in Google Sheets.
 * Writes run in one transaction that names the signed-in user, so the audit trigger records who changed what, and the
 * transaction is passed to every helper explicitly. Reads never join a transaction: they always use the database
 * directly, so a read can never land on another request's transaction (or one that has already ended).
 */
export const SHEET_TITLES = [
  "Members", "Member programs", "Sales", "Beneficiaries", "Programs", "Program Incentives", "Remittances", "Collections", "Branches",
  "Users", "Roles", "User Roles", "Attendance", "Leave Requests", "Employees", "Remittance Collections", "Expenses", "Cash Transactions",
  "Employee Branches", "Record Corrections", "Report Remarks", "Fidelity", "Cash Accounts", "Vendor Payables", "Commissions",
  "Remittance Methods", "Pay Profiles", "Payroll Runs", "Payroll Lines", "Payroll Adjustments", "Audit Log", "Daily Audits",
  "Member Transfers", "Program Categories", "Weekly Audits", "Monthly Audits", "Yearly Audits", "Holidays", "System Settings",
  "Receipt Photos", "Report Notes", "Bank Deposits",
] as const;
/** Database-only columns that are not part of the sheet layout. */
const HIDDEN = new Set(["row_seq", "or_key", "application_key", "legacy_duplicate", "storage_path"]);
/** Database-only columns of one table: link IDs the database fills itself (phase 2 of linked tables). */
const HIDDEN_IN: Record<string, Set<string>> = {
  collections: new Set(["branch_id", "mas_employee_id"]), sales: new Set(["branch_id", "mas_employee_id"]), member_programs: new Set(["branch_id", "mas_employee_id"]),
  remittances: new Set(["branch_id", "mas_employee_id"]), bank_deposits: new Set(["branch_id", "mas_employee_id"]), member_transfers: new Set(["branch_id", "from_employee_id"]),
  attendance: new Set(["branch_id"]), cash_transactions: new Set(["branch_id"]), expenses: new Set(["branch_id"]), payroll_runs: new Set(["branch_id"]), vendor_payables: new Set(["branch_id"]),
};
/** Sheet header names that differ from the column name. */
const HEADER_NAMES: Record<string, Record<string, string>> = { audit_log: { table_name: "sheet" } };

export const tableOf = (title: string) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const byTitle = new Map(SHEET_TITLES.map((title) => [title.toLowerCase(), title]));
export const isDatabaseSheet = (title: string) => byTitle.has(title.trim().toLowerCase());

type Column = { name: string; type: string; nullable: boolean; writable: boolean };
type Layout = { table: string; title: string; columns: Column[] };
const shared = globalThis as typeof globalThis & { dayongSheetLayouts?: Promise<Map<string, Layout>> };

/** Each tab's columns in sheet order, read once per server from information_schema. */
function layouts(db: Queryable) {
  shared.dayongSheetLayouts ??= (async () => {
    const rows = rowsOf<{ table_name: string; column_name: string; data_type: string; nullable: boolean; writable: boolean }>(await db.execute(sql`
      select table_name, column_name, data_type, is_nullable = 'YES' as nullable, (is_generated = 'NEVER' and is_identity = 'NO') as writable
      from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`));
    const map = new Map<string, Layout>();
    for (const title of SHEET_TITLES) {
      const table = tableOf(title);
      const columns = rows.filter((row) => row.table_name === table && !HIDDEN.has(row.column_name) && !HIDDEN_IN[table]?.has(row.column_name)).map((row) => ({ name: row.column_name, type: row.data_type, nullable: row.nullable, writable: row.writable }));
      if (columns.length) map.set(title.toLowerCase(), { table, title, columns });
    }
    return map;
  })().catch((error) => { shared.dayongSheetLayouts = undefined; throw error; });
  return shared.dayongSheetLayouts;
}
async function layoutOf(title: string) {
  const layout = (await layouts(getDb())).get(title.trim().toLowerCase());
  if (!layout) throw new Error(`No database table for sheet "${title}".`);
  return layout;
}

/** Number of rows in a tab that match `where`. */
export async function countSheetRows(title: string, where: SQL = sql`true`) {
  const layout = await layoutOf(title);
  const [row] = rowsOf<{ count: number }>(await getDb().execute(sql`select count(*)::int as count from ${ident(layout.table)} where ${where}`));
  return Number(row?.count ?? 0);
}

/** Rows of a raw query: postgres.js returns them as the result itself, PGlite (tests) under .rows. */
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

// ---------------------------------------------------------------- A1 ranges

type A1 = { title: string; c1: number; c2: number; r1: number; r2: number };
const columnIndex = (letters: string) => [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
export const columnLetters = (index: number) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

/** "'Member programs'!S5", "Collections!A:AO", "'Users'!1:1", "Roles" → sheet, columns (0-based) and rows (1-based). */
export function parseA1(range: string): A1 {
  const match = /^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.*))?$/.exec(range.trim());
  if (!match) throw new Error(`Unreadable range ${range}`);
  const title = (match[1] ?? match[2] ?? "").replace(/''/g, "'");
  const part = (match[3] ?? "").trim();
  const result: A1 = { title, c1: 0, c2: Number.POSITIVE_INFINITY, r1: 1, r2: Number.POSITIVE_INFINITY };
  if (!part) return result;
  const [start, end = start] = part.split(":");
  const read = (cell: string) => { const found = /^([A-Za-z]*)(\d*)$/.exec(cell) ?? ["", "", ""]; return { col: found[1] ? columnIndex(found[1]) : null, row: found[2] ? Number(found[2]) : null }; };
  const a = read(start), b = read(end);
  if (a.col !== null) result.c1 = a.col;
  if (b.col !== null) result.c2 = b.col;
  if (a.row !== null) result.r1 = a.row;
  if (b.row !== null) result.r2 = b.row; else if (a.row !== null && part.indexOf(":") < 0) result.r2 = a.row;
  if (a.col === null && b.col === null) { result.c1 = 0; result.c2 = Number.POSITIVE_INFINITY; }
  if (a.col !== null && part.indexOf(":") < 0) result.c2 = a.col;
  return result;
}

// ---------------------------------------------------------------- values

type Render = { unformatted: boolean };
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** A database value as Google Sheets would hand it back. */
function toCell(value: unknown, column: Column, render: Render): unknown {
  if (value === null || value === undefined) return "";
  if (column.type === "boolean") return render.unformatted ? Boolean(value) : value ? "TRUE" : "FALSE";
  if (["numeric", "integer", "bigint", "double precision", "smallint", "real"].includes(column.type)) { const number = Number(value); return render.unformatted ? number : String(number); }
  if (column.type === "date") return value instanceof Date ? isoDay(value) : String(value).slice(0, 10);
  if (column.type.startsWith("timestamp")) {
    if (value instanceof Date) return value.toISOString();
    // PostgreSQL text like "2026-10-04 03:05:28.78+00" or "+08": JavaScript needs "T" and an "+hh:mm" offset.
    const iso = String(value).trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  }
  if (column.type === "jsonb" || column.type === "json") return typeof value === "string" ? value : JSON.stringify(value);
  return String(value);
}

const MANILA = 8 * 3_600_000;
/** A value written through the Sheets API, converted to the column's type. USER_ENTERED text starting with ' is literal. */
function fromCell(raw: unknown, column: Column, userEntered: boolean): unknown {
  let value = raw;
  if (typeof value === "string" && userEntered && value.startsWith("'")) value = value.slice(1);
  const blank = value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  if (column.type === "boolean") return blank ? false : value === true || /^(true|yes|y|1)$/i.test(String(value).trim());
  if (blank) return column.nullable ? null : column.type === "text" ? "" : null;
  switch (column.type) {
    case "numeric": case "integer": case "bigint": case "double precision": case "smallint": case "real": {
      const number = typeof value === "number" ? value : Number(String(value).replace(/[,₱\s]/g, "").replace(/^PHP/i, ""));
      if (!Number.isFinite(number)) return null;
      return column.type === "integer" || column.type === "bigint" || column.type === "smallint" ? Math.round(number) : number;
    }
    case "date": {
      if (typeof value === "number") return isoDay(new Date(Math.round((value - 25569) * 86_400_000)));
      const text = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
      const parsed = Date.parse(text);
      return Number.isNaN(parsed) ? null : isoDay(new Date(parsed + MANILA));
    }
    case "timestamp with time zone": case "timestamp without time zone": {
      if (typeof value === "number") return new Date(Math.round((value - 25569) * 86_400_000) - MANILA).toISOString();
      const text = String(value).trim();
      const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) || !/\d{2}:\d{2}/.test(text) ? text : `${text.replace(" ", "T")}+08:00`;
      const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(zoned) ? `${zoned}T00:00:00+08:00` : zoned);
      return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
    }
    case "jsonb": case "json": {
      if (typeof value !== "string") return JSON.stringify(value);
      try { JSON.parse(value); return value; } catch { return JSON.stringify(value); }
    }
    default: return typeof value === "number" || typeof value === "boolean" ? String(value) : String(value);
  }
}

// ---------------------------------------------------------------- reads

const ident = (name: string) => sql.identifier(name);
const list = (names: string[]) => sql.join(names.map(ident), sql`, `);

async function readRange(range: string, render: Render, db: Queryable) {
  const a1 = parseA1(range);
  const layout = await layoutOf(a1.title);
  const columns = layout.columns.slice(a1.c1, Math.min(layout.columns.length, a1.c2 + 1));
  const values: unknown[][] = [];
  if (a1.r1 <= 1) values.push(columns.map((column) => HEADER_NAMES[layout.table]?.[column.name] ?? column.name));
  const first = Math.max(2, a1.r1), last = a1.r2;
  if (columns.length && last >= 2) {
    const limit = Number.isFinite(last) ? sql` limit ${last - first + 1}` : sql``;
    const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`select ${list(columns.map((column) => column.name))} from ${ident(layout.table)} order by row_seq offset ${first - 2}${limit}`));
    for (const row of rows) values.push(columns.map((column) => toCell(row[column.name], column, render)));
  }
  // Like Sheets: no trailing empty cells, and no trailing empty rows.
  for (const row of values) while (row.length && row[row.length - 1] === "") row.pop();
  while (values.length && !values[values.length - 1].length) values.pop();
  return { range, majorDimension: "ROWS", values };
}

// ---------------------------------------------------------------- writes

async function rowSeqAt(table: string, rowNumber: number, db: Queryable) {
  if (rowNumber < 2) return null;
  const [row] = rowsOf<{ row_seq: number }>(await db.execute(sql`select row_seq from ${ident(table)} order by row_seq offset ${rowNumber - 2} limit 1`));
  return row?.row_seq ?? null;
}

/** Adds rows in one statement (an attendance close-out can add hundreds at once). Unset columns take their default. */
async function insertRows(layout: Layout, startColumn: number, rows: unknown[][], userEntered: boolean, db: Queryable, extras: Array<Record<string, unknown>> = []) {
  const records = rows.map((values, index) => {
    const record = new Map<string, unknown>();
    values.forEach((value, offset) => {
      const column = layout.columns[startColumn + offset];
      if (column?.writable) record.set(column.name, fromCell(value, column, userEntered));
    });
    for (const column of layout.columns) if (column.writable && !record.has(column.name) && !column.nullable) record.set(column.name, fromCell("", column, userEntered));
    // Database-only columns (e.g. legacy_duplicate) given by the caller.
    for (const [name, value] of Object.entries(extras[index] ?? {})) record.set(name, value);
    return record;
  }).filter((record) => record.size);
  if (!records.length) return;
  const extraNames = [...new Set(extras.flatMap((extra) => Object.keys(extra ?? {})))];
  const names = [...layout.columns.filter((column) => records.some((record) => record.has(column.name))).map((column) => column.name), ...extraNames];
  // PostgreSQL allows 65,535 parameters per statement.
  const size = Math.max(1, Math.floor(30_000 / names.length));
  for (let start = 0; start < records.length; start += size) {
    const tuples = records.slice(start, start + size).map((record) => sql`(${sql.join(names.map((name) => (record.has(name) ? sql`${record.get(name)}` : sql`default`)), sql`, `)})`);
    await db.execute(sql`insert into ${ident(layout.table)} (${list(names)}) values ${sql.join(tuples, sql`, `)}`);
  }
}

async function updateCells(layout: Layout, rowNumber: number, startColumn: number, values: unknown[], userEntered: boolean, db: Queryable) {
  if (rowNumber < 2) return; // Row 1 holds the column names, which come from the table.
  const assignments: SQL[] = [];
  values.forEach((value, offset) => {
    const column = layout.columns[startColumn + offset];
    // Sheets' "no change" for a cell in an update is undefined/null in the values array.
    if (column?.writable && value !== undefined && value !== null) assignments.push(sql`${ident(column.name)} = ${fromCell(value, column, userEntered)}`);
  });
  if (!assignments.length) return;
  const seq = await rowSeqAt(layout.table, rowNumber, db);
  // Writing below the last row adds a row, as in Sheets.
  if (seq === null) return insertRows(layout, startColumn, [values], userEntered, db);
  await db.execute(sql`update ${ident(layout.table)} set ${sql.join(assignments, sql`, `)} where row_seq = ${seq}`);
}

async function writeRange(range: string, values: unknown[][], userEntered: boolean, db: Queryable) {
  const a1 = parseA1(range);
  const layout = await layoutOf(a1.title);
  for (const [offset, row] of values.entries()) await updateCells(layout, a1.r1 + offset, a1.c1, row, userEntered, db);
}

async function deleteRows(table: string, startIndex: number, endIndex: number, db: Queryable) {
  // startIndex/endIndex are 0-based sheet rows (0 = the header row); row_seq order gives the data rows.
  const first = Math.max(1, startIndex), count = endIndex - first;
  if (count <= 0) return;
  await db.execute(sql`delete from ${ident(table)} where row_seq in (select row_seq from ${ident(table)} order by row_seq offset ${first - 1} limit ${count})`);
}

type CellValue = { userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string } };
const cellValue = (cell: CellValue | undefined) => { const entered = cell?.userEnteredValue; return entered ? entered.stringValue ?? entered.numberValue ?? entered.boolValue ?? entered.formulaValue ?? "" : undefined; };

// ---------------------------------------------------------------- the client

type Params = Record<string, unknown> & { range?: string | null; ranges?: string[] | null; valueRenderOption?: string | null; valueInputOption?: string | null; requestBody?: Record<string, unknown> | null };
const renderOf = (params: Params): Render => ({ unformatted: params.valueRenderOption === "UNFORMATTED_VALUE" || params.valueRenderOption === "FORMULA" });

/** Same shape as googleapis' sheets_v4.Sheets for the calls the app makes. */
export const sheetsOnDb = {
  spreadsheets: {
    get: async () => {
      const map = await layouts(getDb());
      return { data: { sheets: SHEET_TITLES.filter((title) => map.has(title.toLowerCase())).map((title, index) => ({ properties: { title, sheetId: index, index, gridProperties: { rowCount: 1_000_000, columnCount: map.get(title.toLowerCase())!.columns.length } } })) } };
    },
    batchUpdate: async (params: Params) => {
      const requests = (params.requestBody?.requests ?? []) as Array<Record<string, Record<string, unknown>>>;
      await inTransaction(async (db) => {
        const map = await layouts(getDb());
        const present = SHEET_TITLES.filter((title) => map.has(title.toLowerCase()));
        const layoutById = (sheetId: unknown) => { const title = present[Number(sheetId)]; if (!title) throw new Error(`Unknown sheet ${String(sheetId)}.`); return map.get(title.toLowerCase())!; };
        for (const request of requests) {
          if (request.deleteDimension) {
            const range = request.deleteDimension.range as { sheetId: number; dimension: string; startIndex: number; endIndex: number };
            if (range.dimension === "ROWS") await deleteRows(layoutById(range.sheetId).table, range.startIndex, range.endIndex, db);
          } else if (request.updateCells) {
            const { range, rows } = request.updateCells as { range: { sheetId: number; startRowIndex: number; startColumnIndex?: number }; rows: Array<{ values?: CellValue[] }> };
            const layout = layoutById(range.sheetId);
            for (const [offset, row] of rows.entries()) await updateCells(layout, range.startRowIndex + 1 + offset, range.startColumnIndex ?? 0, (row.values ?? []).map(cellValue), true, db);
          } else if (request.appendCells) {
            const { sheetId, rows } = request.appendCells as { sheetId: number; rows: Array<{ values?: CellValue[] }> };
            await insertRows(layoutById(sheetId), 0, rows.map((row) => (row.values ?? []).map(cellValue)), true, db);
          }
          // addSheet, appendDimension, formatting and the like have nothing to do in a database.
        }
      });
      return { data: {} };
    },
    values: {
      get: async (params: Params) => ({ data: await readRange(String(params.range ?? ""), renderOf(params), getDb()) }),
      batchGet: async (params: Params) => {
        const db = getDb(), render = renderOf(params);
        return { data: { valueRanges: await Promise.all((params.ranges ?? []).map((range) => readRange(range, render, db))) } };
      },
      append: async (params: Params) => {
        const a1 = parseA1(String(params.range ?? ""));
        const values = ((params.requestBody?.values ?? []) as unknown[][]);
        const layout = await layoutOf(a1.title);
        await inTransaction((tx) => insertRows(layout, a1.c1, values, params.valueInputOption !== "RAW", tx));
        return { data: { updates: { updatedRange: params.range, updatedRows: values.length } } };
      },
      update: async (params: Params) => {
        const values = ((params.requestBody?.values ?? []) as unknown[][]);
        await inTransaction((tx) => writeRange(String(params.range ?? ""), values, params.valueInputOption !== "RAW", tx));
        return { data: { updatedRange: params.range } };
      },
      batchUpdate: async (params: Params) => {
        const body = (params.requestBody ?? {}) as { valueInputOption?: string; data?: Array<{ range: string; values: unknown[][] }> };
        await inTransaction(async (tx) => { for (const item of body.data ?? []) await writeRange(item.range, item.values ?? [], body.valueInputOption !== "RAW", tx); });
        return { data: {} };
      },
    },
  },
};

/**
 * Rows of one tab that match `where`, in the tab's sheet layout (header row first, every column, oldest first), for
 * code written for whole-sheet reads that only needs some rows: the database filters before anything is converted.
 */
/**
 * Rows of a tab that match `where`, laid out like the sheet. `only` reads just those columns (by name) and leaves the
 * others blank in their positions, so position-based code works unchanged while large columns are not transferred.
 */
export async function readSheetRows(title: string, where: SQL, { unformatted = true, latest = 0, only }: { unformatted?: boolean; latest?: number; only?: string[] } = {}) {
  const layout = await layoutOf(title);
  const wanted = only ? layout.columns.filter((column) => only.includes(column.name)) : layout.columns;
  if (only && wanted.length !== only.length) throw new Error(`${title} has no column ${only.filter((name) => !wanted.some((column) => column.name === name)).join(", ")}.`);
  // latest: only the newest rows (still returned oldest first).
  const order = latest ? sql`order by row_seq desc limit ${latest}` : sql`order by row_seq`;
  const found = rowsOf<Record<string, unknown>>(await getDb().execute(sql`select ${list(wanted.map((column) => column.name))} from ${ident(layout.table)} where ${where} ${order}`));
  const rows = latest ? found.reverse() : found;
  const read = new Set(wanted.map((column) => column.name));
  return [
    layout.columns.map((column) => HEADER_NAMES[layout.table]?.[column.name] ?? column.name),
    ...rows.map((row) => layout.columns.map((column) => (read.has(column.name) ? toCell(row[column.name], column, { unformatted }) : ""))),
  ];
}

/**
 * Like readSheetRows, plus each row's sheet row number (2 = first data row) in the whole tab, counted by the database,
 * so a caller that saves by position (updateCells) can read only the rows it needs. `where` may name columns unqualified
 * or as "<table>"."<column>".
 */
export async function readSheetRowsNumbered(title: string, where: SQL) {
  const layout = await layoutOf(title);
  const numbered = sql`(select *, row_number() over (order by row_seq) + 1 as sheet_row_number from ${ident(layout.table)}) as ${ident(layout.table)}`;
  const found = rowsOf<Record<string, unknown>>(await getDb().execute(sql`select ${list(layout.columns.map((column) => column.name))}, sheet_row_number from ${numbered} where ${where} order by row_seq`));
  return {
    rows: [
      layout.columns.map((column) => HEADER_NAMES[layout.table]?.[column.name] ?? column.name),
      ...found.map((row) => layout.columns.map((column) => toCell(row[column.name], column, { unformatted: true }))),
    ],
    rowNumbers: found.map((row) => Number(row.sheet_row_number)),
  };
}

/**
 * Appends rows in a tab's sheet layout in one transaction (used by the legacy import script). `extras[i]` sets
 * database-only columns of row i, such as legacy_duplicate on a receipt or application number already in use.
 */
export async function appendSheetRows(title: string, rows: unknown[][], extras: Array<Record<string, unknown>> = []) {
  const layout = await layoutOf(title);
  await inTransaction((tx) => insertRows(layout, 0, rows, false, tx, extras));
}
