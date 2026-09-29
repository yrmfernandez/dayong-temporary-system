// Adds "Collector" to the Roles sheet so it is an ordinary role: offered when registering employees, given sign-in
// accounts automatically, and configurable on the Roles page like any other.
//   npm run sheets:collector-role              dry run
//   npm run sheets:collector-role -- --apply   add the role
// Additive only. Uses the default pages until an administrator sets its page access on the Roles page.
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

const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "Roles!A:L" })).data.values ?? [];
const existing = rows.slice(1).find((row) => String(row[1] ?? "").trim().toLowerCase() === "collector");
if (existing) { console.log(`Roles already has "Collector" (${existing[0]}, ${existing[6] || "active"}). Nothing to do.`); process.exit(0); }
if (rows.slice(1).some((row) => String(row[0] ?? "").trim() === "ROLE-COLLECTOR")) throw new Error("ROLE-COLLECTOR is already used by another role. Nothing changed.");
const now = new Date().toISOString();
const row = ["ROLE-COLLECTOR", "Collector", "Collects payments on a MAS's behalf", false, false, false, "active", "system", "", "Collector role setup", now, ""];
console.log('Add role ROLE-COLLECTOR "Collector" (no extra permissions, default pages).');
if (!apply) { console.log("Dry run only. Re-run with -- --apply to add it."); process.exit(0); }
await sheets.spreadsheets.values.append({ spreadsheetId, range: "Roles!A:L", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [row] } });
console.log("Applied.");
