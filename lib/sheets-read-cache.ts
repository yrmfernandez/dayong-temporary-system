type Entry = { expires: number; staleUntil: number; value: unknown; tags: string[] };
type Snapshot = { generation: number; tags: Map<string, number> };

const BUSY = "Google Sheets is temporarily busy. Please wait one minute before retrying.";

/**
 * Copy of a cached value, so a caller that mutates what it read never changes another request's data. Sheet data is
 * plain arrays and objects of primitives, which this copies several times faster than structuredClone.
 */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) result[key] = copy((value as Record<string, unknown>)[key]);
    return result as T;
  }
  return value;
}
const isQuotaError = (error: unknown) => {
  const failure = error as { code?: number; response?: { status?: number } };
  return failure?.code === 429 || failure?.response?.status === 429;
};

/**
 * Process-local read cache for Google Sheets, shared across route bundles and development hot reloads.
 *
 * - Entries are tagged with the sheets they came from, so a save only clears data from the sheets it wrote.
 * - Parallel reads of the same key share one request.
 * - When Google refuses a read (quota or outage), a recent copy is served instead of failing the page.
 * - Stale-while-revalidate: once a copy is past its TTL (but within the stale window) it is served at once and refreshed
 *   in the background, so a large sheet (Collections is ~20 MB) never makes a page wait for Google after the first load.
 *   A save still deletes the entries of the sheets it wrote, so its own changes are never served stale.
 * - Warm after a save: `invalidate(tags, { warm: true })` reloads the cleared ranges that were read recently in the
 *   background, so the next page after a save does not wait for Google either.
 */
export class SheetsReadCache {
  private generation = 0;
  private tagGenerations = new Map<string, number>();
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  // How to reload each recently read key, for warming it again after a save clears it.
  private reloaders = new Map<string, { fetcher: () => Promise<unknown>; tags: string[]; usedAt: number }>();
  private blockedUntil = 0;
  private ttl: number;
  private staleFor: number;
  private now: () => number;
  private maxEntries: number;

  constructor(ttl = 60_000, now = () => Date.now(), { staleFor = 10 * 60_000, maxEntries = 500 } = {}) {
    this.ttl = ttl;
    this.now = now;
    this.staleFor = staleFor;
    this.maxEntries = maxEntries;
  }

  /**
   * Forget cached data: everything, or only entries from the given sheets. With `warm`, ranges from those sheets that were
   * read within the stale window are reloaded in the background (used after a save has finished writing).
   */
  invalidate(tags?: string[], { warm = false } = {}) {
    if (!tags) {
      this.generation++;
      this.entries.clear();
      this.pending.clear();
      return;
    }
    const names = tags.map((tag) => tag.toLowerCase());
    for (const tag of names) this.tagGenerations.set(tag, (this.tagGenerations.get(tag) ?? 0) + 1);
    for (const [key, entry] of this.entries) if (entry.tags.some((tag) => names.includes(tag))) { this.entries.delete(key); this.pending.delete(key); }
    if (!warm) return;
    const recent = this.now() - this.staleFor;
    for (const [key, reloader] of this.reloaders) {
      if (reloader.usedAt < recent) { this.reloaders.delete(key); continue; }
      if (reloader.tags.some((tag) => names.includes(tag))) void this.start(key, reloader.fetcher, reloader.tags).catch(() => undefined);
    }
  }

  private remember(key: string, fetcher: () => Promise<unknown>, tags: string[]) {
    this.reloaders.set(key, { fetcher, tags: tags.map((tag) => tag.toLowerCase()), usedAt: this.now() });
    if (this.reloaders.size > this.maxEntries) this.reloaders.delete(this.reloaders.keys().next().value!);
  }

  private snapshot(tags: string[]): Snapshot {
    return { generation: this.generation, tags: new Map(tags.map((tag) => [tag, this.tagGenerations.get(tag) ?? 0])) };
  }

  // A read that started before an invalidation must not put its (now old) result back into the cache.
  private current(snapshot: Snapshot) {
    return snapshot.generation === this.generation && [...snapshot.tags].every(([tag, value]) => (this.tagGenerations.get(tag) ?? 0) === value);
  }

