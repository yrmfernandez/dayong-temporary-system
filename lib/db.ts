import { AsyncLocalStorage } from "node:async_hooks";

import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { currentEncoder } from "@/lib/encoder-context";
import { readServerVariable, ServerConfigurationError } from "@/lib/server-environment";

export { schema };
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the database or an open transaction; reads accept both. */
export type Queryable = Database | Transaction;

// Shared across route bundles and hot reloads, like the Sheets cache. Tests set dayongTestDb to an in-process PGlite.
const shared = globalThis as typeof globalThis & { dayongDb?: Database; dayongTxDb?: Database; dayongTestDb?: Database };

/**
 * Supabase's transaction pooler (DATABASE_URL, port 6543) does not support prepared statements, so they are off, and it
 * stalls when a second query is sent on a connection before the first has answered (seen October 5, 2026; and on
 * October 10 the Audits page, which builds every clerk's report at once, hung until Vercel cut it off, once even reading
 * one query's reply as another's rows). postgres.js counts only the queries waiting behind the running one, so
 * max_pipeline 1 still sends two; 0 sends one at a time (measured: 30 page loads at once, 3.5 s, none failed).
 * But postgres.js reserves a connection for a transaction from a hook that only runs when pipelining is allowed, so with
 * 0 every transaction failed ("UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1", e.g. saving a program).
 * Hence two pools: reads use max_pipeline 0; transactions (inTransaction) use their own pool with max_pipeline 1,
 * where the reserved connection only carries that one save's queries.
 * max_pipeline is a postgres.js option its TypeScript types do not list.
 * The pools are small (5 for reads, 2 for transactions): every Vercel instance keeps its own, and the pooler allows 200
 * clients in all; with 10 and 5 the Collections page hit "EMAXCONN max client connections reached" (October 31, 2026).
 * A query beyond the pool waits for a free connection; it does not fail. Measured on staging from this PC: 8 page loads
 * and 3 saves at once 1.6 s (0.9 s with 10 and 5); 30 and 10 at once 5 s (3 s), none failed.
 */
function connect(maxPipeline: number, max: number): Database {
  const url = readServerVariable("DATABASE_URL");
  if (!url) throw new ServerConfigurationError(["DATABASE_URL"]);
  // idle_timeout closes an unused connection: after 5 s on Vercel, so an idle instance gives its connections back to the
  // pooler soon, and after 20 s elsewhere. A script that keeps the CPU busy for longer (parsing a large workbook) can have
  // it fire just as a query is sent ("CONNECTION_CLOSED"), so scripts may turn it off (0).
  const fallback = process.env.VERCEL ? 5 : 20;
  const idle = Number(process.env.DAYONG_DB_IDLE_TIMEOUT ?? fallback);
  const options = { prepare: false, max, max_pipeline: maxPipeline, idle_timeout: Number.isFinite(idle) ? idle : fallback, connect_timeout: 10 } as postgres.Options<Record<string, never>>;
  return drizzle(postgres(url, options), { schema }) as unknown as Database;
}

/** The application database for reads and single statements. */
export function getDb(): Database {
  if (shared.dayongTestDb) return shared.dayongTestDb;
  return (shared.dayongDb ??= connect(0, 5));
}

/** The pool transactions run on (see above). */
function transactionDb(): Database {
  if (shared.dayongTestDb) return shared.dayongTestDb;
  return (shared.dayongTxDb ??= connect(1, 2));
}

const activeTransaction = new AsyncLocalStorage<Transaction>();

/** The open transaction of this request when inside inTransaction(), otherwise the database. Data helpers use this. */
export const currentDb = (): Queryable => activeTransaction.getStore() ?? getDb();

/**
 * Runs `work` in one transaction: it all saves or none of it does. Every data helper called inside it joins the same
 * transaction (currentDb), and a nested call simply joins the outer one. The signed-in user of the request is named for
 * the transaction, so the audit trigger records who changed each row.
 */
export function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const open = activeTransaction.getStore();
  if (open) return work(open);
  const actor = currentEncoder();
  const attempt = async (retry: number): Promise<T> => {
    let started = false;
    try {
      return await transactionDb().transaction(async (tx) => {
        started = true;
        if (actor) await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.employee_id', ${actor.employeeId}, true), set_config('app.user_name', ${actor.name}, true)`);
        return activeTransaction.run(tx, () => work(tx));
      });
    } catch (error) {
      // The pooler was full, so the transaction never began and nothing was saved: wait and try again (about 15 s in
      // all; the page says the save is waiting in line) instead of failing the save.
      if (started || !isPoolerFull(error) || retry >= POOLER_RETRY_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, POOLER_RETRY_MS[retry]));
      return attempt(retry + 1);
    }
  };
  return attempt(0).finally(() => {
    // Pages that still read through the Sheets layer (lib/google-sheets.ts) see this save at once.
    (globalThis as { dayongSheetsCacheV3?: { invalidate: () => void } }).dayongSheetsCacheV3?.invalidate();
    // The Members directory kept for 15 s in this server (lib/member-directory-data.ts) is read again after a save.
    (globalThis as { dayongDirectoryCache?: unknown }).dayongDirectoryCache = undefined;
    // So is the remittance ledger kept for 10 s (lib/remittance-workflow.ts).
    (globalThis as { dayongLedgerCache?: unknown }).dayongLedgerCache = undefined;
  });
}

const POOLER_RETRY_MS = [500, 1000, 2000, 3000, 4000, 5000];

/** True when Supabase's pooler refused the connection because every client slot was taken ("EMAXCONN"). */
export function isPoolerFull(error: unknown) {
  const failure = ((error as { cause?: unknown })?.cause ?? error ?? {}) as { message?: string };
  return /EMAXCONN|max client connections/i.test(`${failure.message ?? ""} ${(error as { message?: string })?.message ?? ""}`);
}

/** PostgreSQL's code for a unique-rule violation, e.g. an OR number already used by another posted collection. */
export const UNIQUE_VIOLATION = "23505";
/** True when `error` (or the driver error it wraps) broke a unique rule, optionally a specific one by index name. */
export function isUniqueViolation(error: unknown, indexName?: string) {
  const failure = ((error as { cause?: unknown })?.cause ?? error ?? {}) as { code?: string; constraint_name?: string; constraint?: string };
  return failure.code === UNIQUE_VIOLATION && (!indexName || failure.constraint_name === indexName || failure.constraint === indexName);
}

/** The encoded_by_* and encoded_at columns for a new row: the signed-in user of this save, or blank outside a save. */
export function encodedBy() {
  const actor = currentEncoder();
  return { encoded_by_user_id: actor?.userId ?? null, encoded_by_employee_id: actor?.employeeId ?? null, encoded_by_name: actor?.name ?? null, encoded_at: actor?.encodedAt ?? new Date().toISOString() };
}
