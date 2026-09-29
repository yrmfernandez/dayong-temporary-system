import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;

/**
 * Deletes whole rows so the rows below move up (no blank gaps). Rows are found by content at delete time, never by a
 * row number read earlier in the request, and removed bottom-up in one batch so each index stays valid. Each deleted
 * row is recorded in the Audit Log. Returns how many rows were removed.
 */
export async function deleteRowsWhere(title: string, match: (row: unknown[], header: unknown[]) => boolean) {
  const [metadata, response] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" }),
    sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${quoted(title)}!A:ZZ` }),
  ]);
  const properties = metadata.data.sheets?.find((sheet) => sheet.properties?.title === title)?.properties;
  if (properties?.sheetId === undefined || properties.sheetId === null) throw new Error(`${title} sheet not found.`);
  const rows = response.data.values ?? [];
  const header = rows[0] ?? [];
  const indexes = rows.map((row, index) => ({ row, index })).slice(1).filter(({ row }) => match(row, header)).map(({ index }) => index).sort((a, b) => b - a);
  if (!indexes.length) return 0;
  const sheetId = properties.sheetId;
  // Google Sheets refuses to delete every row below a frozen header, so keep one empty row in that case.
  const rowCount = properties.gridProperties?.rowCount ?? Number.POSITIVE_INFINITY;
  const frozen = properties.gridProperties?.frozenRowCount ?? 0;
  const keepOne = indexes.length >= rowCount - frozen;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [
    ...(keepOne ? [{ appendDimension: { sheetId, dimension: "ROWS", length: 1 } }] : []),
    ...indexes.map((index) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } })),
  ] } });
  return indexes.length;
}

/** Deletes the rows whose first column (the record ID) equals one of the given IDs. */
export function deleteRowsById(title: string, ids: string[]) {
  const wanted = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return deleteRowsWhere(title, (row) => wanted.has(String(row[0] ?? "").trim()));
}
