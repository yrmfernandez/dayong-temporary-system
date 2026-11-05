import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { manilaToday } from "@/lib/manila-date";
import { shortCached } from "@/lib/short-cache";
import { getSetting, saveSetting } from "@/lib/system-settings";
import { cycleUsage, parseMetrics, serverFigures, type UsagePoint } from "@/lib/usage-math";

/**
 * Supabase usage for System Health (owner, November 5, 2026, after production went over its egress on October 31).
 * Supabase's public API has no billing figures: Egress, Cached Egress, Realtime Messages and Logs Query as billed are
 * only on its Usage page. What can be measured here is shown instead, and labelled so:
 *
 * - Server traffic out, from the project's Metrics endpoint (the service key the app already has). Nearly all egress is
 *   the database sending rows to the app, so this should follow egress, but it also holds what the server sends
 *   elsewhere (backups) and has not been compared with a billed figure yet. The counter is since the server started, so
 *   the nightly job keeps a reading (`usage_history`) and the cycle's traffic is the difference between readings.
 * - Realtime broadcasts sent, from realtime.messages. Supabase keeps those for a few days only, so the nightly job adds
 *   each day's count to the same history.
 * - Rows read per table, from pg_stat_statements: table names and totals, never a query's text.
 *
 * SUPABASE_EGRESS_GB and SUPABASE_BILLING_DAY override the Pro allowance and the day the cycle starts (the 7th).
 */
const GB = 1024 * 1024 * 1024;
const HISTORY_KEY = "usage_history";
const HISTORY_DAYS = 400;
/** The Metrics endpoint answers about 175 KB, so one reading serves every System Health load of the minute. */
const CACHE_MS = 60_000;
const METRICS_TIMEOUT_MS = 5_000;
const READERS = 8;

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const egressAllowance = () => { const value = Number(process.env.SUPABASE_EGRESS_GB); return (Number.isFinite(value) && value > 0 ? value : 250) * GB; };
const billingDay = () => { const value = Number(process.env.SUPABASE_BILLING_DAY); return Number.isInteger(value) && value >= 1 && value <= 28 ? value : 7; };

/** The server's figures, or null where the Metrics endpoint cannot be reached (tests, no key, Supabase having a bad day). */
async function readServer() {
  const url = process.env.SUPABASE_URL?.trim(), key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const response = await fetch(`${url}/customer/v1/privileged/metrics`, { headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString("base64")}` }, signal: AbortSignal.timeout(METRICS_TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) { console.error(`Supabase metrics answered ${response.status}.`); return null; }
    return serverFigures(parseMetrics(await response.text()));
  } catch (error) { console.error("Supabase metrics could not be read.", error); return null; }
}

/** Broadcasts of the last 24 hours (db/migrations/0010_realtime_changes.sql); null where there is no Realtime schema. */
async function broadcastsToday() {
  const result = await getDb().execute(sql`select count(*)::int as sent from realtime.messages where topic = 'db-changes' and inserted_at > now() - interval '24 hours'`).catch(() => null);
  return result ? Number(rowsOf<{ sent: number }>(result)[0]?.sent ?? 0) : null;
}

/** Rows the app has read per table since the statistics were last reset, the best guide to what uses the egress. */
async function biggestReaders() {
  const [reader, info] = await Promise.all([
    getDb().execute(sql`with reads as (
        select substring(query from '(?i)\\mfrom\\s+"?([a-z_0-9]+)"?') as source, calls, rows from extensions.pg_stat_statements
        where userid = (select oid from pg_roles where rolname = current_user))
      select case when source in (select tablename from pg_tables where schemaname = 'public') then source else 'other' end as source, sum(calls)::bigint as calls, sum(rows)::bigint as rows
      from reads group by 1 order by 3 desc`).catch(() => null),
    getDb().execute(sql`select stats_reset from extensions.pg_stat_statements_info`).catch(() => null),
  ]);
  if (!reader) return null;
  const tables = rowsOf<{ source: string; calls: number; rows: number }>(reader).map((row) => ({ table: row.source, calls: Number(row.calls), rows: Number(row.rows) }));
  const rows = tables.reduce((sum, table) => sum + table.rows, 0);
  const reset = info ? rowsOf<{ stats_reset: string | Date | null }>(info)[0]?.stats_reset : null;
  return { since: reset ? new Date(reset).toISOString() : "", rows, tables: tables.slice(0, READERS).map((table) => ({ ...table, share: rows ? Math.round((table.rows / rows) * 1000) / 10 : 0 })) };
}

async function usageHistory(): Promise<UsagePoint[]> {
  try {
    const saved = JSON.parse(await getSetting(HISTORY_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((point) => point && typeof point.date === "string" && Number.isFinite(point.networkOut)) : [];
  } catch { return []; }
}

/**
 * Tonight's reading (Manila date). The first of the day stays: a Run now later that day must not move the line between
 * two days, and its 24-hour broadcast count would overlap the next night's.
 */
export async function recordUsage(today: string) {
  const [server, broadcasts, history] = await Promise.all([readServer(), broadcastsToday(), usageHistory()]);
  if (server?.networkOut == null) return null;
  if (history.some((point) => point.date === today)) return { networkOut: server.networkOut, broadcasts, recorded: false };
  const point: UsagePoint = { date: today, networkOut: server.networkOut, broadcasts };
  await saveSetting(HISTORY_KEY, JSON.stringify([...history, point].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS)), "System");
  return { networkOut: server.networkOut, broadcasts, recorded: true };
}

/** Everything the panel shows. Each part that cannot be read is left out; System Health itself never fails for it. */
export function getUsage() {
  return shortCached("supabase-usage", CACHE_MS, async () => {
    const [server, broadcasts, readers, history] = await Promise.all([readServer(), broadcastsToday(), biggestReaders(), usageHistory()]);
    const limit = egressAllowance();
    return { server, broadcasts, readers, limit, ...cycleUsage(history, server?.networkOut ?? null, manilaToday(), billingDay(), limit) };
  });
}
export type SupabaseUsage = Awaited<ReturnType<typeof getUsage>>;
