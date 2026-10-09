import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesPayment, summarisePayments, describePaymentFilters } from './paymentReport.js';

/**
 * The receipt register's two halves — the predicate the screen pages by and
 * the totals the printed sheet shows — tested against the same receipt, so a
 * change to either that would make them disagree is caught here rather than at
 * a committee meeting.
 */

const DAY = 86_400_000;

const receipt = (over = {}) => ({
  id: 'r1',
  receiptNo: 'RCPT/2026/00123',
  memberId: 'm1',
  memberSnapshot: {
    name: 'रामकुमार',
    regNo: '1001',
    fatherName: 'श्यामलाल',
    village: 'कोटड़ा',
    phone: '9876543210',
  },
  collectedByAgentId: 'a1',
  collectedByAgentName: 'Lalit kumar',
  paidAtMs: Date.UTC(2026, 8, 15, 6, 30),
  method: 'cash',
  reference: 'UTR 4471',
  note: '',
  itemCount: 2,
  closingAmount: 400,
  joinFeeAmount: 100,
  totalAmount: 500,
  status: 'completed',
  groupCode: 'OCTOBE',
  items: [{ seq: 7, closingDateMs: Date.UTC(2026, 8, 10), batchId: 'b1' }],
  ...over,
});

/* ── matchesPayment ──────────────────────────────────────────────────────── */

test('a receipt with no filter at all belongs in the register', () => {
  assert.equal(matchesPayment(receipt(), {}), true);
  assert.equal(matchesPayment(receipt(), {}, null), true);
});

test('the payment-date window is inclusive at both ends', () => {
  const exact = Date.UTC(2026, 8, 15, 12, 0);
  const day = Date.UTC(2026, 8, 15);
  const r = receipt({ paidAtMs: exact });

  // A window typed as "15th to 15th" must find that day's receipts — a filter
  // that excludes the boundaries it names drops a whole day and looks merely
  // short, not wrong. Both ends are inclusive, and the caller widens the
  // second to the end of its day.
  assert.equal(matchesPayment(r, { paidFromMs: exact }), true, 'lower bound is inclusive');
  assert.equal(matchesPayment(r, { paidToMs: exact }), true, 'upper bound is inclusive');
  assert.equal(matchesPayment(r, { paidFromMs: exact + 1 }), false);
  assert.equal(matchesPayment(r, { paidToMs: exact - 1 }), false);
  assert.equal(matchesPayment(r, { paidFromMs: day, paidToMs: day + DAY - 1 }), true);
  assert.equal(matchesPayment(r, { paidFromMs: day + DAY }), false, 'the 16th onward');
  assert.equal(matchesPayment(r, { paidToMs: day - 1 }), false, 'up to the 14th');
});

test('method and status narrow the set', () => {
  assert.equal(matchesPayment(receipt(), { method: 'upi' }), false);
  assert.equal(matchesPayment(receipt(), { method: 'cash' }), true);
  assert.equal(matchesPayment(receipt(), { status: 'cancelled' }), false);
  assert.equal(matchesPayment(receipt({ status: 'cancelled' }), { status: 'cancelled' }), true);
});

test('search looks at the receipt, the member, the agent and the note', () => {
  assert.equal(matchesPayment(receipt(), { q: 'राम' }), true);
  assert.equal(matchesPayment(receipt(), { q: 'राजू' }), false);
  assert.equal(matchesPayment(receipt(), { q: '00123' }), true);
  assert.equal(matchesPayment(receipt(), { q: 'UTR 4471' }), true);
  assert.equal(matchesPayment(receipt(), { q: 'lalit' }), true);
  assert.equal(matchesPayment(receipt({ memberSnapshot: { name: 'गीता देवी', regNo: '1002' } }), { q: 'राम' }), false);
});

test('a search is trimmed and matched lowercased', () => {
  assert.equal(matchesPayment(receipt(), { q: '  LALIT  ' }), true);
});

test('a closing filter matches on the seq the index decided, not on a date restated', () => {
  const seqs = new Set([7]);

  assert.equal(matchesPayment(receipt(), { closingId: 'c1' }, seqs), true);
  assert.equal(matchesPayment(receipt(), { closingId: 'c1' }, new Set([8])), false);
  assert.equal(matchesPayment(receipt(), { closingId: 'c1' }, null), false);
});

