import { google, type sheets_v4 } from "googleapis";
import { SheetsReadCache } from "@/lib/sheets-read-cache";
import { isEncodingRequest } from "@/lib/encoder-context";
import {
  getGooglePrivateKey,
  getGoogleSheetId,
  readServerVariable,
  ServerConfigurationError,
} from "@/lib/server-environment";

export const GOOGLE_SHEET_ID = (() => {
  const value = readServerVariable("GOOGLE_SHEET_ID");
  return value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? value;
})();

let client: sheets_v4.Sheets | undefined;

function getClient() {
  if (client) return client;

  const serviceAccountEmail = readServerVariable(
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  );
  if (!serviceAccountEmail) {
    throw new ServerConfigurationError([
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    ]);
  }

  // Prevent an empty spreadsheet ID from reaching the Google API.
  getGoogleSheetId();

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccountEmail,
      private_key: getGooglePrivateKey(),
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  client = google.sheets({
    version: "v4",
    auth,
  });
  return client;
}

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
    get: async (params: sheets_v4.Params$Resource$Spreadsheets$Get) => ({ data: await cache.read(JSON.stringify(["metadata", params]), async () => (await getClient().spreadsheets.get(params, { retry: false })).data, isEncodingRequest()) }),
    batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => write(() => getClient().spreadsheets.batchUpdate(params)),
    values: {
      get: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => ({ data: await cache.read(JSON.stringify(["get", params]), async () => (await getClient().spreadsheets.values.get(params, { retry: false })).data, fresh([params.range ?? ""])) }),
      batchGet: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget) => ({ data: await cache.read(JSON.stringify(["batchGet", params]), async () => (await getClient().spreadsheets.values.batchGet(params, { retry: false })).data, fresh(params.ranges ?? [])) }),
      append: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) => write(() => getClient().spreadsheets.values.append(params)),
      update: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => write(() => getClient().spreadsheets.values.update(params)),
      batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => write(() => getClient().spreadsheets.values.batchUpdate(params)),
    },
  },
};
