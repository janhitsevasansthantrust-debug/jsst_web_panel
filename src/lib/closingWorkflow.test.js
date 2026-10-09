import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDue, applyPayment, rebuildLedger, reverseReceiptItems } from '../server/domain/ledger.js';
import { toMemberEntry } from '../server/domain/indexEntry.js';
import { billBatch } from './batchBilling.js';
import { eligibleForClosing } from './closingEligibility.js';
import { selectClosings } from './closingSelection.js';

const day = (n) => Date.UTC(2026, 3, n);
const closings = [3, 4, 5, 5, 6].map((n, i) => ({
  id: `c${i}`, seq: i + 1, memberId: `owner${i}`, name: `सदस्य ${i}`,
  dateMs: day(n), batchId: 'april-2026', status: 'active', amount: 200,
}));
const member = {
  id: 'owner2', status: 'closed', programId: 'p', agentId: 'a',
  joinDateMs: day(1), closingDateMs: day(5), exitDateMs: day(5),
  exitReason: 'closed', payAmount: 200, paidUpTo: 0,
};

test('5 April closing owes 3rd, 4th and another 5th; not own or 6th', () => {
  const due = computeDue(member, closings);
  assert.deepEqual(due.dueSeqs, [1, 2, 4]);
  assert.equal(due.dueAmount, 600);
});

test('joining on 4 April excludes 3 April but includes 4 April', () => {
  assert.deepEqual(computeDue({ ...member, joinDateMs: day(4) }, closings).dueSeqs, [2, 4]);
});

test('snapshot, collection ledger and batch bill use the same date rule', () => {
  const entry = toMemberEntry(member.id, member);
  for (const c of closings) {
    const count = eligibleForClosing([entry], {
      programId: 'p', closingDateMs: c.dateMs, exceptMemberId: c.memberId,
    }).count;
    assert.equal(count, computeDue(member, [c]).dueCount);
  }
  const bills = billBatch([entry], closings, { programId: 'p', agentId: 'a' });
  assert.equal(bills[0].total, 600);
  assert.deepEqual(bills[0].closings.map((c) => c.seq), [1, 2, 4]);
});

test('batch/date/closed-member filters intersect and never include another group', () => {
  assert.deepEqual(selectClosings([...closings, { ...closings[0], id: 'other', batchId: 'may' }], {
    batchId: 'april-2026', fromMs: day(4), toMs: day(5),
  }).map((c) => c.id), ['c1', 'c2', 'c3']);
  assert.deepEqual(selectClosings(closings, { closingId: 'c3' }).map((c) => c.seq), [4]);
});

test('paying and printing again shows only the actual remaining instalments', () => {
  const paid = applyPayment(member, [1, 2], closings, { amounts: { 1: 200, 2: 75 } });
  const entry = toMemberEntry(member.id, { ...member, ...paid.ledger });
  const bills = billBatch([entry], closings, { programId: 'p' });
  assert.equal(bills[0].total, 325);
  assert.deepEqual(bills[0].closings.map((c) => c.remaining), [125, 200]);
});

test('rebuilding retains partial receipts and ignores reversed lines', () => {
  const rebuilt = rebuildLedger(member, closings, [
    { items: [{ seq: 1, amount: 100, full: false }] },
    { items: [{ seq: 1, amount: 50, full: false }, { seq: 2, amount: 200, full: true }], reversedSeqs: [2] },
  ]);
  assert.equal(rebuilt.ledger.partialPaid[1], 150);
  assert.equal(rebuilt.counters.paidAmount, 150);
  assert.equal(rebuilt.counters.dueAmount, 450);
});

test('restoring a closed member recreates unpaid future dues from receipts', () => {
  const paid = applyPayment(member, [1, 2, 4], closings);
  assert.equal(paid.ledger.paidUpTo, 5);
  const active = { ...member, ...paid.ledger, status: 'accepted', exitDateMs: null, closingDateMs: null };
  const reverted = closings.map((c) => c.memberId === member.id ? { ...c, status: 'reverted' } : c);
  const rebuilt = rebuildLedger(active, reverted, [{ items: paid.accepted }]);
  assert.deepEqual(computeDue({ ...active, ...rebuilt.ledger }, reverted).dueSeqs, [5]);
});

test('cancelling first of two instalments changes closing paid count once', () => {
  const p1 = applyPayment(member, [1], closings, { amounts: { 1: 100 } });
  const p2 = applyPayment({ ...member, ...p1.ledger }, [1], closings);
  const rev1 = reverseReceiptItems({ ...member, ...p2.ledger }, p1.accepted, closings);
  const rev2 = reverseReceiptItems({ ...member, ...rev1.ledger }, p2.accepted, closings);
  assert.equal(rev1.lines[0].paidCountDelta, -1);
  assert.equal(rev2.lines[0].paidCountDelta, 0);
});
