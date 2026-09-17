import test from 'node:test';
import assert from 'node:assert/strict';

import { eligibleForClosing } from './closingEligibility.js';

const DAY = Date.UTC(2026, 8, 20);

const INDEX = [
  { id: 'a', pid: 'p1', status: 'accepted', joinMs: Date.UTC(2026, 0, 1), pay: 300, ageBand: '23-45' },
  { id: 'b', pid: 'p1', status: 'accepted', joinMs: Date.UTC(2026, 0, 1), pay: 500, ageBand: '46-60' },
  { id: 'c', pid: 'p1', status: 'accepted', joinMs: DAY, pay: 300, ageBand: '23-45' },
  { id: 'late', pid: 'p1', status: 'accepted', joinMs: DAY + 1, pay: 300, ageBand: '23-45' },
  { id: 'closed', pid: 'p1', status: 'closed', joinMs: Date.UTC(2026, 0, 1), pay: 300, ageBand: '23-45' },
  { id: 'blocked', pid: 'p1', status: 'blocked', joinMs: Date.UTC(2026, 0, 1), pay: 300, ageBand: '23-45' },
  { id: 'other', pid: 'p2', status: 'accepted', joinMs: Date.UTC(2026, 0, 1), pay: 900, ageBand: '17-22' },
];

const base = { programId: 'p1', closingDateMs: DAY, exceptMemberId: 'a' };

test('the total is summed from each member’s own rate, not count × one rate', () => {
  // b 500 + c 300 + blocked 300 = 1100 across three members. Multiplying three
  // by "the" rate would give 900 or 1500 — both wrong, and nobody could tell
  // which, because the receipts would add up to neither.
  const { count, amount } = eligibleForClosing(INDEX, base);
  assert.equal(count, 3);
  assert.equal(amount, 1100);
});

test('a member who joined ON the day owes; the day after does not', () => {
  const { byBand } = eligibleForClosing(INDEX, base);
  const ids = eligibleForClosing(INDEX, base);
  assert.equal(ids.count, 3);
  assert.ok(byBand.some((r) => r.band === '23-45'));

  const noLate = eligibleForClosing(
    INDEX.filter((m) => m.id !== 'late'),
    base,
  );
  assert.equal(noLate.count, 3, 'dropping the late joiner changes nothing');
});

test('the member being closed never owes their own closing', () => {
  const withA = eligibleForClosing(INDEX, { ...base, exceptMemberId: null });
  assert.equal(withA.count, 4);
  assert.equal(withA.amount, 1400);
});

test('a closed member has left and owes nothing more', () => {
  const { count } = eligibleForClosing(INDEX, base);
  assert.equal(count, 3, 'the already-closed member is not counted');
});

test('a blocked member still owes — a block is a warning, not an exit', () => {
  const onlyBlocked = eligibleForClosing(
    [{ id: 'x', pid: 'p1', status: 'blocked', joinMs: 1, pay: 250, ageBand: '23-45' }],
    { programId: 'p1', closingDateMs: DAY },
  );
  assert.equal(onlyBlocked.count, 1);
  assert.equal(onlyBlocked.amount, 250);
});

test('another योजना’s members are not billed', () => {
  const { amount } = eligibleForClosing(INDEX, base);
  assert.ok(amount < 900 + 1100, 'p2’s 900 is nowhere in the total');
});

test('bands come back in age order, each with its own subtotal', () => {
  const { byBand } = eligibleForClosing(INDEX, { ...base, exceptMemberId: null });
  assert.deepEqual(byBand.map((r) => r.band), ['23-45', '46-60']);
  assert.equal(byBand[0].count, 3, 'a, c and blocked');
  assert.equal(byBand[0].amount, 900);
  assert.equal(byBand[1].amount, 500);
});

test('a member with no rate falls back rather than counting as zero', () => {
  const { count, amount } = eligibleForClosing(
    [{ id: 'x', pid: 'p1', status: 'accepted', joinMs: 1, pay: 0, ageBand: '' }],
    { programId: 'p1', closingDateMs: DAY },
  );
  assert.equal(count, 1);
  assert.equal(amount, 200, 'LIMITS.DEFAULT_PAY_AMOUNT');
});

test('a member with no joining date is not guessed at', () => {
  const { count } = eligibleForClosing(
    [{ id: 'x', pid: 'p1', status: 'accepted', pay: 300 }],
    { programId: 'p1', closingDateMs: DAY },
  );
  assert.equal(count, 0);
});

test('an empty trust totals to zero and still gives a usable fallback rate', () => {
  const r = eligibleForClosing([], base);
  assert.equal(r.count, 0);
  assert.equal(r.amount, 0);
  assert.equal(r.typicalAmount, 200);
  assert.deepEqual(r.byBand, []);
});

test('the typical rate is the average, because there is no single rate', () => {
  const { typicalAmount } = eligibleForClosing(INDEX, base);
  assert.equal(typicalAmount, Math.round(1100 / 3));
});
