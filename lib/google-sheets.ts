/**
 * The Google Sheets API, answered entirely by the database (lib/sheets-on-db.ts) since October 9, 2026: every tab the
 * app uses is a table there, and Google Sheets is no longer connected (no Google credentials are needed). Modules
 * written for Sheets ("'Remittances'!B5:C5", append to "Collections!A:AO") keep working through this file; a tab that
 * is not a database table is an error ("No database table for sheet …").
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { sheets_v4 } from "googleapis";
import { KeyedLock, SheetsReadCache } from "@/lib/sheets-read-cache";
import { isEncodingRequest } from "@/lib/encoder-context";
import { sheetsOnDb } from "@/lib/sheets-on-db";

/** Kept for the many callers that pass a spreadsheet ID; the database ignores it. */
export const GOOGLE_SHEET_ID = "database";

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
/** Database request counters of this layer for this server process (shown on the IT dashboard). */
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

/** A dropped database connection is retried for reads; writes are never repeated (they may already have been applied). */
async function withRetry<T>(operation: () => Promise<T>, kind: "read" | "write"): Promise<T> {
  const delays = [400, 1200, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      if (kind === "read") stats.reads++; else stats.writes++;
      return await operation();
    } catch (error) {
      const status = statusOf(error);
      const retryable = kind === "read" && (status >= 500 || networkError(error));
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
  // Once written, reload the touched sheets that pages were using, so the next page does not wait.
  try { return await operation(); } finally { clear(true); }
}
/** Edits and deletes in the database are recorded by its audit trigger. */
type Client = Pick<sheets_v4.Sheets, "spreadsheets">;
const database = sheetsOnDb as unknown as Client;

type ValueRange = sheets_v4.Schema$ValueRange;
/** Cached per range: two pages that both need Programs share one copy, and a batch only fetches what is missing. */
async function readRanges(params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget): Promise<ValueRange[]> {
  const ranges = params.ranges ?? [];
  const options = [params.spreadsheetId, params.valueRenderOption ?? "", params.dateTimeRenderOption ?? "", params.majorDimension ?? ""];
  const items = ranges.map((range) => ({ key: JSON.stringify(["range", ...options, range]), tags: [sheetOfRange(range)] }));
  return cache.readMany<ValueRange>(items, async (missing) => {
    const wanted = missing.map((index) => ranges[index]);
    const response = await withRetry(() => database.spreadsheets.values.batchGet({ ...params, ranges: wanted }, { retry: false }), "read");
    return wanted.map((range, index) => response.data.valueRanges?.[index] ?? { range, values: [] });
  }, fresh());
}

export const sheets = {
  spreadsheets: {
    // Tab list and sheet IDs of the database tabs (sheet IDs are only used with batchUpdate, which goes there too).
    get: async (params: sheets_v4.Params$Resource$Spreadsheets$Get) => ({ data: (await database.spreadsheets.get(params)).data }),
    batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => write(undefined, () => database.spreadsheets.batchUpdate(params)),
    values: {
      get: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => {
        const [data] = await readRanges({ spreadsheetId: params.spreadsheetId, ranges: [params.range ?? ""], valueRenderOption: params.valueRenderOption, dateTimeRenderOption: params.dateTimeRenderOption, majorDimension: params.majorDimension });
        return { data: data ?? { range: params.range, values: [] } };
      },
      batchGet: async (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget) => ({ data: { spreadsheetId: params.spreadsheetId, valueRanges: await readRanges(params) } }),
      append: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Append) => write(writtenSheets(params), () => withRetry(() => database.spreadsheets.values.append(params), "write")),
      update: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => write(writtenSheets(params), () => withRetry(() => database.spreadsheets.values.update(params), "write")),
      batchUpdate: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => write(writtenSheets(params), () => withRetry(() => database.spreadsheets.values.batchUpdate(params), "write")),
    },
  },
};
