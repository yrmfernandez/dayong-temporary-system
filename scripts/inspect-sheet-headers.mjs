import nextEnv from "@next/env";
import { google } from "googleapis";

nextEnv.loadEnvConfig(process.cwd());
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  clientOptions: { transporterOptions: { timeout: 15000, retry: false } },
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
try {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  }, { timeout: 15000, retry: false });
  const ranges = metadata.data.sheets.map(({ properties }) =>
    `'${properties.title.replace(/'/g, "''")}'!1:1`,
  );
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }, { timeout: 15000, retry: false });
  for (const sheet of response.data.valueRanges ?? []) {
    console.log(JSON.stringify({ range: sheet.range, headers: sheet.values?.[0] ?? [] }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
