import { isEncodingRequest } from "@/lib/encoder-context";

/**
 * Small reads that nearly every page repeats (the employee list, the receipt-photo index, date-remitted reasons) are
 * kept for a few seconds in this server and shared by every reader (November 3, 2026: production's
 * pg_stat_statements showed the employee list read about 12,000 times, a share of the Supabase egress and disk reads).
 * Saves always read fresh (isEncodingRequest), a save in this server clears everything (inTransaction in lib/db.ts),
 * and each reader gets its own copy, so one page changing a result never changes another's.
 */
const store = globalThis as typeof globalThis & { dayongShortCache?: Map<string, { at: number; data: Promise<unknown> }>; dayongTestDb?: unknown };

export async function shortCached<T>(key: string, ms: number, read: () => Promise<T>): Promise<T> {
  // Tests (an in-process database, lib/db.ts) change records directly and read them straight back.
  if (isEncodingRequest() || store.dayongTestDb) return read();
  const cache = store.dayongShortCache ??= new Map();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return structuredClone(await (hit.data as Promise<T>));
  const data = read();
  cache.set(key, { at: Date.now(), data });
  data.catch(() => { if (cache.get(key)?.data === data) cache.delete(key); });
  return structuredClone(await data);
}

export function clearShortCache() {
  store.dayongShortCache?.clear();
}
