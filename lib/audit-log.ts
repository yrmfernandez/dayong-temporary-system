import type { sheets_v4 } from "googleapis";

/**
 * Audit trail for edits and deletes. Every app write to Google Sheets passes through lib/google-sheets.ts, which
 * wraps it with auditedWrite: the affected rows are read before the write (and again after, for edits), and one
 * "Audit Log" row is appended per changed record with who did it and what changed. Creations are not logged here;
 * each sheet's encoder columns already record who created a row. Writes made by hand in Google Sheets bypass this.
 */
export const AUDIT_SHEET = "Audit Log";
export const AUDIT_HEADERS = ["audit_id", "logged_at", "action", "sheet", "record_id", "row_number", "changes_json", "user_id", "employee_id", "user_name"];

export type AuditActor = { userId: string; employeeId: string; name: string };
export type AuditAction = "Edited" | "Deleted";
/** Edited: only the changed columns as [before, after]. Deleted: the full row as it was, with its headers. */
export type AuditChanges = { changes: Record<string, [string, string]> } | { headers: string[]; row: string[] };

type Client = Pick<sheets_v4.Sheets, "spreadsheets">;
type RowKey = { title: string; row: number };
type Plan = { edits: RowKey[]; deletes: RowKey[] };

const MAX_JSON = 45000; // Google Sheets allows 50,000 characters per cell.
const text = (value: unknown) => String(value ?? "");
const key = ({ title, row }: RowKey) => `${title}\u0000${row}`;
const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;
// Passwords and receipt photo data are never copied into the log.
const hidden = (header: string) => /password|hash|photo_data/i.test(header);

/** "'Sheet'!B5:E7" → sheet and 1-based rows; null when the range has no row numbers (whole columns). */
export function parseRange(range: string, rowCount = 1): { title: string; startRow: number; endRow: number } | null {
  const match = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?[A-Z]*\$?(\d+)?(?::\$?[A-Z]*\$?(\d+)?)?$/.exec(range.trim());
  if (!match || !match[3]) return null;
  const title = (match[1] ?? match[2]).replace(/''/g, "'");
  const startRow = Number(match[3]);
  const endRow = match[4] ? Number(match[4]) : startRow + Math.max(rowCount, 1) - 1;
  return { title, startRow, endRow };
}

function rowsOf(range: string, values: unknown[][] | undefined | null) {
  const parsed = parseRange(range, values?.length ?? 1);
  if (!parsed) return [];
  return Array.from({ length: parsed.endRow - parsed.startRow + 1 }, (_, index) => ({ title: parsed.title, row: parsed.startRow + index }));
}

// Header edits (row 1) and the log itself are never audited.
const auditable = (target: RowKey) => target.row > 1 && target.title !== AUDIT_SHEET;
const unique = (targets: RowKey[]) => [...new Map(targets.filter(auditable).map((target) => [key(target), target])).values()];

export function planValuesUpdate(params: sheets_v4.Params$Resource$Spreadsheets$Values$Update): Plan {
  return { edits: unique(rowsOf(params.range ?? "", params.requestBody?.values)), deletes: [] };
}

export function planValuesBatchUpdate(params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate): Plan {
  return { edits: unique((params.requestBody?.data ?? []).flatMap((item) => rowsOf(item.range ?? "", item.values))), deletes: [] };
}

export async function planBatchUpdate(client: Client, params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate): Promise<Plan> {
  const requests = params.requestBody?.requests ?? [];
  if (!requests.some((request) => request.updateCells || request.deleteDimension)) return { edits: [], deletes: [] };
  const metadata = await client.spreadsheets.get({ spreadsheetId: params.spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const titles = new Map((metadata.data.sheets ?? []).map((sheet) => [sheet.properties?.sheetId ?? -1, sheet.properties?.title ?? ""]));
  const span = (sheetId: number | null | undefined, start: number | null | undefined, end: number | null | undefined) => {
    const title = titles.get(sheetId ?? 0) ?? "";
    return title && end != null ? Array.from({ length: end - (start ?? 0) }, (_, index) => ({ title, row: (start ?? 0) + index + 1 })) : [];
  };
  const edits: RowKey[] = [], deletes: RowKey[] = [];
  for (const request of requests) {
    const cells = request.updateCells?.range;
    if (cells) edits.push(...span(cells.sheetId, cells.startRowIndex, cells.endRowIndex ?? (cells.startRowIndex ?? 0) + (request.updateCells?.rows?.length ?? 1)));
    const dimension = request.deleteDimension?.range;
    if (dimension?.dimension === "ROWS") deletes.push(...span(dimension.sheetId, dimension.startIndex, dimension.endIndex));
  }
  return { edits: unique(edits), deletes: unique(deletes) };
}

async function readRows(client: Client, spreadsheetId: string, targets: RowKey[]) {
  const titles = [...new Set(targets.map((target) => target.title))];
  const ranges = [...titles.map((title) => `${quoted(title)}!1:1`), ...targets.map((target) => `${quoted(target.title)}!${target.row}:${target.row}`)];
  const response = await client.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: "FORMATTED_VALUE" });
  const values = response.data.valueRanges?.map((range) => (range.values?.[0] ?? []).map(text)) ?? [];
  const headers = new Map(titles.map((title, index) => [title, values[index] ?? []]));
  const rows = new Map(targets.map((target, index) => [key(target), values[titles.length + index] ?? []]));
  return { headers, rows };
}

