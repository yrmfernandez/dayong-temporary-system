import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const tracking = ["encoded_by_user_id", "encoded_by_employee_id", "encoded_by_username", "encoded_at"];
const definitions = [
  { title: "Expenses", headers: ["expense_id", "expense_date", "category", "description", "amount", "payee", "paid_by", "branch", "payment_method", "reference_number", "receipt_number", "status", "remarks", "created_at", "voided_at", "voided_by_user_id", "void_reason", ...tracking] },
  { title: "Cash Transactions", headers: ["transaction_id", "transaction_date", "direction", "category", "description", "amount", "branch", "cash_account", "reference_type", "reference_id", "status", "remarks", "created_at", "voided_at", "voided_by_user_id", "void_reason", ...tracking] },
  { title: "Cash Accounts", headers: ["cash_account_id", "account_name", "account_type", "opening_balance", "status", ...tracking] },
  { title: "Vendor Payables", headers: ["payable_id", "invoice_date", "due_date", "vendor", "category", "description", "amount", "amount_paid", "balance", "branch", "status", "reference_number", "remarks", "paid_at", "payment_account", ...tracking] },
  { title: "Commissions", headers: ["commission_id", "employee_id", "employee_name", "period_from", "period_to", "gross_incentive", "fidelity_deduction", "net_commission", "status", "paid_at", "reference_number", "remarks", ...tracking] },
];
try {
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }, { retry: false });
  const existing = new Map((metadata.data.sheets ?? []).map((sheet) => [sheet.properties?.title, sheet.properties]));
  const requests = []; const used = new Set([...existing.values()].map((value) => value.sheetId)); let nextId = 92002026;
  for (const definition of definitions) {
    const property = existing.get(definition.title);
    if (property) {
      const values = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${definition.title}'!1:1` }, { retry: false });
      const headers = values.data.values?.[0] ?? [];
      if (headers.length && definition.headers.some((header, index) => headers[index] !== header)) throw new Error(`${definition.title} headers conflict with the finance schema.`);
      if (!headers.length) requests.push({ updateCells: { range: { sheetId: property.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: definition.headers.length }, rows: [{ values: definition.headers.map((header) => ({ userEnteredValue: { stringValue: header } })) }], fields: "userEnteredValue" } });
      continue;
    }
    while (used.has(nextId)) nextId++;
    const sheetId = nextId++; used.add(sheetId);
    requests.push({ addSheet: { properties: { sheetId, title: definition.title, gridProperties: { rowCount: 2000, columnCount: definition.headers.length, frozenRowCount: 1 } } } });
    requests.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: definition.headers.length }, rows: [{ values: definition.headers.map((header) => ({ userEnteredValue: { stringValue: header } })) }], fields: "userEnteredValue" } });
  }
  console.log(`Finance schema check passed: ${definitions.map((item) => item.title).join(", ")}.`);
  if (!apply) console.log("Dry run only. Use --apply to create missing finance sheets.");
  else {
    if (requests.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, { retry: false });
      console.log("Finance sheets created.");
    } else console.log("Finance sheets already match the schema.");
    const accounts = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Cash Accounts'!A2:E" }, { retry: false });
    if (!(accounts.data.values ?? []).some((row) => String(row[0] ?? "").trim())) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Cash Accounts'!A2:E4",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [
          ["CAC-0001", "Cash on Hand", "Cash on Hand", 0, "active"],
          ["CAC-0002", "Primary Bank", "Bank", 0, "active"],
          ["CAC-0003", "E-wallet", "E-wallet", 0, "active"],
        ] },
      }, { retry: false });
      console.log("Default cash accounts added.");
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
