import { AsyncLocalStorage } from "node:async_hooks";
import { google, type sheets_v4 } from "googleapis";
import { KeyedLock, SheetsReadCache } from "@/lib/sheets-read-cache";
import { isEncodingRequest } from "@/lib/encoder-context";
import { isDatabaseSheet, sheetsOnDb } from "@/lib/sheets-on-db";
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

// Shared across route bundles and hot reloads. The key is versioned: an object from older code (with other methods)
// that survives a reload must never be reused. Bump it when the cache or lock classes change shape.
const shared = globalThis as typeof globalThis & { dayongSheetsCacheV3?: SheetsReadCache; dayongWriteLockV1?: KeyedLock; dayongSheetsStats?: SheetsStats };
// The tabs live in the database now (lib/sheets-on-db.ts), which is fast, and modules already rewritten for it write
// to it directly. So reads are cached only briefly (10 s, never served stale), mainly to share one read between the
// calls of a single page load.
const cache = shared.dayongSheetsCacheV3 ??= new SheetsReadCache(10_000, () => Date.now(), { staleFor: 0 });
const locks = shared.dayongWriteLockV1 ??= new KeyedLock();
type SheetsStats = { since: string; reads: number; writes: number; retries: number; failures: number; lastFailure: string };
const stats = shared.dayongSheetsStats ??= { since: new Date().toISOString(), reads: 0, writes: 0, retries: 0, failures: 0, lastFailure: "" };
/** Google request counters for this server process (shown on the IT dashboard). */
export const sheetsStats = () => ({ ...stats });

/** Run read-validate-write work one at a time per key in this server, so concurrent saves cannot interleave. */
export const withWriteLock = <T>(key: string, work: () => Promise<T>) => locks.run(key, work);

/** "'Member programs'!A:S" → "Member programs"; "Roles" → "Roles". */
export function sheetOfRange(range: string) {
  const match = /^'((?:[^']|'')+)'|^([^!]+)/.exec(range.trim());
  return (match?.[1] ?? match?.[2] ?? "").replace(/''/g, "'");
}

const freshReads = new AsyncLocalStorage<true>();
/**
 * Reads inside `work` bypass the cache. Sign-in and password checks use this so a changed password or role applies at
 * once on every server. Everything else (Users and Roles included) is cached for 60 seconds: permissions travel in
 * the signed session, and a save clears the sheets it touched straight away.
 */
export const readingFresh = <T>(work: () => Promise<T>) => freshReads.run(true, work);

// Validation inside saves must always see current data.
function fresh() {
  return isEncodingRequest() || freshReads.getStore() === true;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const statusOf = (error: unknown) => { const failure = error as { code?: number | string; response?: { status?: number } }; return Number(failure?.response?.status ?? failure?.code) || 0; };
const networkError = (error: unknown) => ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"].includes(String((error as { code?: unknown })?.code));

/**
 * Google asks clients to back off exponentially on quota (429) and server errors. Reads retry on both. Writes retry only
 * on 429, which Google rejects before applying anything; a 5xx on an append may already have been applied.
 */
async function withRetry<T>(operation: () => Promise<T>, kind: "read" | "write"): Promise<T> {
  const delays = [400, 1200, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      if (kind === "read") stats.reads++; else stats.writes++;
      return await operation();
    } catch (error) {
      const status = statusOf(error);
      const retryable = status === 429 || (kind === "read" && (status >= 500 || networkError(error)));
      if (!retryable || attempt >= delays.length) {
        stats.failures++; stats.lastFailure = `${new Date().toISOString()} · ${status || "network"} · ${error instanceof Error ? error.message.slice(0, 160) : "error"}`;
        throw error;
      }
      stats.retries++;
      await pause(delays[attempt] + Math.random() * 250);
    }
  }
}