/** Readable column name for a change, falling back to the column letter. */
function columnLabel(headers: string[], index: number) {
  if (headers[index]) return headers[index];
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return `Column ${name}`;
}

export function diffRow(headers: string[], before: string[], after: string[]): Record<string, [string, string]> {
  const changes: Record<string, [string, string]> = {};
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    const from = text(before[index]), to = text(after[index]);
    if (from === to) continue;
    const label = columnLabel(headers, index);
    changes[label] = hidden(label) ? ["(hidden)", "(changed)"] : [from, to];
  }
  return changes;
}

function serialize(changes: AuditChanges) {
  const json = JSON.stringify(changes);
  return json.length <= MAX_JSON ? json : `${json.slice(0, MAX_JSON)}…(truncated)`;
}

let ensured: Promise<void> | undefined;
async function ensureAuditSheet(client: Client, spreadsheetId: string) {
  ensured ??= (async () => {
    const metadata = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    if (metadata.data.sheets?.some((sheet) => sheet.properties?.title === AUDIT_SHEET)) return;
    try {
      await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: AUDIT_SHEET, gridProperties: { rowCount: 1000, columnCount: AUDIT_HEADERS.length, frozenRowCount: 1 } } } }] } });
      await client.spreadsheets.values.update({ spreadsheetId, range: `${quoted(AUDIT_SHEET)}!A1`, valueInputOption: "RAW", requestBody: { values: [AUDIT_HEADERS] } });
    } catch (error) {
      // Another request may have created it first.
      const again = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
      if (!again.data.sheets?.some((sheet) => sheet.properties?.title === AUDIT_SHEET)) throw error;
    }
  })().catch((error) => { ensured = undefined; throw error; });
  return ensured;
}

let sequence = 0;
function auditId(now: Date) {
  sequence = (sequence + 1) % 1000;
  return `AUD-${now.toISOString().replace(/\D/g, "").slice(0, 17)}-${String(sequence).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Runs a write and logs what it edited or deleted. Logging problems are reported to the server log but never undo or
 * block the business write, which has already been saved by then.
 */
export async function auditedWrite<T>(client: Client, spreadsheetId: string, planned: Plan | Promise<Plan>, actor: () => AuditActor | null, write: () => Promise<T>): Promise<T> {
  let plan: Plan = { edits: [], deletes: [] };
  let before: Awaited<ReturnType<typeof readRows>> | null = null;
  try {
    plan = await planned;
    if (plan.edits.length || plan.deletes.length) before = await readRows(client, spreadsheetId, [...plan.edits, ...plan.deletes]);
  } catch (error) { console.error("Audit log: could not read rows before the write.", error); }

  const result = await write();
  if (!before) return result;

  try {
    const after = plan.edits.length && !plan.deletes.length ? await readRows(client, spreadsheetId, plan.edits) : null;
    const who = actor() ?? { userId: "system", employeeId: "", name: "System" };
    const now = new Date();
    const entries: Array<[AuditAction, RowKey, AuditChanges, string]> = [];
    for (const target of plan.deletes) {
      const row = before.rows.get(key(target)) ?? [];
      if (!row.some((cell) => cell.trim())) continue; // nothing was there
      const headers = before.headers.get(target.title) ?? [];
      entries.push(["Deleted", target, { headers, row: row.map((cell, index) => (hidden(headers[index] ?? "") && cell ? "(hidden)" : cell)) }, row[0] ?? ""]);
    }
    for (const target of after ? plan.edits : []) {
      const was = before.rows.get(key(target)) ?? [], now_ = after!.rows.get(key(target)) ?? [];
      const changes = diffRow(before.headers.get(target.title) ?? [], was, now_);
      if (Object.keys(changes).length) entries.push(["Edited", target, { changes }, now_[0] || was[0] || ""]);
    }
    if (!entries.length) return result;
    await ensureAuditSheet(client, spreadsheetId);
    await client.spreadsheets.values.append({
      spreadsheetId, range: `${quoted(AUDIT_SHEET)}!A:J`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: entries.map(([action, target, changes, recordId]) => [auditId(now), now.toISOString(), action, target.title, recordId, target.row, serialize(changes), who.userId, who.employeeId, who.name]) },
    });
  } catch (error) { console.error("Audit log: the write succeeded but could not be logged.", error); }
  return result;
}

export function resetAuditSheetCache() { ensured = undefined; }
