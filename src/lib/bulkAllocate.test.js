import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateDeposit, allocateExplicit } from './bulkAllocate.js';

/** Three members, two closings each at ₹200 — ₹1,200 owed in total. */
const rows = () => [
  { memberId: 'a', name: 'रामेश्वर', regNo: '001', due: [
    { seq: 1, remaining: 200, dateMs: 10 }, { seq: 2, remaining: 200, dateMs: 20 },
  ] },
  { memberId: 'b', name: 'कमला', regNo: '002', due: [
    { seq: 1, remaining: 200, dateMs: 10 }, { seq: 2, remaining: 200, dateMs: 20 },
  ] },
  { memberId: 'c', name: 'सुरेश', regNo: '003', due: [
    { seq: 1, remaining: 200, dateMs: 10 }, { seq: 2, remaining: 200, dateMs: 20 },
  ] },
];

const sum = (r) => r.lines.reduce((s, l) => s + l.total, 0);

test('member rule: clears whole members, in order', () => {
  const r = allocateDeposit(rows(), 800);
  assert.equal(r.allocated, 800);
  assert.equal(r.leftover, 0);
  // a and b settled completely; c untouched.
  assert.deepEqual(r.lines.map((l) => [l.memberId, l.total]), [['a', 400], ['b', 400]]);
  assert.ok(r.lines.every((l) => l.full));
});

test('member rule: at most one member is left part-paid', () => {
  const r = allocateDeposit(rows(), 500);
  assert.equal(r.allocated, 500);
  assert.deepEqual(r.lines.map((l) => [l.memberId, l.total]), [['a', 400], ['b', 100]]);
  assert.equal(r.lines[0].full, true);
  assert.equal(r.lines[1].partial, true);
  // The part-payment lands on their OLDEST closing, not an arbitrary one.
  assert.deepEqual(r.lines[1].amounts, { 1: 100 });
});

test('oldest rule: everyone’s first closing clears before anyone’s second', () => {
  const r = allocateDeposit(rows(), 600, { rule: 'oldest' });
  assert.equal(r.allocated, 600);
  // 3 × seq 1 (600) exactly — nobody's seq 2 is touched.
  for (const line of r.lines) assert.deepEqual(line.amounts, { 1: 200 });
  assert.equal(r.lines.length, 3);
});

test('oldest rule: part-pays the closing the money runs out on', () => {
  const r = allocateDeposit(rows(), 650, { rule: 'oldest' });
  assert.equal(r.allocated, 650);
  assert.deepEqual(r.lines.find((l) => l.memberId === 'a').amounts, { 1: 200, 2: 50 });
});

test('never allocates more than is owed; the rest comes back as leftover', () => {
  const r = allocateDeposit(rows(), 20000);
  assert.equal(r.allocated, 1200);
  assert.equal(r.leftover, 18800);
  assert.equal(r.dueTotal, 1200);
});

test('allocated + leftover always equals the deposit', () => {
  for (const amount of [0, 1, 199, 200, 201, 599, 1200, 1201, 20000]) {
    for (const rule of ['member', 'oldest']) {
      const r = allocateDeposit(rows(), amount, { rule });
      assert.equal(
        r.allocated + r.leftover,
        amount,
        `${rule} @ ${amount}: ${r.allocated} + ${r.leftover}`,
      );
      assert.equal(sum(r), r.allocated);
    }
  }
});

test('a member with nothing due is skipped, not given a zero receipt', () => {
  const r = allocateDeposit(
    [{ memberId: 'a', due: [] }, { memberId: 'b', due: [{ seq: 1, remaining: 200 }] }],
    500,
  );
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].memberId, 'b');
  assert.equal(r.skipped, 1);
});

test('a part-paid closing is topped up by its remaining, not its full amount', () => {
  const r = allocateDeposit(
    [{ memberId: 'a', due: [{ seq: 1, remaining: 50 }, { seq: 2, remaining: 200 }] }],
    100,
  );
  assert.deepEqual(r.lines[0].amounts, { 1: 50, 2: 50 });
});

test('zero deposit allocates nothing', () => {
  const r = allocateDeposit(rows(), 0);
  assert.equal(r.lines.length, 0);
  assert.equal(r.allocated, 0);
});

test('no members selected', () => {
  const r = allocateDeposit([], 5000);
  assert.equal(r.allocated, 0);
  assert.equal(r.leftover, 5000);
});

test('odd amounts do not leave floating-point dust', () => {
  const r = allocateDeposit(
    [{ memberId: 'a', due: [{ seq: 1, remaining: 33.33 }, { seq: 2, remaining: 33.33 }] }],
    66.66,
  );
  assert.equal(r.allocated, 66.66);
  assert.equal(r.leftover, 0);
});

/* ── hand-edited preview ─────────────────────────────────────────────────── */

