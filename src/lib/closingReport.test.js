import test from 'node:test';
import assert from 'node:assert/strict';

import { filterClosingsByDate, summariseClosings, withPending } from './closingReport.js';

const d = (day) => Date.UTC(2026, 8, day); // September 2026

const INDEX = [
  { id: 'a', seq: 1, dateMs: d(3), status: 'active', eligibleAmount: 3000, paidAmount: 3000 },
  { id: 'b', seq: 2, dateMs: d(15), status: 'active', eligibleAmount: 3000, paidAmount: 1200 },
  { id: 'c', seq: 3, dateMs: d(30), status: 'active', eligibleAmount: 3000, paidAmount: 0 },
  { id: 'r', seq: 4, dateMs: d(20), status: 'reverted', eligibleAmount: 3000, paidAmount: 900 },
  { id: 'old', seq: 5, dateMs: Date.UTC(2026, 7, 28), status: 'active', eligibleAmount: 500, paidAmount: 500 },
];

test('both ends of the range are inclusive', () => {
  const rows = filterClosingsByDate(INDEX, { fromMs: d(3), toMs: d(30) });
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b', 'c', 'r']);
});

test('a closing on the last day is not dropped', () => {
  // The failure this guards is silent: a range typed as "1st to 30th" that
  // excluded the 30th looks merely short, not wrong.
  const rows = filterClosingsByDate(INDEX, { fromMs: d(30), toMs: d(30) });
  assert.deepEqual(rows.map((r) => r.id), ['c']);
});

test('an open range is open, not empty', () => {
  assert.equal(filterClosingsByDate(INDEX, {}).length, 5);
  assert.equal(filterClosingsByDate(INDEX, { fromMs: d(16) }).length, 2);
  assert.equal(filterClosingsByDate(INDEX, { toMs: d(3) }).length, 2);
});

test('rows come back newest first', () => {
  const rows = filterClosingsByDate(INDEX, {});
  assert.deepEqual(rows.map((r) => r.id), ['c', 'r', 'b', 'a', 'old']);
});

test('a closing with no date is not guessed at', () => {
  const rows = filterClosingsByDate([{ id: 'x', seq: 9 }], {});
  assert.equal(rows.length, 0);
});

test('reverted closings are counted but owe nothing', () => {
  // Including their expected amount would inflate the trust's outstanding
  // figure by exactly the amount it decided not to collect.
  const rows = filterClosingsByDate(INDEX, { fromMs: d(1), toMs: d(30) });
  const totals = summariseClosings(rows);

  assert.equal(totals.count, 4);
  assert.equal(totals.active, 3);
  assert.equal(totals.reverted, 1);
  assert.equal(totals.expected, 9000, 'three active closings at 3000');
  assert.equal(totals.collected, 4200, 'the reverted closing’s 900 is excluded');
  assert.equal(totals.pending, 4800);
});

test('pending never goes negative when more came in than was billed', () => {
  const totals = summariseClosings([
    { status: 'active', eligibleAmount: 1000, paidAmount: 1400 },
  ]);
  assert.equal(totals.pending, 0);
});

test('an empty period totals to zero, not NaN', () => {
  const totals = summariseClosings([]);
  assert.deepEqual(totals, {
    count: 0, active: 0, reverted: 0, expected: 0, collected: 0, pending: 0,
  });
});

test('per-row pending is blank for a reverted closing, not zero', () => {
  // Zero would read as "fully paid". Blank reads as "does not apply", which is
  // the truth.
  const rows = withPending(INDEX);
  assert.equal(rows.find((r) => r.id === 'r').pendingAmount, null);
  assert.equal(rows.find((r) => r.id === 'b').pendingAmount, 1800);
  assert.equal(rows.find((r) => r.id === 'a').pendingAmount, 0);
});

test('a closing with missing money figures does not poison the totals', () => {
  const totals = summariseClosings([
    { status: 'active' },
    { status: 'active', eligibleAmount: 500, paidAmount: 200 },
  ]);
  assert.equal(totals.expected, 500);
  assert.equal(totals.collected, 200);
  assert.equal(totals.pending, 300);
});