  private store(key: string, value: unknown, tags: string[], snapshot: Snapshot) {
    if (!this.current(snapshot)) return;
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    const now = this.now();
    this.entries.set(key, { value: copy(value), expires: now + this.ttl, staleUntil: now + this.ttl + this.staleFor, tags });
  }

  private stale(key: string) {
    const entry = this.entries.get(key);
    return entry && entry.staleUntil > this.now() ? entry : undefined;
  }

  private async guarded<T>(fetcher: () => Promise<T>): Promise<T> {
    if (this.blockedUntil > this.now()) throw new Error(BUSY);
    try { return await fetcher(); } catch (error) {
      if (isQuotaError(error)) {
        this.blockedUntil = this.now() + 60_000;
        throw new Error(BUSY);
      }
      throw error;
    }
  }

  private start<T>(key: string, fetcher: () => Promise<T>, tags: string[]) {
    let request = this.pending.get(key) as Promise<T> | undefined;
    if (!request) {
      const names = tags.map((tag) => tag.toLowerCase()), snapshot = this.snapshot(names);
      request = this.guarded(fetcher).then((value) => { this.store(key, value, names, snapshot); return value; })
        .finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
      this.pending.set(key, request);
    }
    return request;
  }

  async read<T>(key: string, fetcher: () => Promise<T>, fresh = false, tags: string[] = []): Promise<T> {
    if (fresh) return this.guarded(fetcher);
    this.remember(key, fetcher, tags);
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return copy(cached.value) as T;
    // Past its TTL but still recent: serve it now and refresh in the background.
    if (cached && cached.staleUntil > this.now()) {
      void this.start(key, fetcher, tags).catch(() => undefined);
      return copy(cached.value) as T;
    }
    const request = this.start(key, fetcher, tags);
    try { return copy(await request); } catch (error) {
      const stale = this.stale(key);
      if (stale) return copy(stale.value) as T;
      throw error;
    }
  }

  /**
   * Read several keys at once. Cached and in-flight keys are reused; the rest are fetched together in one call,
   * so a page asking for eight sheets costs at most one Google request, and nothing it already shares with others.
   */
  async readMany<T>(items: Array<{ key: string; tags: string[] }>, fetchMany: (missing: number[]) => Promise<T[]>, fresh = false): Promise<T[]> {
    if (fresh) return this.guarded(() => fetchMany(items.map((_, index) => index)));
    items.forEach((item, index) => this.remember(item.key, async () => (await fetchMany([index]))[0], item.tags));
    const results: Array<Promise<T>> = new Array(items.length);
    const missing: number[] = [];
    let needed = 0;
    const servedStale = new Set<number>();
    items.forEach((item, index) => {
      const cached = this.entries.get(item.key);
      if (cached && cached.expires > this.now()) results[index] = Promise.resolve(cached.value as T);
      // Past its TTL but still recent: serve it now; it is refreshed below without the page waiting for it.
      else if (cached && cached.staleUntil > this.now()) { results[index] = Promise.resolve(cached.value as T); servedStale.add(index); if (!this.pending.has(item.key)) missing.push(index); }
      else if (this.pending.has(item.key)) results[index] = this.pending.get(item.key) as Promise<T>;
      else { missing.push(index); needed++; }
    });
    if (missing.length) {
      const snapshots = new Map(missing.map((index) => [index, this.snapshot(items[index].tags.map((tag) => tag.toLowerCase()))]));
      const batch = this.guarded(() => fetchMany(missing));
      missing.forEach((index, position) => {
        const item = items[index], names = item.tags.map((tag) => tag.toLowerCase());
        const request: Promise<T> = batch.then((values) => { this.store(item.key, values[position], names, snapshots.get(index)!); return values[position]; })
          .finally(() => { if (this.pending.get(item.key) === request) this.pending.delete(item.key); });
        this.pending.set(item.key, request);
        if (servedStale.has(index)) void request.catch(() => undefined);
        else results[index] = request;
      });
      // Only background refreshes: keep their failure from surfacing as an unhandled rejection.
      if (!needed) void batch.catch(() => undefined);
    }
    return Promise.all(results.map(async (result, index) => {
      try { return copy(await result); } catch (error) {
        const stale = this.stale(items[index].key);
        if (stale) return copy(stale.value) as T;
        throw error;
      }
    }));
  }
}

/** Serializes async work per key within this server process, e.g. read-validate-write saves on one sheet. */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(work);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
