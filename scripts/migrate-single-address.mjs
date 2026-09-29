// One complete address per member and claimant.
//   npm run sheets:single-address              dry run
//   npm run sheets:single-address -- --apply   delete the split address columns
// Members loses street..zip_code (N:S) and claimant_street..claimant_zip_code (X:AC); Sales loses the same
// blocks (R:W and AB:AG). The single address / claimant_address columns stay. Refuses to run if a header is
// not what it expects or if any cell in a removed column holds data, so nothing entered is ever dropped.
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

const parts = ["street", "subdivision_village", "barangay", "municipality_city", "province", "zip_code"];
const claimantParts = parts.map((name) => `claimant_${name}`);
// Blocks listed right to left so deleting one never shifts the next.
const plan = {
  Members: { finalHeaders: 22, blocks: [{ start: 23, headers: claimantParts }, { start: 13, headers: parts }] },
  Sales: { finalHeaders: 35, blocks: [{ start: 27, headers: claimantParts }, { start: 17, headers: parts }] },
};
const column = (index) => { let name = ""; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };

const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
const requests = [];
for (const [title, { finalHeaders, blocks }] of Object.entries(plan)) {
  const properties = metadata.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
  if (!properties) throw new Error(`${title} sheet not found.`);
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A:BZ` })).data.values ?? [];
  const header = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  if (header.length === finalHeaders && !header.some((name) => parts.includes(name) || claimantParts.includes(name))) {
    console.log(`${title}: already one address column per person (${finalHeaders} columns).`);
    continue;
  }
  for (const { start, headers } of blocks) {
    const found = header.slice(start, start + headers.length);
    if (headers.some((name, index) => found[index] !== name)) throw new Error(`${title} ${column(start)}1:${column(start + headers.length - 1)}1 is ${JSON.stringify(found)}, expected ${JSON.stringify(headers)}. Nothing changed.`);
    const filled = rows.slice(1).flatMap((row, rowIndex) => headers.map((_, offset) => String(row[start + offset] ?? "").trim() ? `${column(start + offset)}${rowIndex + 2}` : "")).filter(Boolean);
    if (filled.length) throw new Error(`${title} has data in columns being removed (${filled.slice(0, 5).join(", ")}${filled.length > 5 ? ", ..." : ""}). Move it into the address column first. Nothing changed.`);
    requests.push({ deleteDimension: { range: { sheetId: properties.sheetId, dimension: "COLUMNS", startIndex: start, endIndex: start + headers.length } } });
    console.log(`${title}: remove ${column(start)}:${column(start + headers.length - 1)} (${headers.join(", ")}) - empty in all ${rows.length - 1} row(s).`);
  }
}

if (!requests.length) { console.log("Nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run only. Re-run with -- --apply to delete these columns."); process.exit(0); }
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
console.log("Applied.");
