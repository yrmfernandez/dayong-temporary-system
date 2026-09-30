import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyedLock, SheetsReadCache } from '../lib/sheets-read-cache.ts';

test('a save only clears the sheets it touched', async () => {
  const cache = new SheetsReadCache();
  let calls = 0;
  const load = (value) => async () => { calls++; return value; };
  await cache.read('programs', load('p'), false, ['Programs']);
  await cache.read('sales', load('s'), false, ['Sales']);
  cache.invalidate(['sales']);
  assert.equal(await cache.read('programs', load('wrong'), false, ['Programs']), 'p');
  assert.equal(await cache.read('sales', load('s2'), false, ['Sales']), 's2');
  assert.equal(calls, 3);
});

test('multi-range reads fetch only missing ranges, together, and share them', async () => {
  const cache = new SheetsReadCache();
  const requested = [];
  const fetchMany = (ranges) => async (missing) => { requested.push(missing.map((index) => ranges[index])); return missing.map((index) => ranges[index].toUpperCase()); };
  const items = (ranges) => ranges.map((range) => ({ key: range, tags: [range] }));
  assert.deepEqual(await cache.readMany(items(['a', 'b']), fetchMany(['a', 'b'])), ['A', 'B']);
  assert.deepEqual(await cache.readMany(items(['b', 'c']), fetchMany(['b', 'c'])), ['B', 'C']);
  assert.deepEqual(requested, [['a', 'b'], ['c']]);
});

test('a failed refresh serves the last good copy instead of an error', async () => {
  let now = 0;
  const cache = new SheetsReadCache(60, () => now, { staleFor: 1000 });
  await cache.read('k', async () => 'good');
  now = 100;
  assert.equal(await cache.read('k', async () => { throw new Error('offline'); }), 'good');
  now = 5000;
  await assert.rejects(cache.read('k', async () => { throw new Error('offline'); }), /offline/);
});

test('the write lock runs work for one key strictly in order, and survives failures', async () => {
  const lock = new KeyedLock(), order = [];
  const slow = (name, ms, fail = false) => () => new Promise((resolve, reject) => setTimeout(() => { order.push(name); if (fail) reject(new Error(name)); else resolve(name); }, ms));
  const results = await Promise.allSettled([lock.run('sales', slow('first', 30, true)), lock.run('sales', slow('second', 1)), lock.run('other', slow('parallel', 5))]);
  assert.deepEqual(order, ['parallel', 'first', 'second']);
  assert.equal(results[1].value, 'second');
});

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
