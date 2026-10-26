import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getSetting, saveSetting } from "@/lib/system-settings";

/**
 * Database and receipt-photo space against the Supabase Pro plan (upgrade #10, October 26, 2026; the owner has Pro).
 * Pro includes 8 GB of database disk and 100 GB of file Storage per project; past them Supabase charges per extra GB
 * instead of stopping the app (the Free plan's 500 MB was a hard limit). SUPABASE_DATABASE_GB / SUPABASE_STORAGE_GB
 * override the allowances if the plan changes. The nightly job records the sizes once a day (capacity_history), so
 * System Health shows the growth of the last 30 days and when the allowance would be reached at that pace.
 */
const GB = 1024 * 1024 * 1024;
const allowance = (name: string, fallback: number) => { const value = Number(process.env[name]); return (Number.isFinite(value) && value > 0 ? value : fallback) * GB; };
export const PLAN_LABEL = "Supabase Pro";
export const databaseAllowance = () => allowance("SUPABASE_DATABASE_GB", 8);
export const storageAllowance = () => allowance("SUPABASE_STORAGE_GB", 100);

const HISTORY_KEY = "capacity_history";
const HISTORY_DAYS = 400;
export type CapacityPoint = { date: string; database: number; storage: number | null };

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];

/** Database size, receipt-photo Storage size (null where there is no Storage schema, e.g. tests) and photos still in the database. */
export async function measureCapacity() {
  const db = getDb();
  const [size, storage, photos] = await Promise.all([
    db.execute(sql`select pg_database_size(current_database())::bigint as bytes`),
    db.execute(sql`select coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint as bytes, count(*)::int as files from storage.objects where bucket_id = 'receipts'`).catch(() => null),
    db.execute(sql`select count(*)::int as photos, coalesce(sum(coalesce(length(photo_data_1), 0) + coalesce(length(photo_data_2), 0) + coalesce(length(photo_data_3), 0) + coalesce(length(photo_data_4), 0)), 0)::bigint as bytes
      from receipt_photos where storage_path is null and coalesce(chunk_count, 0) > 0`),
  ]);
  const stored = storage ? rowsOf<{ bytes: number; files: number }>(storage)[0] : null;
  const inDatabase = rowsOf<{ photos: number; bytes: number }>(photos)[0];
  return {
    database: Number(rowsOf<{ bytes: number }>(size)[0]?.bytes ?? 0),
    storage: stored ? Number(stored.bytes) : null, storageFiles: stored ? Number(stored.files) : null,
    photosInDatabase: { photos: Number(inDatabase?.photos ?? 0), bytes: Number(inDatabase?.bytes ?? 0) },
  };
}

export async function capacityHistory(): Promise<CapacityPoint[]> {
  try {
    const saved = JSON.parse(await getSetting(HISTORY_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((point) => point && typeof point.date === "string" && Number.isFinite(point.database)) : [];
  } catch { return []; }
}

/** Today's sizes (Manila date), replacing an earlier measurement of the same day; keeps about 13 months. */
export async function recordCapacity(today: string) {
  const now = await measureCapacity();
  const history = (await capacityHistory()).filter((point) => point.date !== today);
  history.push({ date: today, database: now.database, storage: now.storage });
  history.sort((a, b) => a.date.localeCompare(b.date));
  await saveSetting(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_DAYS)), "System");
  return now;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Growth per 30 days from the oldest measurement within the last 30 days (at least 7 days back, else unknown), and the
 * months until `allowance` at that pace (null when not growing or unknown).
 */
export function growth(history: CapacityPoint[], current: number, today: string, allowanceBytes: number, pick: (point: CapacityPoint) => number | null = (point) => point.database) {
  const base = history.filter((point) => { const age = days(point.date, today); return age >= 7 && age <= 30 && pick(point) !== null; }).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!base) return { perMonth: null as number | null, since: "", monthsLeft: null as number | null };
  const perMonth = Math.round(((current - (pick(base) ?? 0)) / days(base.date, today)) * 30);
  return { perMonth, since: base.date, monthsLeft: perMonth > 0 ? Math.max(0, Math.round(((allowanceBytes - current) / perMonth) * 10) / 10) : null };
}
