import test from 'node:test';
import assert from 'node:assert/strict';

import { selectBatchRows, summariseBatch, batchCode } from './closingBatch.js';

const INDEX = [
  { id: 'c1', seq: 1, batchId: 'sep', dateMs: 300, amount: 300, status: 'active', name: 'क' },
  { id: 'c2', seq: 2, batchId: 'sep', dateMs: 100, amount: 300, status: 'active', name: 'ख' },
  { id: 'c3', seq: 3, batchId: 'oct', dateMs: 200, amount: 300, status: 'active', name: 'ग' },
  { id: 'c4', seq: 4, batchId: 'sep', dateMs: 200, amount: 500, status: 'reverted', name: 'घ' },
  { id: 'c5', seq: 5, batchId: null, dateMs: 250, amount: 300, status: 'active', name: 'ङ' },
];

test('a batch holds only its own closings', () => {
  const rows = selectBatchRows(INDEX, 'sep');
  assert.deepEqual(rows.map((r) => r.id), ['c2', 'c1']);
});

test('a reverted closing is off the notice', () => {
  // The sheet is a bill. A bill that lists something nobody owes gets paid by
  // somebody, and then has to be refunded.
  const rows = selectBatchRows(INDEX, 'sep');
  assert.ok(!rows.some((r) => r.id === 'c4'));
});

test('closings are listed oldest first, by date and then by seq', () => {
  const rows = selectBatchRows(
    [
      { id: 'b', seq: 9, batchId: 'x', dateMs: 500, amount: 1, status: 'active' },
      { id: 'a', seq: 8, batchId: 'x', dateMs: 500, amount: 1, status: 'active' },
      { id: 'c', seq: 1, batchId: 'x', dateMs: 100, amount: 1, status: 'active' },
    ],
    'x',
  );
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b']);
});

test('a closing with no batch appears on no notice', () => {
  assert.equal(selectBatchRows(INDEX, null).length, 0);
  assert.equal(selectBatchRows(INDEX, undefined).length, 0);
});

test('the per-member total is the SUM of the rates, not count × one rate', () => {
  // Closings in one batch can carry different rates — an override on one, or a
  // trust that changed its rate mid-month. Multiplying by "the" rate would be
  // right almost always, and wrong exactly when somebody had been told a
  // different number.
  const rows = [
    { id: 'a', seq: 1, batchId: 'x', dateMs: 1, amount: 300, status: 'active' },
    { id: 'b', seq: 2, batchId: 'x', dateMs: 2, amount: 500, status: 'active' },
    { id: 'c', seq: 3, batchId: 'x', dateMs: 3, amount: 300, status: 'active' },
  ];
  const { count, perMemberAmount } = summariseBatch(rows);
  assert.equal(count, 3);
  assert.equal(perMemberAmount, 1100);
});

test('summarising an empty batch is zero, not NaN', () => {
  const { count, perMemberAmount, firstDateMs, lastDateMs } = summariseBatch([]);
  assert.equal(count, 0);
  assert.equal(perMemberAmount, 0);
  assert.equal(firstDateMs, null);
  assert.equal(lastDateMs, null);
});

test('a closing with no amount does not poison the total', () => {
  const { perMemberAmount } = summariseBatch([
    { id: 'a', amount: 300 },
    { id: 'b' },
    { id: 'c', amount: undefined },
  ]);
  assert.equal(perMemberAmount, 300);
});

test('the date range spans the batch', () => {
  const { firstDateMs, lastDateMs } = summariseBatch(selectBatchRows(INDEX, 'sep'));
  assert.equal(firstDateMs, 100);
  assert.equal(lastDateMs, 300);
});

test('the receipt code is readable over a telephone', () => {
  assert.equal(batchCode('September 2026'), 'SEPTEM');
  assert.equal(batchCode('SEP26'), 'SEP26');
  // A Devanagari name has no Latin letters to take; the digits in it are the
  // next best thing, because a receipt number gets read aloud.
  assert.equal(batchCode('सितंबर 2026'), '2026');
  // Nothing usable at all — still a code, because the receipt number is built
  // from it and must not come out as `--2026-000123`.
  assert.equal(batchCode('—'), 'GRP');
  assert.equal(batchCode(''), 'GRP');
  assert.equal(batchCode(null), 'GRP');
});
