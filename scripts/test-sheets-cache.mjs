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

test('an expired copy is served at once and refreshed in the background; a save still clears it', async () => {
  let now = 0, version = 1;
  const cache = new SheetsReadCache(60, () => now);
  const load = async () => ({ version });
  assert.equal((await cache.read('collections', load, false, ['Collections'])).version, 1);
  version = 2; now = 61;
  assert.equal((await cache.read('collections', load, false, ['Collections'])).version, 1, 'stale copy, no waiting');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await cache.read('collections', load, false, ['Collections'])).version, 2, 'refreshed in the background');
  version = 3; cache.invalidate(['Collections']);
  assert.equal((await cache.read('collections', load, false, ['Collections'])).version, 3, 'a save is never served stale');
  const many = await cache.readMany([{ key: 'collections', tags: ['Collections'] }], async () => [{ version }]);
  assert.equal(many[0].version, 3);
  version = 4; now = 200;
  assert.equal((await cache.readMany([{ key: 'collections', tags: ['Collections'] }], async () => [{ version }]))[0].version, 3, 'batch reads serve stale too');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await cache.readMany([{ key: 'collections', tags: ['Collections'] }], async () => [{ version }]))[0].version, 4);
});

test('after a save, recently read ranges of the written sheets are reloaded in the background', async () => {
  let version = 1, calls = 0;
  const cache = new SheetsReadCache(60, () => 0);
  const load = async () => { calls++; return { version }; };
  await cache.read('collections', load, false, ['Collections']);
  await cache.read('programs', async () => ({ version: 'p' }), false, ['Programs']);
  version = 2;
  cache.invalidate(['collections'], { warm: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, 'the cleared range was fetched again without anyone asking');
  assert.equal((await cache.read('collections', load, false, ['Collections'])).version, 2);
  assert.equal(calls, 2, 'and the next page uses the warmed copy');
  cache.invalidate(['Collections']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, 'a clear before writing does not warm');
});
