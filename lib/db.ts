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
const shared = globalThis as typeof globalThis & { dayongDb?: Database; dayongTestDb?: Database };

/**
 * The application database. Connects through Supabase's transaction pooler (DATABASE_URL, port 6543), which does not
 * support prepared statements, so they are switched off.
 */
export function getDb(): Database {
  if (shared.dayongTestDb) return shared.dayongTestDb;
  if (!shared.dayongDb) {
    const url = readServerVariable("DATABASE_URL");
    if (!url) throw new ServerConfigurationError(["DATABASE_URL"]);
    const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
    shared.dayongDb = drizzle(client, { schema }) as unknown as Database;
  }
  return shared.dayongDb;
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
  return getDb().transaction(async (tx) => {
    if (actor) await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.employee_id', ${actor.employeeId}, true), set_config('app.user_name', ${actor.name}, true)`);
    return activeTransaction.run(tx, () => work(tx));
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