test('explicit: each member takes the amount the operator typed', () => {
  const r = allocateExplicit(rows(), { a: 400, b: 300 });
  assert.equal(r.allocated, 700);
  assert.deepEqual(r.lines.find((l) => l.memberId === 'a').amounts, { 1: 200, 2: 200 });
  assert.deepEqual(r.lines.find((l) => l.memberId === 'b').amounts, { 1: 200, 2: 100 });
  assert.equal(r.lines.find((l) => l.memberId === 'c'), undefined);
});

test('explicit: more than a member owes is refused, not silently taken', () => {
  const r = allocateExplicit(rows(), { a: 1000 });
  assert.equal(r.lines[0].total, 400);
  assert.equal(r.lines[0].refused, 600);
  assert.equal(r.allocated, 400);
});

test('explicit: zero and missing entries are left alone', () => {
  const r = allocateExplicit(rows(), { a: 0 });
  assert.equal(r.lines.length, 0);
  assert.equal(r.allocated, 0);
});

/* ── joining fees in the same deposit ────────────────────────────────────── */

/** Two members: one owes a part-paid fee plus closings, one owes closings. */
const withFees = () => [
  { memberId: 'a', name: 'रामेश्वर', regNo: '001',
    joinFeeDue: 8900, joinDateMs: 1,
    due: [{ seq: 1, remaining: 200, dateMs: 10 }, { seq: 2, remaining: 200, dateMs: 20 }] },
  { memberId: 'b', name: 'कमला', regNo: '002',
    joinFeeDue: 0, joinDateMs: 5,
    due: [{ seq: 1, remaining: 200, dateMs: 10 }, { seq: 2, remaining: 200, dateMs: 20 }] },
];

test('the joining fee is paid before that member’s closings', () => {
  const r = allocateDeposit(withFees(), 9000);
  const a = r.lines.find((l) => l.memberId === 'a');
  assert.equal(a.joinFee, 8900);
  assert.deepEqual(a.amounts, { 1: 100 });
  assert.equal(a.total, 9000);
});

test('a part-payment can land on the fee alone', () => {
  const r = allocateDeposit(withFees(), 2000);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].joinFee, 2000);
  assert.deepEqual(r.lines[0].amounts, {});
  assert.equal(r.lines[0].seqs.length, 0);
});

test('include: closings only leaves the fee alone', () => {
  const r = allocateDeposit(withFees(), 9000, { include: 'closings' });
  assert.equal(r.feeTotal, 0);
  assert.equal(r.allocated, 800);      // 2 members × 2 closings × ₹200
  assert.equal(r.leftover, 8200);
});

test('include: fees only leaves the closings alone', () => {
  const r = allocateDeposit(withFees(), 9000, { include: 'fees' });
  assert.equal(r.allocated, 8900);
  assert.equal(r.feeTotal, 8900);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.lines[0].amounts, {});
});

test('fees and closings together add up to the deposit', () => {
  const r = allocateDeposit(withFees(), 9700);
  assert.equal(r.allocated, 9700);
  assert.equal(r.leftover, 0);
  assert.equal(r.feeTotal, 8900);
  assert.equal(r.allocated - r.feeTotal, 800);
  assert.ok(r.lines.every((l) => l.full));
});

test('a line reports its fee and closing split separately', () => {
  const r = allocateDeposit(withFees(), 9300);
  const a = r.lines.find((l) => l.memberId === 'a');
  assert.equal(a.joinFee, 8900);
  assert.equal(a.closingAmount, 400);
  assert.equal(a.joinFee + a.closingAmount, a.total);
});

test('oldest rule puts an old member’s fee ahead of a newer member’s', () => {
  const rows = [
    { memberId: 'new', joinFeeDue: 500, joinDateMs: 900, due: [] },
    { memberId: 'old', joinFeeDue: 500, joinDateMs: 100, due: [] },
  ];
  const r = allocateDeposit(rows, 500, { rule: 'oldest' });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].memberId, 'old');
});

test('explicit edits spread over the fee first, then closings', () => {
  const r = allocateExplicit(withFees(), { a: 9000 });
  assert.equal(r.lines[0].joinFee, 8900);
  assert.deepEqual(r.lines[0].amounts, { 1: 100 });
});

test('explicit still refuses more than the member owes, fee included', () => {
  const r = allocateExplicit(withFees(), { a: 20000 });
  assert.equal(r.lines[0].total, 9300);   // 8900 fee + 400 closings
  assert.equal(r.lines[0].refused, 10700);
});

test('allocated + leftover holds with fees in the mix', () => {
  for (const amount of [0, 1, 500, 8899, 8900, 8901, 9300, 9301, 20000]) {
    for (const rule of ['member', 'oldest']) {
      for (const include of ['both', 'closings', 'fees']) {
        const r = allocateDeposit(withFees(), amount, { rule, include });
        assert.equal(
          r.allocated + r.leftover,
          amount,
          `${rule}/${include} @ ${amount}`,
        );
      }
    }
  }
});
