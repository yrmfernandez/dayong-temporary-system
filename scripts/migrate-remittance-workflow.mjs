import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const options = { timeout: 30000, retry: false };

const collectionHeaders = [
  "remittance_status", "linked_remittance_id", "accountable_employee_id",
  "accountable_name", "accountable_role",
];
const remittanceHeaders = [
  "difference", "accountable_employee_id", "accountable_role", "collection_count",
  "received_by_employee_id", "received_by_name", "decision_by_user_id",
  "decision_by_employee_id", "decision_by_username", "decision_at", "remarks",
  "rejection_reason",
];
const mappingHeaders = [
  "remittance_collection_id", "remittance_id", "collection_id", "amount", "linked_at",
  "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_username", "encoded_at",
];

try {
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }, options);
  const properties = new Map((metadata.data.sheets ?? []).map((sheet) => [sheet.properties?.title, sheet.properties]));
  const collections = properties.get("Collections");
  const remittances = properties.get("Remittances");
  if (!collections || !remittances) throw new Error("Collections and Remittances sheets are required.");

  const current = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["'Collections'!1:1", "'Remittances'!1:1"],
  }, options);
  const collectionsRow = current.data.valueRanges?.[0]?.values?.[0] ?? [];
  const remittancesRow = current.data.valueRanges?.[1]?.values?.[0] ?? [];
  if (collectionsRow[27] !== "remittance_breakdown" || remittancesRow[11] !== "total_remittance") {
    throw new Error("Run the account-status migration before the remittance workflow migration.");
  }

  const requests = [];
  const ensureHeaders = (property, existing, offset, headers) => {
    const width = property.gridProperties?.columnCount ?? 0;
    if (width < offset + headers.length) {
      requests.push({ appendDimension: { sheetId: property.sheetId, dimension: "COLUMNS", length: offset + headers.length - width } });
    }
    for (let index = 0; index < headers.length; index++) {
      const currentHeader = existing[offset + index];
      if (currentHeader && currentHeader !== headers[index]) {
        throw new Error(`Conflicting header in ${property.title} column ${offset + index + 1}.`);
      }
    }
    requests.push({ updateCells: {
      range: { sheetId: property.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: offset, endColumnIndex: offset + headers.length },
      rows: [{ values: headers.map((header) => ({ userEnteredValue: { stringValue: header } })) }],
      fields: "userEnteredValue",
    } });
  };

  ensureHeaders(collections, collectionsRow, 28, collectionHeaders);
  ensureHeaders(remittances, remittancesRow, 12, remittanceHeaders);
  requests.push({ setDataValidation: {
    range: { sheetId: collections.sheetId, startRowIndex: 1, startColumnIndex: 28, endColumnIndex: 29 },
    rule: { condition: { type: "ONE_OF_LIST", values: ["Outstanding", "Pending Remittance Approval", "Remitted"].map((value) => ({ userEnteredValue: value })) }, strict: true, showCustomUi: true },
  } });
  requests.push({ setDataValidation: {
    range: { sheetId: remittances.sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
    rule: { condition: { type: "ONE_OF_LIST", values: ["Draft", "Pending Approval", "Approved", "Discrepancy", "Rejected", "Legacy"].map((value) => ({ userEnteredValue: value })) }, strict: true, showCustomUi: true },
  } });

  let mapping = properties.get("Remittance Collections");
  if (!mapping) {
    const used = new Set([...properties.values()].map((property) => property.sheetId));
    let sheetId = 91002026;
    while (used.has(sheetId)) sheetId++;
    mapping = { sheetId, title: "Remittance Collections", gridProperties: { columnCount: 9 } };
    requests.push({ addSheet: { properties: { sheetId, title: mapping.title, gridProperties: { rowCount: 1000, columnCount: 9, frozenRowCount: 1 } } } });
    requests.push({ updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: mappingHeaders.length },
      rows: [{ values: mappingHeaders.map((header) => ({ userEnteredValue: { stringValue: header } })) }], fields: "userEnteredValue",
    } });
  } else {
    const mappingValues = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Remittance Collections'!1:1" }, options);
    const existing = mappingValues.data.values?.[0] ?? [];
    if (mappingHeaders.some((header, index) => existing[index] !== header)) throw new Error("Remittance Collections headers differ.");
  }

  console.log("Prepare separate remittance workflow: collection accountability fields, approval fields, and the Remittance Collections mapping sheet.");
  if (!apply) {
    console.log("Dry run passed. Use --apply to update headers and create the mapping sheet. Existing transactions are not reclassified.");
  } else {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, options);
    console.log("Remittance workflow schema applied. Existing automatic remittance rows remain historical Legacy/Posted data and do not clear new accountability.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
