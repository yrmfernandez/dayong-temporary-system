import { google, type sheets_v4 } from "googleapis";
import { SheetsReadCache } from "@/lib/sheets-read-cache";
import { isEncodingRequest } from "@/lib/encoder-context";

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

const client = google.sheets({
  version: "v4",
  auth,
});

export const GOOGLE_SHEET_ID = spreadsheetId;

const shared = globalThis as typeof globalThis & { dayongSheetsCache?: SheetsReadCache };
const cache = shared.dayongSheetsCache ??= new SheetsReadCache();
function fresh(ranges: string[]) {
  // Validation in saves and authentication/permission reads must remain current.
  return isEncodingRequest() || ranges.some((range) => /^(?:'?Users'?|'?Roles'?|'?User Roles'?)!/.test(range));
}
async function write<T>(operation: () => Promise<T>) {
  cache.invalidate();
  try { return await operation(); } finally { cache.invalidate(); }
}
export const sheets = {
  spreadsheets: {
    get: async (params: sheets_v4.Params$Resource$Spreadsheets$Get) => ({ data: await cache.read(JSON.stringify(["metadata", params]), async () => (await client.spreadsheets.get(params, { retry: false })).data, isEncodingRequest()) }),
    batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => write(() => client.spreadsheets.batchUpdate(params)),
    values: {
      get: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => ({ data: await cache.read(JSON.stringify(["get", params]), async () => (await client.spreadsheets.values.get(params, { retry: false })).data, fresh([params.range ?? ""])) }),
      batchGet: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget) => ({ data: await cache.read(JSON.stringify(["batchGet", params]), async () => (await client.spreadsheets.values.batchGet(params, { retry: false })).data, fresh(params.ranges ?? [])) }),
      append: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) => write(() => client.spreadsheets.values.append(params)),
      update: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => write(() => client.spreadsheets.values.update(params)),
      batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => write(() => client.spreadsheets.values.batchUpdate(params)),
    },
  },
};
