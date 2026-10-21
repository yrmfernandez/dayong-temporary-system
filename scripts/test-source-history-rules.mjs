import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedSequence, sourceCoverage, sourceMonths, programKey, receiptKey, sourceDay } from './source-history-rules.mjs';
test('explicit month ranges expand without guessing bare cross-year labels',()=>{
  assert.deepEqual(sourceMonths('April - June'),['2026-04','2026-05','2026-06']);
  assert.deepEqual(sourceMonths('November 2025 to February 2026'),['2025-11','2025-12','2026-01','2026-02']);
  assert.equal(sourceMonths('December - February'),null);
  assert.equal(sourceMonths('April, June'),null);
  assert.equal(sourceCoverage('April - June','2-3'),null);
  assert.deepEqual(sourceCoverage('April - June','2-4'),{monthFrom:'2026-04',monthTo:'2026-06',nopFrom:2,nopTo:4});
});
test('source ranges must name every paid month and NOP', () => {
  assert.deepEqual(sourceCoverage('April, May', '2-3'), { monthFrom: '2026-04', monthTo: '2026-05', nopFrom: 2, nopTo: 3 });
  for (const [m, n] of [['April, May','2'],['April, June','2-3'],['April','2-3'],['April','0'],['April','2/3']]) assert.equal(sourceCoverage(m,n), null);
});
test('source sequence uses program registration rule and preserves prior-year arrears', () => {
  const p = { monthFrom:'2026-04', monthTo:'2026-04', nopFrom:2, nopTo:2 };
  assert.equal(confirmedSequence({doi:'2026-03-31'}, [p]), true);
  assert.equal(confirmedSequence({doi:'2026-03-31',registrationFee:true}, [p]), false);
  assert.equal(confirmedSequence({doi:'2026-03-31',registrationFee:true}, [{...p,nopFrom:1,nopTo:1}]), true);
  const prior = sourceCoverage('December 2025, January 2026', '13-14');
  assert.equal(confirmedSequence({doi:'2024-12-01'}, [prior]), true);
  assert.equal(confirmedSequence({doi:'2026-03-01'}, [p,{monthFrom:'2026-06',monthTo:'2026-06',nopFrom:4,nopTo:4}]), false);
});
test('normalization accepts formatting only, retaining meaningful program distinctions', () => {
  assert.equal(programKey('D-210 HG'), programKey('210 HG'));
  assert.notEqual(programKey('DPB-350'), programKey('D-350'));
  assert.equal(receiptKey('123 A (duplicated)'), receiptKey('123A'));
  assert.equal(sourceDay(new Date('2026-03-31T00:00:00Z')), '2026-03-31');
  assert.equal(sourceDay('2026-02-30'), '');
});