function writtenSheets(params: { range?: string | null; requestBody?: object | null }) {
  const data = (params.requestBody as { data?: Array<{ range?: string | null }> | null } | undefined)?.data ?? [];
  return [params.range, ...data.map((item) => item.range)].filter((range): range is string => Boolean(range)).map(sheetOfRange).filter(Boolean);
}
// Only data from the sheets a save touched is dropped, so other users keep their cached reads. Structural changes
// (adding sheets, deleting rows) pass no sheet names and clear everything.
async function write<T>(tags: string[] | undefined, operation: () => Promise<T>) {
  const clear = (warm: boolean) => cache.invalidate(tags ? [...tags, "Audit Log"] : undefined, { warm });
  clear(false);
  // Once written, reload the touched sheets that pages were using, so the next page does not wait for Google.
  try { return await operation(); } finally { clear(true); }
}
/**
 * Which backend holds a tab: the database for every application tab (lib/sheets-on-db.ts), Google Sheets for the rest
 * (the Legacy Pending tabs). Edits and deletes in the database are recorded by its audit trigger.
 */
type Client = Pick<sheets_v4.Sheets, "spreadsheets">;
const clientFor = (range: string | null | undefined): Client => (isDatabaseSheet(sheetOfRange(range ?? "")) ? (sheetsOnDb as unknown as Client) : getClient());

type ValueRange = sheets_v4.Schema$ValueRange;
/** Cached per range: two pages that both need Programs share one copy, and a batch only fetches what is missing. */
async function readRanges(params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget): Promise<ValueRange[]> {
  const ranges = params.ranges ?? [];
  const options = [params.spreadsheetId, params.valueRenderOption ?? "", params.dateTimeRenderOption ?? "", params.majorDimension ?? ""];
  const items = ranges.map((range) => ({ key: JSON.stringify(["range", ...options, range]), tags: [sheetOfRange(range)] }));
  return cache.readMany<ValueRange>(items, async (missing) => {
    // Database and Google ranges are fetched from their own backend and put back in order.
    const wanted = missing.map((index) => ranges[index]);
    const results: ValueRange[] = new Array(wanted.length);
    for (const onDatabase of [true, false]) {
      const positions = wanted.map((range, position) => (isDatabaseSheet(sheetOfRange(range)) === onDatabase ? position : -1)).filter((position) => position >= 0);
      if (!positions.length) continue;
      const client = onDatabase ? (sheetsOnDb as unknown as Client) : getClient();
      const response = await withRetry(() => client.spreadsheets.values.batchGet({ ...params, ranges: positions.map((position) => wanted[position]) }, { retry: false }), "read");
      positions.forEach((position, index) => { results[position] = response.data.valueRanges?.[index] ?? { range: wanted[position], values: [] }; });
    }
    return results;
  }, fresh());
}

export const sheets = {
  spreadsheets: {
    // Tab list and sheet IDs of the database tabs (sheet IDs are only used with batchUpdate, which goes there too).
    get: async (params: sheets_v4.Params$Resource$Spreadsheets$Get) => ({ data: (await (sheetsOnDb as unknown as Client).spreadsheets.get(params)).data }),
    batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => write(undefined, () => (sheetsOnDb as unknown as Client).spreadsheets.batchUpdate(params)),
    values: {
      get: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => {
        const [data] = await readRanges({ spreadsheetId: params.spreadsheetId, ranges: [params.range ?? ""], valueRenderOption: params.valueRenderOption, dateTimeRenderOption: params.dateTimeRenderOption, majorDimension: params.majorDimension });
        return { data: data ?? { range: params.range, values: [] } };
      },
      batchGet: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget) => ({ data: { spreadsheetId: params.spreadsheetId, valueRanges: await readRanges(params) } }),
      append: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) => write(writtenSheets(params), () => withRetry(() => clientFor(params.range).spreadsheets.values.append(params), "write")),
      update: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => write(writtenSheets(params), () => withRetry(() => clientFor(params.range).spreadsheets.values.update(params), "write")),
      batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => write(writtenSheets(params), () => withRetry(() => clientFor(params.requestBody?.data?.[0]?.range).spreadsheets.values.batchUpdate(params), "write")),
    },
  },
};
