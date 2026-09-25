import nextEnv from "@next/env";
import { google } from "googleapis";
import { encoderSheets, trackingHeaders, quotedSheet, columnName } from "../lib/encoder-schema.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const options = { timeout: 20000, retry: false };

try {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId, fields: "sheets.properties",
  }, options);
  const requests = [];
  for (const schema of encoderSheets) {
    const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === schema.title)?.properties;
    if (!properties) throw new Error(`Missing sheet ${schema.title}.`);
    const headers = trackingHeaders(schema.title);
    const width = properties.gridProperties.columnCount;
    const requiredWidth = schema.columns + headers.length;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${quotedSheet(schema.title)}!1:1`,
    }, options);
    const existing = response.data.values?.[0] ?? [];
    if (existing.slice(0, schema.columns).filter(Boolean).length !== schema.columns) {
      throw new Error(`Business headers are incomplete in ${schema.title}.`);
    }
    // Refuse to label occupied, previously unlabelled columns as encoder data.
    const missing = headers.map((header, i) => ({ header, index: schema.columns + i }))
      .filter(({ header, index }) => {
        if (existing[index] && existing[index] !== header) {
          throw new Error(`Conflicting header in ${schema.title}, column ${columnName(index + 1)}.`);
        }
        return !existing[index];
      });
    const ranges = missing.filter(({ index }) => index < width)
      .map(({ index }) => `${quotedSheet(schema.title)}!${columnName(index + 1)}2:${columnName(index + 1)}`);
    if (ranges.length) {
      const cells = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: "FORMULA" }, options);
      if (cells.data.valueRanges.some((range) => range.values?.some((row) => row.some((value) => value !== "")))) {
        throw new Error(`Unlabelled tracking columns contain data in ${schema.title}; migration stopped.`);
      }
    }
    if (width < requiredWidth) requests.push({ appendDimension: {
      sheetId: properties.sheetId, dimension: "COLUMNS", length: requiredWidth - width,
    } });
    for (const { header, index } of missing) requests.push({ updateCells: {
      range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
      rows: [{ values: [{ userEnteredValue: { stringValue: header } }] }], fields: "userEnteredValue",
    } });
    console.log(`${schema.title}: ${missing.length ? `${missing.length} headers to add` : "already configured"}`);
  }
  if (apply && requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, options);
    console.log("Encoder headers applied. Existing data rows were not changed.");
  } else {
    console.log(apply ? "No changes needed." : "Dry run complete. Use --apply to add headers.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
