import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SheetsReadCache } from '../lib/sheets-read-cache.ts';

test('parallel reads coalesce, cached data is isolated, and TTL expires', async () => {
  let now = 0, calls = 0;
  const cache = new SheetsReadCache(60, () => now);
  const load = async () => { calls++; return { values: [1] }; };
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.read('programs', load)));
  assert.equal(calls, 1);
  results[0].values.push(2);
  assert.deepEqual((await cache.read('programs', load)).values, [1]);
  now = 61;
  await cache.read('programs', load);
  assert.equal(calls, 2);
  await cache.read('programs', load, true);
  assert.equal(calls, 3);
});

test('invalidating during a read cannot repopulate the cache with old data', async () => {
  const cache = new SheetsReadCache();
  let resolve;
  const old = cache.read('key', () => new Promise((r) => { resolve = r; }));
  cache.invalidate();
  assert.equal(await cache.read('key', async () => 'new'), 'new');
  resolve('old'); await old;
  assert.equal(await cache.read('key', async () => 'wrong'), 'new');
});

test('quota exhaustion pauses uncached reads without retry storms; cached reads still work', async () => {
  let now = 0, calls = 0;
  const cache = new SheetsReadCache(120_000, () => now);
  await cache.read('good', async () => 'cached');
  const limited = async () => { calls++; throw { response: { status: 429 } }; };
  await assert.rejects(cache.read('bad', limited), /wait one minute/);
  await assert.rejects(cache.read('other', limited), /wait one minute/);
  assert.equal(calls, 1);
  assert.equal(await cache.read('good', async () => 'wrong'), 'cached');
  now = 60_001;
  assert.equal(await cache.read('bad', async () => 'recovered'), 'recovered');
});
