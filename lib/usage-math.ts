/**
 * The arithmetic behind System Health's Supabase Usage panel, kept free of the database so the tests can run it.
 * lib/supabase-usage.ts does the reading and saving.
 */
export type UsagePoint = { date: string; networkOut: number; broadcasts: number | null };
export type Sample = { name: string; labels: Record<string, string>; value: number };

/** The Prometheus text of Supabase's Metrics endpoint, as name, labels and value. */
export function parseMetrics(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    samples.push({ name: match[1], labels: Object.fromEntries([...(match[2] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((label) => [label[1], label[2]])), value });
  }
  return samples;
}

const percent = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

/** The database server now. A figure Supabase does not report stays null. */
export function serverFigures(samples: Sample[]) {
  const named = (name: string) => samples.filter((sample) => sample.name === name);
  const one = (name: string) => named(name)[0]?.value ?? null;
  const network = named("node_network_transmit_bytes_total").filter((sample) => sample.labels.device !== "lo");
  const cores = new Set(named("node_cpu_seconds_total").map((sample) => sample.labels.cpu)).size;
  const load = one("node_load5"), memoryTotal = one("node_memory_MemTotal_bytes"), memoryFree = one("node_memory_MemAvailable_bytes");
  const hit = one("pg_stat_database_blks_hit_total"), read = one("pg_stat_database_blks_read_total");
  // The database lives on /data; where that is not reported, the largest disk is the one that matters.
  const sizes = named("node_filesystem_size_bytes").sort((a, b) => b.value - a.value);
  const disk = sizes.find((sample) => sample.labels.mountpoint === "/data") ?? sizes[0];
  const diskFree = disk ? named("node_filesystem_avail_bytes").find((sample) => sample.labels.mountpoint === disk.labels.mountpoint)?.value ?? null : null;
  return {
    networkOut: network.length ? network.reduce((sum, sample) => sum + sample.value, 0) : null,
    cpuPercent: load !== null && cores ? percent(load, cores) : null,
    memoryPercent: memoryTotal && memoryFree !== null ? percent(memoryTotal - memoryFree, memoryTotal) : null,
    memoryBytes: memoryTotal,
    diskPercent: disk?.value && diskFree !== null ? percent(disk.value - diskFree, disk.value) : null,
    diskBytes: disk?.value ?? null,
    cacheHitPercent: hit !== null && read !== null && hit + read > 0 ? percent(hit, hit + read) : null,
  };
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const dateOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** The billing cycle holding `today`: from `billingDay` of a month up to the day before it in the next. */
export function billingCycle(today: string, billingDay: number) {
  const [year, month, day] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 - (day < billingDay ? 1 : 0), billingDay));
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, billingDay));
  const start = first.toISOString().slice(0, 10), after = next.toISOString().slice(0, 10);
  return { start, end: dateOf(dayNumber(after) - 1), days: dayNumber(after) - dayNumber(start) };
}

/** Bytes sent between two readings. The counter restarts from zero when the server does, so a drop means a restart. */
const sent = (before: number, after: number) => (after >= before ? after - before : after);

/** At least this many measured days before a pace is shown; a day or two says little about a month. */
const PACE_DAYS = 3;

/**
 * Traffic and broadcasts of the cycle so far, from the nightly readings and the reading now. Each night's reading closes
 * the day before it, so `daily` is dated by the day the traffic happened; a night without a reading leaves its traffic
 * in the total but no daily entry. `since` is the first reading used, later than the cycle's start until a full cycle
 * has been measured. `total` is null until there is a reading to compare with.
 */
export function cycleUsage(history: UsagePoint[], current: number | null, today: string, billingDay: number, allowance: number) {
  const cycle = billingCycle(today, billingDay);
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const earlier = points.filter((point) => point.date <= cycle.start).at(-1);
  const within = points.filter((point) => point.date > cycle.start);
  const readings = earlier ? [earlier, ...within] : within;
  const cycleBroadcasts = within.reduce((sum, point) => sum + (point.broadcasts ?? 0), 0);
  const daily = points.slice(1).flatMap((point, index) => dayNumber(point.date) - dayNumber(points[index].date) === 1 ? [{ date: dateOf(dayNumber(point.date) - 1), bytes: sent(points[index].networkOut, point.networkOut) }] : []).slice(-7);
  if (!readings.length || current === null) return { cycle, since: readings[0]?.date ?? "", total: null as number | null, percent: 0, pace: null as number | null, cycleBroadcasts, daily };
  const values = [...readings.map((point) => point.networkOut), current];
  const total = values.slice(1).reduce((sum, value, index) => sum + sent(values[index], value), 0);
  const measured = dayNumber(today) - dayNumber(readings[0].date);
  return { cycle, since: readings[0].date, total, percent: percent(total, allowance), pace: measured >= PACE_DAYS ? Math.round((total / measured) * cycle.days) : null, cycleBroadcasts, daily };
}
