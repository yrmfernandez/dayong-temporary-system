// Process-local cache: shared across route bundles and development hot reloads.
export class SheetsReadCache {
  private generation = 0;
  private entries = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;
  private ttl: number;
  private now: () => number;

  constructor(ttl = 60_000, now = () => Date.now()) {
    this.ttl = ttl;
    this.now = now;
  }
  invalidate() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }
  async read<T>(key: string, fetcher: () => Promise<T>, fresh = false): Promise<T> {
    const fetch = async () => {
      if (this.blockedUntil > this.now()) throw new Error("Google Sheets is temporarily busy. Please wait one minute before retrying.");
      try { return await fetcher(); } catch (error) {
        const failure = error as { code?: number; response?: { status?: number } };
        if (failure?.code === 429 || failure?.response?.status === 429) {
          this.blockedUntil = this.now() + 60_000;
          throw new Error("Google Sheets is temporarily busy. Please wait one minute before retrying.");
        }
        throw error;
      }
    };
    if (fresh) return fetch();
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value) as T;
    let request = this.pending.get(key) as Promise<T> | undefined;
    if (!request) {
      const generation = this.generation;
      request = fetch().then((value) => {
        if (generation === this.generation) {
          if (this.entries.size >= 200) this.entries.delete(this.entries.keys().next().value!);
          this.entries.set(key, { value: structuredClone(value), expires: this.now() + this.ttl });
        }
        return value;
      }).finally(() => {
        if (generation === this.generation) this.pending.delete(key);
      });
      this.pending.set(key, request);
    }
    return structuredClone(await request);
  }
}
