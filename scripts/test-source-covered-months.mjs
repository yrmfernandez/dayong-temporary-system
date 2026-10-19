import test from 'node:test';
import assert from 'node:assert/strict';
import { crossYearMonths } from './source-cross-year-months.mjs';
test('explicit previous-year arrears retain chronological months across January', () => {
  assert.deepEqual(crossYearMonths('January, Deccember 2025'), ['2025-12','2026-01']);
  assert.deepEqual(crossYearMonths('December 2025, January 2026'), ['2025-12','2026-01']);
  assert.deepEqual(crossYearMonths('November, December 2025'), ['2025-11','2025-12']);
  assert.deepEqual(crossYearMonths('February'), ['2026-02']);
});
test('ambiguous gaps, unsupported years and unintended next-year coverage are rejected', () => {
  for (const value of ['January, March', 'December 2026, January 2027', 'December, January', 'January 2024', '', 'January 2025, March 2026']) assert.equal(crossYearMonths(value), null, value);
});
test('typed source dates retain their year; bare numeric month labels are not Excel dates', () => {
  assert.deepEqual(crossYearMonths(new Date('2025-12-01T00:00:00Z')), ['2025-12']);
  assert.equal(crossYearMonths(12), null);
  assert.equal(crossYearMonths(new Date('2024-12-01T00:00:00Z')), null);
});
