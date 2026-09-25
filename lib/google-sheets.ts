import { google } from "googleapis";

const serviceAccountEmail =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

const privateKey =
  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

const spreadsheetId =
  process.env.GOOGLE_SHEET_ID;

if (!serviceAccountEmail) {
  throw new Error(
    "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL in .env.local",
  );
}

if (!privateKey) {
  throw new Error(
    "Missing GOOGLE_PRIVATE_KEY in .env.local",
  );
}

if (!spreadsheetId) {
  throw new Error(
    "Missing GOOGLE_SHEET_ID in .env.local",
  );
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: serviceAccountEmail,
    private_key: privateKey,
  },
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

export const sheets = google.sheets({
  version: "v4",
  auth,
});

export const GOOGLE_SHEET_ID = spreadsheetId;
