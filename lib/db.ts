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
 */
function connect(maxPipeline: number, max: number): Database {
  const url = readServerVariable("DATABASE_URL");
  if (!url) throw new ServerConfigurationError(["DATABASE_URL"]);
  // idle_timeout closes a connection unused for 20 s. A script that keeps the CPU busy for longer (parsing a large
  // workbook) can have it fire just as a query is sent ("CONNECTION_CLOSED"), so scripts may turn it off (0).
  const idle = Number(process.env.DAYONG_DB_IDLE_TIMEOUT ?? 20);
  const options = { prepare: false, max, max_pipeline: maxPipeline, idle_timeout: Number.isFinite(idle) ? idle : 20, connect_timeout: 10 } as postgres.Options<Record<string, never>>;
  return drizzle(postgres(url, options), { schema }) as unknown as Database;
}

/** The application database for reads and single statements. */
export function getDb(): Database {
  if (shared.dayongTestDb) return shared.dayongTestDb;
  return (shared.dayongDb ??= connect(0, 10));
}

/** The pool transactions run on (see above). */
function transactionDb(): Database {
  if (shared.dayongTestDb) return shared.dayongTestDb;
  return (shared.dayongTxDb ??= connect(1, 5));
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
  return transactionDb().transaction(async (tx) => {
    if (actor) await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.employee_id', ${actor.employeeId}, true), set_config('app.user_name', ${actor.name}, true)`);
    return activeTransaction.run(tx, () => work(tx));
  }).finally(() => {
    // Pages that still read through the Sheets layer (lib/google-sheets.ts) see this save at once.
    (globalThis as { dayongSheetsCacheV3?: { invalidate: () => void } }).dayongSheetsCacheV3?.invalidate();
  });
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
