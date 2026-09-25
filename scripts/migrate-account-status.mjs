import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const title = "Member programs";
const range = "'Member programs'!S:S";
const header = "Account Status";
const statuses = ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Forfeited"];
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
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }, options);
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
  if (!properties) throw new Error(`Missing sheet ${title}.`);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Member programs'!1:1" }, options);
  const headers = response.data.values?.[0] ?? [];
  const expected = ["Status", "Date Created", "Encoded By User ID", "Encoded By Employee ID", "Encoded By Username", "Encoded At"];
  if (headers[0] !== "Enrollment ID" || expected.some((value, i) => headers[12 + i] !== value)) {
    throw new Error("Member programs layout changed. Review columns before migrating.");
  }
  if (headers[18] && headers[18] !== header) throw new Error("Column S already has a different header.");
  if (headers.some((value, i) => value === header && i !== 18)) throw new Error("Account Status already exists in another column.");
  const width = properties.gridProperties.columnCount;
  if (width >= 19) {
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "FORMULA" }, options);
    const values = (existing.data.values ?? []).slice(1).map((row) => row[0]).filter((value) => value !== undefined && value !== "");
    if (!headers[18] && values.length) throw new Error("Column S has unlabelled data. Nothing was changed.");
    if (values.some((value) => !statuses.includes(value))) throw new Error("Existing Account Status values need review before applying validation.");
  }
  const requests = [];
  if (width < 19) requests.push({ appendDimension: { sheetId: properties.sheetId, dimension: "COLUMNS", length: 19 - width } });
  requests.push({ updateCells: {
    range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 18, endColumnIndex: 19 },
    rows: [{ values: [{ userEnteredValue: { stringValue: header }, note: "Derived payment status per enrollment. New accounts start NS. Collections and MAM status reconciliation update this value; it is not a manual override. Forfeited accounts cannot accept payment." }] }],
    fields: "userEnteredValue,note",
  } });
  requests.push({ setDataValidation: {
    range: { sheetId: properties.sheetId, startRowIndex: 1, startColumnIndex: 18, endColumnIndex: 19 },
    rule: { condition: { type: "ONE_OF_LIST", values: statuses.map((value) => ({ userEnteredValue: value })) }, strict: true, showCustomUi: true },
  } });
  const collections = metadata.data.sheets.find((sheet) => sheet.properties.title === "Collections")?.properties;
  if (!collections) throw new Error("Missing Collections sheet.");
  const collectionHeaders = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Collections!1:1" }, options);
  const ch = collectionHeaders.data.values?.[0] ?? [];
  if (ch[24] !== "Encoded At" || (ch[25] && ch[25] !== "Collected By Role")) throw new Error("Collections layout changed; review column Z.");
  if (collections.gridProperties.columnCount >= 26) {
    const data = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Collections!Z2:Z", valueRenderOption: "FORMULA" }, options);
    const occupied = (data.data.values ?? []).flat().filter((v) => v !== "");
    if ((!ch[25] && occupied.length) || occupied.some((v) => !["MAS", "Collector"].includes(v))) throw new Error("Collections column Z contains conflicting data.");
  } else requests.push({ appendDimension: { sheetId: collections.sheetId, dimension: "COLUMNS", length: 26 - collections.gridProperties.columnCount } });
  requests.push({ updateCells: { range: { sheetId: collections.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 25, endColumnIndex: 26 }, rows: [{ values: [{ userEnteredValue: { stringValue: "Collected By Role" } }] }], fields: "userEnteredValue" } });
  requests.push({ setDataValidation: { range: { sheetId: collections.sheetId, startRowIndex: 1, startColumnIndex: 25, endColumnIndex: 26 }, rule: { condition: { type: "ONE_OF_LIST", values: ["MAS", "Collector"].map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true } } });
  for (const extension of [
    { title: "Collections", offset: 26, headers: ["Remittance Amount", "Remittance Breakdown"] },
    { title: "Remittances", offset: 10, headers: ["Gross Collection", "Total Remittance"] },
  ]) {
    const prop = metadata.data.sheets.find((sheet) => sheet.properties.title === extension.title)?.properties;
    if (!prop) throw new Error(`Missing ${extension.title}.`);
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${extension.title}'!1:1` }, options);
    const existing = response.data.values?.[0] ?? [];
    const column = (index) => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
    for (let i = 0; i < extension.headers.length; i++) {
      const index = extension.offset + i;
      const name = extension.headers[i];
      if (existing[index] && existing[index] !== name) throw new Error(`Conflicting ${extension.title} column ${column(index)}.`);
      if (!existing[index] && index < prop.gridProperties.columnCount) {
        const data = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${extension.title}'!${column(index)}2:${column(index)}`, valueRenderOption: "FORMULA" }, options);
        if ((data.data.values ?? []).flat().some((v) => v !== "")) throw new Error(`Unlabelled data exists in ${extension.title} column ${column(index)}.`);
      }
      requests.push({ updateCells: { range: { sheetId: prop.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: name } }] }], fields: "userEnteredValue" } });
    }
    // Collections may already have a queued expansion to Z above.
    const currentWidth = extension.title === "Collections" ? Math.max(26, prop.gridProperties.columnCount) : prop.gridProperties.columnCount;
    const requiredWidth = extension.offset + extension.headers.length;
    if (requiredWidth > currentWidth) requests.unshift({ appendDimension: { sheetId: prop.sheetId, dimension: "COLUMNS", length: requiredWidth - currentWidth } });
    // Google Sheets can copy validation from the previous edge column when
    // columns are appended (e.g. the MAS/Collector dropdown from Z into AA:AB).
    // These computed amount/JSON columns must not inherit that dropdown.
    requests.push({ setDataValidation: {
      range: { sheetId: prop.sheetId, startRowIndex: 1, startColumnIndex: extension.offset, endColumnIndex: requiredWidth },
    } });
  }
  console.log("Account Status, Collector role, collection remittance snapshots, and batch totals prepared. Existing columns remain in place.");
  if (apply) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, options);
    const verified = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Member programs'!S1" }, options);
    if (verified.data.values?.[0]?.[0] !== header) throw new Error("Header verification failed.");
    console.log("Account Status header and dropdown applied and header verified. No account status values were populated or changed.");
  } else {
    console.log("Dry run passed. Use --apply to add the header and dropdown. No data was changed.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
