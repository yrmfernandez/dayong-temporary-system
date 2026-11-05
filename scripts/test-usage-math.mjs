// System Health's Supabase Usage panel (owner, November 5, 2026): the sums behind the egress estimate.
import assert from "node:assert/strict";
import { test } from "node:test";
import { billingCycle, cycleUsage, parseMetrics, serverFigures } from "../lib/usage-math.ts";

const GB = 1024 ** 3;
const point = (date, gb, broadcasts = null) => ({ date, networkOut: gb * GB, broadcasts });

test("the billing cycle runs from the 7th to the 6th of the next month", () => {
  assert.deepEqual(billingCycle("2026-11-05", 7), { start: "2026-10-07", end: "2026-11-06", days: 31 });
  assert.deepEqual(billingCycle("2026-11-07", 7), { start: "2026-11-07", end: "2026-12-06", days: 30 });
  assert.equal(billingCycle("2027-01-03", 7).start, "2026-12-07", "a cycle crosses the new year");
});

test("the metrics text gives the server's figures, leaving out the loopback network", () => {
  const samples = parseMetrics([
    "# HELP node_load5 load", 'node_network_transmit_bytes_total{device="ens5"} 7.5e+09', 'node_network_transmit_bytes_total{device="lo"} 9e+09',
    'node_cpu_seconds_total{cpu="0",mode="idle"} 1', 'node_cpu_seconds_total{cpu="1",mode="idle"} 1', "node_load5 0.5",
    "node_memory_MemTotal_bytes 1000", "node_memory_MemAvailable_bytes 250", "pg_stat_database_blks_hit_total 99", "pg_stat_database_blks_read_total 1",
    'node_filesystem_size_bytes{mountpoint="/"} 9000', 'node_filesystem_avail_bytes{mountpoint="/"} 1', 'node_filesystem_size_bytes{mountpoint="/data"} 1000', 'node_filesystem_avail_bytes{mountpoint="/data"} 900',
  ].join("\n"));
  const server = serverFigures(samples);
  assert.equal(server.networkOut, 7.5e9);
  assert.equal(server.cpuPercent, 25, "load shared over two cores");
  assert.equal(server.memoryPercent, 75);
  assert.equal(server.diskPercent, 10, "the database disk, not the larger system disk");
  assert.equal(server.cacheHitPercent, 99);
});

test("figures Supabase does not report stay empty instead of zero", () => {
  const server = serverFigures([]);
  assert.equal(server.networkOut, null);
  assert.equal(server.cpuPercent, null);
  assert.equal(server.diskPercent, null);
});

test("the cycle's traffic is the difference between readings, from the reading on its first day", () => {
  const usage = cycleUsage([point("2026-11-01", 5), point("2026-11-07", 10), point("2026-11-08", 12, 40), point("2026-11-09", 15, 60)], 16 * GB, "2026-11-10", 7, 250 * GB);
  assert.equal(usage.since, "2026-11-07");
  assert.equal(usage.total, 6 * GB, "traffic before the cycle is left out");
  assert.equal(usage.percent, 2.4);
  assert.equal(usage.pace, 60 * GB, "2 GB a day over a 30-day cycle");
  assert.equal(usage.cycleBroadcasts, 100, "the reading on the first day counts the day before");
});

test("a server restart starts the counter again and loses nothing already counted", () => {
  const usage = cycleUsage([point("2026-11-07", 100), point("2026-11-08", 110), point("2026-11-09", 3)], 5 * GB, "2026-11-10", 7, 250 * GB);
  assert.equal(usage.total, 15 * GB, "10 before the restart, 3 up to the reading after it, 2 since");
});

test("the first reading of a cycle already under way is shown as a part of it, without a pace at first", () => {
  const usage = cycleUsage([point("2026-11-09", 50)], 52 * GB, "2026-11-10", 7, 250 * GB);
  assert.equal(usage.since, "2026-11-09");
  assert.equal(usage.total, 2 * GB);
  assert.equal(usage.pace, null);
});

test("no reading yet, or no figure now, shows nothing instead of a wrong number", () => {
  assert.equal(cycleUsage([], 5 * GB, "2026-11-10", 7, 250 * GB).total, null);
  assert.equal(cycleUsage([point("2026-11-09", 1)], null, "2026-11-10", 7, 250 * GB).total, null);
});

test("each night's reading closes the day before it, and a missed night leaves no daily entry", () => {
  const usage = cycleUsage([point("2026-11-08", 1), point("2026-11-09", 3), point("2026-11-11", 9)], 10 * GB, "2026-11-11", 7, 250 * GB);
  assert.deepEqual(usage.daily, [{ date: "2026-11-08", bytes: 2 * GB }]);
  assert.equal(usage.total, 9 * GB, "the missed night's traffic stays in the total");
});
