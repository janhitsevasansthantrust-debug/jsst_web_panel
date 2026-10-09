import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  memberTimeline, summariseTimeline, closingsForMembers, totalClosings,
  paymentsBySeq, dueByFor, endOfDay, linkedEntries, phoneKey, maskAadhaar, DAY_MS,
} from './portalMath.js';

// Local (IST) midnight, the way the forms store a date.
const IST = 5.5 * 60 * 60 * 1000;
const d = (y, m, day) => Date.UTC(y, m - 1, day) - IST;

const closings = [
  { seq: 1, id: 'c1', name: 'A', dateMs: d(2025, 1, 10), amount: 200, status: 'active' },
  { seq: 2, id: 'c2', name: 'B', dateMs: d(2025, 2, 10), amount: 200, status: 'active', batchId: 'b1' },
  { seq: 3, id: 'c3', name: 'C', dateMs: d(2025, 3, 10), amount: 200, status: 'active' },
  { seq: 4, id: 'c4', name: 'D', dateMs: d(2025, 4, 10), amount: 200, status: 'reverted' },
  { seq: 5, id: 'c5', name: 'E', dateMs: d(2025, 5, 10), amount: 200, status: 'active' },
];

const member = {
  id: 'm1', status: 'accepted', joinDateMs: d(2025, 1, 1), payAmount: 300,
  paidUpTo: 1, paidSeqs: [3], exemptSeqs: [], partialPaid: { 5: 100 },
};

const receipts = [
  { id: 'r1', receiptNo: 'R-1', paidAtMs: d(2025, 1, 20) + 10 * 3600e3, status: 'completed', items: [{ seq: 1, amount: 300 }] },
  { id: 'r2', receiptNo: 'R-2', paidAtMs: d(2025, 6, 1), status: 'completed', items: [{ seq: 3, amount: 300 }, { seq: 5, amount: 100 }] },
  { id: 'r3', receiptNo: 'R-3', paidAtMs: d(2025, 2, 11), status: 'cancelled', items: [{ seq: 2, amount: 300 }] },
];

test('timeline: every eligible closing, with status, member rate and timing', () => {
  const rows = memberTimeline(member, closings, receipts, { nowMs: d(2025, 7, 1), batchDueMs: { b1: d(2025, 2, 25) } });
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 5]); // reverted 4 skipped
  const [r1, r2, r3, r5] = rows;
  assert.equal(r1.status, 'paid');
  assert.equal(r1.amount, 300);
  assert.equal(r1.timing, 'onTime');
  assert.equal(r1.receiptNo, 'R-1');
  assert.equal(r1.daysTaken, 10);

  // cancelled receipt is not a payment
  assert.equal(r2.status, 'pending');
  assert.equal(r2.remaining, 300);
  assert.equal(r2.overdue, true); // batch said 25 Feb

  assert.equal(r3.status, 'paid');
  assert.equal(r3.timing, 'late'); // 10 Mar + 30 days < 1 Jun
  assert.ok(r3.lateByDays > 40);

  assert.equal(r5.status, 'partial');
  assert.equal(r5.paid, 100);
  assert.equal(r5.remaining, 200);
});

test('summary adds up the timeline', () => {
  const rows = memberTimeline(member, closings, receipts, { nowMs: d(2025, 7, 1) });
  const s = summariseTimeline(rows);
  assert.equal(s.eligibleCount, 4);
  assert.equal(s.eligibleAmount, 1200);
  assert.equal(s.paidCount, 2);
  assert.equal(s.paidAmount, 700); // 300 + 300 + 100 part
  assert.equal(s.pendingCount, 2);
  assert.equal(s.pendingAmount, 500);
  assert.equal(s.onTimeCount, 1);
  assert.equal(s.lateCount, 1);
  assert.equal(s.lateAmount, 300);
});

test('watermark-settled seq without a receipt is paid, timing unknown', () => {
  const rows = memberTimeline({ ...member, paidUpTo: 3, paidSeqs: [] }, closings, [], { nowMs: 0 });
  assert.equal(rows[1].status, 'paid');
  assert.equal(rows[1].timing, 'unknown');
});

