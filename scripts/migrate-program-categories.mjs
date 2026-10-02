// Program categories and branch-specific incentives.
//   npm run sheets:program-categories              dry run
//   npm run sheets:program-categories -- --apply   apply
// Additive only:
//   - Programs!S1 = category_id (blank on existing programs until an admin assigns one)
//   - Program Incentives!M1 = branch_id, after the encoder columns I:L (blank = the program's base tiers for every branch)
//   - a "Program Categories" sheet seeded with Pay the Balance, Funeral Services and Cash Assistance (editable in the app)
import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID.");
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const canonical = (value) => String(value ?? "").trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();

const CATEGORY_SHEET = "Program Categories";
const CATEGORY_HEADERS = ["category_id", "category_name", "status", "description", "encoded_by_user_id", "encoded_by_employee_id", "encoded_by_name", "encoded_at"];
const SEED = [["CAT-PAY-THE-BALANCE", "Pay the Balance"], ["CAT-FUNERAL-SERVICES", "Funeral Services"], ["CAT-CASH-ASSISTANCE", "Cash Assistance"]];

const [programHeader, incentiveHeader, metadata] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId, range: "Programs!1:1" }).then((r) => r.data.values?.[0] ?? []),
  sheets.spreadsheets.values.get({ spreadsheetId, range: "'Program Incentives'!1:1" }).then((r) => r.data.values?.[0] ?? []),
  sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }),
]);
const plan = [];
if (canonical(programHeader[17]) !== "new_sale_incentive_amount") throw new Error(`Programs R1 is "${programHeader[17] ?? ""}", expected new_sale_incentive_amount. Run the sale incentive migration first.`);
if (canonical(programHeader[18]) !== "category_id") {
  if (String(programHeader[18] ?? "").trim()) throw new Error(`Programs S1 already holds "${programHeader[18]}".`);
  plan.push({ label: "Programs!S1 = category_id", range: "Programs!S1", values: [["category_id"]] });
}
if (canonical(incentiveHeader[7]) !== "incentive_amount" || canonical(incentiveHeader[11]) !== "encoded_at") throw new Error("Program Incentives A:L are not incentive_id … incentive_amount followed by the four encoder columns.");
if (canonical(incentiveHeader[12]) !== "branch_id") {
  if (String(incentiveHeader[12] ?? "").trim()) throw new Error(`Program Incentives M1 already holds "${incentiveHeader[12]}".`);
  plan.push({ label: "Program Incentives!M1 = branch_id", range: "'Program Incentives'!M1", values: [["branch_id"]] });
}
const categorySheet = metadata.data.sheets.find((sheet) => sheet.properties.title === CATEGORY_SHEET);
if (!categorySheet) plan.push({ label: `Create "${CATEGORY_SHEET}" with ${SEED.map(([, name]) => name).join(", ")}`, create: true });

if (!plan.length) { console.log("Program categories and branch incentives are already set up."); process.exit(0); }
for (const step of plan) console.log(`- ${step.label}`);
if (!apply) { console.log("Dry run only. Re-run with -- --apply."); process.exit(0); }

for (const step of plan.filter((item) => item.range)) await sheets.spreadsheets.values.update({ spreadsheetId, range: step.range, valueInputOption: "RAW", requestBody: { values: step.values } });
if (plan.some((item) => item.create)) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: CATEGORY_SHEET, gridProperties: { rowCount: 100, columnCount: CATEGORY_HEADERS.length, frozenRowCount: 1 } } } }] } });
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${CATEGORY_SHEET}'!A1`, valueInputOption: "RAW", requestBody: { values: [CATEGORY_HEADERS, ...SEED.map(([id, name]) => [id, name, "active", "", "", "", "Setup", now])] } });
}
console.log("Applied.");