test('a batch filter prefers the batch stamped on the item', () => {
  assert.equal(matchesPayment(receipt(), { batchId: 'b1' }, new Set([999])), true);
  assert.equal(matchesPayment(receipt(), { batchId: 'b2' }, new Set([7])), false);
});

test('the instalment window is a different window from the payment window', () => {
  // Confusing the two is how a register ends up wrong by a month while still
  // looking plausible.
  const inst = Date.UTC(2026, 8, 10); // when the instalment was for
  const paid = Date.UTC(2026, 8, 15); // the day the money was taken

  assert.equal(matchesPayment(receipt(), { fromMs: inst, toMs: inst }), true);
  assert.equal(matchesPayment(receipt(), { fromMs: inst + DAY }), false);
  assert.equal(
    matchesPayment(receipt(), { paidFromMs: paid, paidToMs: paid + DAY - 1 }),
    true,
    'the payment window covers the day the money came in',
  );
  assert.equal(
    matchesPayment(receipt(), { fromMs: paid + DAY }),
    false,
    'the instalment was NOT for the day it was paid',
  );
});

test('one filter failing is enough — they are ANDed, never ORed', () => {
  const f = { method: 'cash', status: 'completed', paidFromMs: 0 };
  assert.equal(matchesPayment(receipt(), f), true);
  assert.equal(matchesPayment(receipt(), { ...f, method: 'upi' }), false);
  assert.equal(matchesPayment(receipt(), { ...f, status: 'cancelled' }), false);
});

/* ── summarisePayments ───────────────────────────────────────────────────── */

test('a cancelled receipt is counted as a row but not as money', () => {
  // It moved and then gave the money back, so including it would inflate the
  // trust's collection by exactly what it no longer has.
  const rows = [receipt(), receipt({ id: 'r2', status: 'cancelled', totalAmount: 300 })];

  const s = summarisePayments(rows);
  assert.equal(s.count, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.collected, 500);
  assert.equal(s.cancelledAmount, 300);
});

test('the split adds up: closing + joining fee IS the collection', () => {
  const rows = [
    receipt(),
    receipt({ id: 'r2', closingAmount: 0, joinFeeAmount: 600, totalAmount: 600 }),
    receipt({ id: 'r3', closingAmount: 250, joinFeeAmount: 0, totalAmount: 250 }),
  ];

  const s = summarisePayments(rows);
  assert.equal(s.closingAmount + s.joinFeeAmount, s.collected);
  assert.equal(s.closingAmount, 650);
  assert.equal(s.joinFeeAmount, 700);
  assert.equal(s.collected, 1350);
});

test('members are counted once each, not once per receipt', () => {
  const rows = [receipt(), receipt({ id: 'r2' }), receipt({ id: 'r3', memberId: 'm2' })];
  assert.equal(summarisePayments(rows).members, 2);
});

test('an empty filter comes back as zeroes rather than as NaN', () => {
  const s = summarisePayments([]);
  assert.deepEqual(s, {
    count: 0,
    completed: 0,
    cancelled: 0,
    collected: 0,
    cancelledAmount: 0,
    closingAmount: 0,
    joinFeeAmount: 0,
    members: 0,
  });
});

test('a cancelled receipt is not counted as a member collected from', () => {
  const s = summarisePayments([receipt({ status: 'cancelled' })]);
  assert.equal(s.members, 0);
  assert.equal(s.collected, 0);
});

/* ── describePaymentFilters ──────────────────────────────────────────────── */

test('a printed sheet says what produced it', () => {
  const line = describePaymentFilters({ method: 'cash', status: 'completed', q: 'राम' }).join(' · ');
  assert.match(line, /cash|नकद/);
  assert.match(line, /जमा/);
  assert.match(line, /राम/);
});

test('an unfiltered sheet says nothing at all rather than inventing a period', () => {
  assert.deepEqual(describePaymentFilters({}), []);
  assert.deepEqual(describePaymentFilters(), []);
});