test('pending member owes nothing; a closing before joining is not listed', () => {
  assert.deepEqual(memberTimeline({ ...member, status: 'pending' }, closings, []), []);
  const later = memberTimeline({ ...member, joinDateMs: d(2025, 3, 1) }, closings, []);
  assert.deepEqual(later.map((r) => r.seq), [3, 5]);
});

test('reversed receipt line is not a payment date', () => {
  const map = paymentsBySeq([{ id: 'x', paidAtMs: 5, status: 'completed', reversedSeqs: [2], items: [{ seq: 2, amount: 1 }, { seq: 3, amount: 1 }] }]);
  assert.equal(map.has(2), false);
  assert.equal(map.get(3).paidAtMs, 5);
});

test('part payments combine to the date of the last piece', () => {
  const map = paymentsBySeq([
    { id: 'a', receiptNo: 'A', paidAtMs: 10, status: 'completed', items: [{ seq: 1, amount: 100 }] },
    { id: 'b', receiptNo: 'B', paidAtMs: 20, status: 'completed', items: [{ seq: 1, amount: 200 }] },
  ]);
  assert.equal(map.get(1).amount, 300);
  assert.equal(map.get(1).paidAtMs, 20);
  assert.equal(map.get(1).receiptNo, 'B');
});

test('due-by: India end of day, notice date wins', () => {
  const c = { dateMs: d(2025, 1, 10) };
  assert.equal(dueByFor(c, { graceDays: 0 }), d(2025, 1, 10) + DAY_MS - 1);
  assert.equal(dueByFor({ ...c, batchId: 'b' }, { batchDueMs: { b: d(2025, 1, 15) } }), d(2025, 1, 15) + DAY_MS - 1);
  // 10am on the last day is still that day
  assert.ok(d(2025, 1, 10) + 10 * 3600e3 <= endOfDay(d(2025, 1, 10)));
});

test('closingsForMembers counts paid and pending per closing', () => {
  const m2 = { id: 'm2', status: 'accepted', joinDateMs: d(2025, 1, 1), payAmount: 200, paidUpTo: 0 };
  const rows = closingsForMembers([member, m2], closings);
  const c1 = rows.find((r) => r.seq === 1);
  assert.equal(c1.eligibleCount, 2);
  assert.equal(c1.paidCount, 1);
  assert.equal(c1.paidAmount, 300);
  assert.equal(c1.pendingAmount, 200);
  assert.equal(rows.find((r) => r.seq === 4), undefined);
  assert.equal(rows[0].seq, 5); // newest first
  const t = totalClosings(rows);
  assert.equal(t.closings, 4);
  // m1: c2 300 + c5 200 left; m2 owes all four at 200
  assert.equal(t.pendingAmount, 300 + 200 + 4 * 200);
});

test('own closing member is not billed for their own closing', () => {
  const own = { ...member, id: 'self' };
  const rows = memberTimeline(own, [{ seq: 9, id: 'c9', memberId: 'self', dateMs: d(2025, 2, 1), status: 'active' }], []);
  assert.equal(rows.length, 0);
});

test('linked by phone, across formats; short numbers link nobody', () => {
  const entries = [
    { id: 'a', phone: '+91 98765 43210' },
    { id: 'b', phone: '', ph2: '9876543210' },
    { id: 'c', phone: '9000000000' },
    { id: 'self', phone: '9876543210' },
  ];
  assert.deepEqual(linkedEntries({ id: 'self', phone: '98765-43210' }, entries).map((e) => e.id), ['a', 'b', 'self']);
  assert.deepEqual(linkedEntries({ id: 'self', phone: '123' }, entries).map((e) => e.id), ['self']);
  assert.equal(phoneKey('+91 98765 43210'), '9876543210');
});

test('aadhaar is masked', () => {
  assert.equal(maskAadhaar('123412341234'), 'XXXX XXXX 1234');
  assert.equal(maskAadhaar(''), '');
});
