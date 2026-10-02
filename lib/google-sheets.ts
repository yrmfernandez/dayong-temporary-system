import { AsyncLocalStorage } from "node:async_hooks";
import { google, type sheets_v4 } from "googleapis";
import { KeyedLock, SheetsReadCache } from "@/lib/sheets-read-cache";
import { AUDIT_SHEET, auditedWrite, planBatchUpdate, planValuesBatchUpdate, planValuesUpdate } from "@/lib/audit-log";
import { currentEncoder, isEncodingRequest } from "@/lib/encoder-context";
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
const shared = globalThis as typeof globalThis & { dayongSheetsCacheV2?: SheetsReadCache; dayongWriteLockV1?: KeyedLock; dayongSheetsStats?: SheetsStats };
const cache = shared.dayongSheetsCacheV2 ??= new SheetsReadCache();
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
  const clear = (warm: boolean) => cache.invalidate(tags ? [...tags, AUDIT_SHEET] : undefined, { warm });
  clear(false);
  // Once written, reload the touched sheets that pages were using, so the next page does not wait for Google.
  try { return await operation(); } finally { clear(true); }
}
// Edits and deletes are recorded in the Audit Log sheet (lib/audit-log.ts); appends are creations and are not.
const actor = () => currentEncoder();
function audited<T>(spreadsheetId: string | null | undefined, tags: string[] | undefined, plan: Parameters<typeof auditedWrite>[2], operation: () => Promise<T>) {
  return write(tags, () => auditedWrite(getClient(), spreadsheetId ?? GOOGLE_SHEET_ID, plan, actor, () => withRetry(operation, "write")));
}

type ValueRange = sheets_v4.Schema$ValueRange;
/** Cached per range: two pages that both need Programs share one copy, and a batch only fetches what is missing. */
async function readRanges(params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget): Promise<ValueRange[]> {
  const ranges = params.ranges ?? [];
  const options = [params.spreadsheetId, params.valueRenderOption ?? "", params.dateTimeRenderOption ?? "", params.majorDimension ?? ""];
  const items = ranges.map((range) => ({ key: JSON.stringify(["range", ...options, range]), tags: [sheetOfRange(range)] }));
  return cache.readMany<ValueRange>(items, async (missing) => {
    const response = await withRetry(() => getClient().spreadsheets.values.batchGet({ ...params, ranges: missing.map((index) => ranges[index]) }, { retry: false }), "read");
    return response.data.valueRanges ?? [];
  }, fresh());
}

export const sheets = {
  spreadsheets: {
    get: async (params: sheets_v4.Params$Resource$Spreadsheets$Get) => ({ data: await cache.read(JSON.stringify(["metadata", params]), async () => (await withRetry(() => getClient().spreadsheets.get(params, { retry: false }), "read")).data, isEncodingRequest(), ["__metadata"]) }),
    batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => audited(params.spreadsheetId, undefined, planBatchUpdate(getClient(), params), () => getClient().spreadsheets.batchUpdate(params)),
    values: {
      get: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => {
        const [data] = await readRanges({ spreadsheetId: params.spreadsheetId, ranges: [params.range ?? ""], valueRenderOption: params.valueRenderOption, dateTimeRenderOption: params.dateTimeRenderOption, majorDimension: params.majorDimension });
        return { data: data ?? { range: params.range, values: [] } };
      },
      batchGet: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget) => ({ data: { spreadsheetId: params.spreadsheetId, valueRanges: await readRanges(params) } }),
      append: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) => write(writtenSheets(params), () => withRetry(() => getClient().spreadsheets.values.append(params), "write")),
      update: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => audited(params.spreadsheetId, writtenSheets(params), planValuesUpdate(params), () => getClient().spreadsheets.values.update(params)),
      batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => audited(params.spreadsheetId, writtenSheets(params), planValuesBatchUpdate(params), () => getClient().spreadsheets.values.batchUpdate(params)),
    },
  },
};
