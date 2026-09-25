import type { sheets_v4 } from "googleapis";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { encoderValues, getEncoder } from "@/lib/encoder-context";
import { columnName, getEncoderSheet, quotedSheet, trackingHeaders } from "@/lib/encoder-schema";

async function verifyTrackingHeaders(range: string) {
  const schema = getEncoderSheet(range);
  const expected = trackingHeaders(schema.title);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${quotedSheet(schema.title)}!${columnName(schema.columns + 1)}1:${columnName(schema.columns + expected.length)}1`,
  });
  const actual = response.data.values?.[0] ?? [];
  if (expected.some((header, index) => actual[index] !== header)) {
    throw new Error(`Encoder headers are missing or changed in ${schema.title}. Run the encoder tracking migration before saving.`);
  }
  return schema;
}

export async function appendEncodedRows(params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) {
  const identity = encoderValues();
  const schema = await verifyTrackingHeaders(params.range ?? "");
  const values = (params.requestBody?.values ?? []).map((row: unknown[]) => {
    if (row.length !== schema.columns) {
      throw new Error(`Unexpected business column count for ${schema.title}.`);
    }
    return [...row, ...identity];
  });
  return sheets.spreadsheets.values.append({
    ...params,
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${quotedSheet(schema.title)}!A:${columnName(schema.columns + 4)}`,
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
