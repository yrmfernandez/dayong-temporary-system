import type { sheets_v4 } from "googleapis";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { encoderValues, getEncoder } from "@/lib/encoder-context";
import { columnName, getEncoderSheet, quotedSheet, trackingHeaders } from "@/lib/encoder-schema";
import { headerMatches } from "@/lib/sheet-headers";

async function verifyTrackingHeaders(range: string) {
  const schema = getEncoderSheet(range);
  const expected = trackingHeaders(schema.title);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${quotedSheet(schema.title)}!${columnName(schema.columns + 1)}1:${columnName(schema.columns + expected.length)}1`,
  });
  const actual = response.data.values?.[0] ?? [];
  // "... By Username" is the pre-migration name of "... By Name" (npm run sheets:employee-login).
  if (expected.some((header, index) => !headerMatches(actual[index], header) && !headerMatches(actual[index], header.replace(/ Name$/, " Username")))) {
    throw new Error(`Encoder headers are missing or changed in ${schema.title}. Run the encoder tracking migration before saving.`);
  }
  if (schema.title === "Member programs") {
    const statusHeader = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Member programs'!S1" });
    if (!headerMatches(statusHeader.data.values?.[0]?.[0], "Account Status")) throw new Error("Member programs Account Status header is missing.");
  }
  return schema;
}

/**
 * Appends business rows followed by the encoder identity. `trailing` adds per-row values that live after the identity
 * columns (workflow columns added later, e.g. Sales remittance status); every row must have the same number.
 */
export async function appendEncodedRows(params: sheets_v4.Params$Resource$Spreadsheets$Values$Append, trailing?: unknown[][]) {
  const identity = encoderValues();
  const schema = await verifyTrackingHeaders(params.range ?? "");
  const rows = params.requestBody?.values ?? [];
  const extra = schema.title === "Member programs" ? rows.map(() => ["NS"]) : trailing ?? rows.map(() => []);
  if (extra.length !== rows.length || extra.some((values) => values.length !== extra[0].length)) throw new Error(`Unexpected trailing values for ${schema.title}.`);
  const values = rows.map((row: unknown[], index: number) => {
    if (row.length !== schema.columns) {
      throw new Error(`Unexpected business column count for ${schema.title}.`);
    }
    return [...row, ...identity, ...extra[index]];
  });
  return sheets.spreadsheets.values.append({
    ...params,
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${quotedSheet(schema.title)}!A:${columnName(schema.columns + 4 + (extra[0]?.length ?? 0))}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { ...params.requestBody, values },
  });
}

export async function updateEncodedRow(params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) {
  getEncoder();
  const schema = await verifyTrackingHeaders(params.range ?? "");
  if (schema.title !== "Attendance" && schema.title !== "Leave Requests") {
    throw new Error(`Tracking updates are not configured for ${schema.title}.`);
  }
  const rowNumber = /!A(\d+):/.exec(params.range ?? "")?.[1];
  if (!rowNumber || Number(rowNumber) < 2) throw new Error("Invalid data row for tracking update.");
  const rows = params.requestBody?.values;
  if (rows?.length !== 1 || rows[0].length !== schema.columns) {
    throw new Error(`Unexpected business column count for ${schema.title}.`);
  }
  // Update disjoint ranges in one call: original encoder cells are never touched.
  const data = [{ range: params.range, values: rows }];
  if (schema.title === "Attendance") {
    data.push({
      range: `${quotedSheet(schema.title)}!W${rowNumber}:Y${rowNumber}`,
      values: [encoderValues().slice(0, 3)],
    });
  }
  return sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}
