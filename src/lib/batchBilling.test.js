import test from 'node:test';
import assert from 'node:assert/strict';

import { billBatch, groupBillsByAgent, summariseBills } from './batchBilling.js';

const D = (d) => Date.UTC(2026, 3, d); // April 2026

const CLOSINGS = [
  { id: 'c1', seq: 21, memberId: 'x1', dateMs: D(3), status: 'active' },
  { id: 'c2', seq: 22, memberId: 'x2', dateMs: D(15), status: 'active' },
  { id: 'c3', seq: 23, memberId: 'm1', dateMs: D(20), status: 'active' },
  { id: 'c4', seq: 24, memberId: 'x3', dateMs: D(25), status: 'reverted' },
];

const MEMBERS = [
  { id: 'm1', pid: 'p', status: 'accepted', joinMs: D(1), pay: 300, reg: 'V100151', agentId: 'a1', agent: 'Vikash', due: 900 },
  { id: 'm2', pid: 'p', status: 'accepted', joinMs: D(15), pay: 300, reg: 'V100152', agentId: 'a1', agent: 'Vikash', due: 600 },
  { id: 'm3', pid: 'p', status: 'accepted', joinMs: D(21), pay: 500, reg: 'V10099', agentId: 'a2', agent: 'Bharat', due: 0 },
  { id: 'm4', pid: 'p', status: 'closed', joinMs: D(1), pay: 300, reg: 'V100154', agentId: 'a2', agent: 'Bharat', due: 0 },
  { id: 'm5', pid: 'other', status: 'accepted', joinMs: D(1), pay: 300, reg: 'V100155', agentId: 'a1', agent: 'Vikash', due: 0 },
];

const bills = billBatch(MEMBERS, CLOSINGS, { programId: 'p' });
const byId = (id) => bills.find((b) => b.member.id === id);

test('each member is billed only for the closings they owe', () => {
  // m2 joined on the 15th: the 3rd is not theirs. Printing the batch's full
  // list on every receipt would over-bill exactly the newest members.
  assert.equal(byId('m1').count, 2, 'the 3rd and the 15th — not their own');
  assert.equal(byId('m2').count, 2, 'the 15th and the 20th');
  assert.equal(byId('m3'), undefined, 'joined after every closing in the batch');
});

test('a member never owes their own closing', () => {
  const seqs = byId('m1').closings.map((c) => c.seq);
  assert.ok(!seqs.includes(23), 'closing 23 IS m1');
});

test('a reverted closing is on nobody’s receipt', () => {
  for (const bill of bills) {
    assert.ok(!bill.closings.some((c) => c.id === 'c4'));
  }
});

test('the total is the member’s OWN rate times their own count', () => {
  assert.equal(byId('m1').rate, 300);
  assert.equal(byId('m1').total, 600);
  assert.equal(byId('m2').total, 600);
});

test('a closed member is billed nothing further', () => {
  assert.equal(byId('m4'), undefined);
});

test('another योजना’s members are not billed', () => {
  assert.equal(byId('m5'), undefined);
});

test('an agent prints only their own round', () => {
  const mine = billBatch(MEMBERS, CLOSINGS, { programId: 'p', agentId: 'a1' });
  assert.deepEqual(mine.map((b) => b.member.id), ['m1', 'm2']);
});

test('receipts come out in register order, numerically', () => {
  // V10099 must not sort after V100151 — a stack out of register order is a
  // stack somebody re-sorts by hand before walking the village.
  const all = billBatch(
    [
      { id: 'b', pid: 'p', status: 'accepted', joinMs: D(1), pay: 1, reg: 'V100151' },
      { id: 'a', pid: 'p', status: 'accepted', joinMs: D(1), pay: 1, reg: 'V10099' },
    ],
    CLOSINGS,
    { programId: 'p' },
  );
  assert.deepEqual(all.map((x) => x.member.regNo), ['V10099', 'V100151']);
});

test('the agent summary adds up to the stack of receipts', () => {
  const groups = groupBillsByAgent(bills);
  const totals = summariseBills(bills);

  const fromGroups = groups.reduce((s, g) => s + g.total, 0);
  assert.equal(fromGroups, totals.total, 'the sheet on top matches the stack');
  assert.equal(totals.memberCount, bills.length);
});

test('a member added by the office is named, not left blank', () => {
  const groups = groupBillsByAgent(
    billBatch(
      [{ id: 'o', pid: 'p', status: 'accepted', joinMs: D(1), pay: 100, reg: 'V1' }],
      CLOSINGS,
      { programId: 'p' },
    ),
  );
  assert.equal(groups[0].agentName, 'कार्यालय से जोड़े गए');
});

test('a blocked member is still billed', () => {
  const blocked = billBatch(
    [{ id: 'z', pid: 'p', status: 'blocked', joinMs: D(1), pay: 250, reg: 'V9' }],
    CLOSINGS,
    { programId: 'p' },
  );
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].total, 750, 'three live closings at 250');
});

test('an empty batch bills nobody', () => {
  assert.deepEqual(billBatch(MEMBERS, [], { programId: 'p' }), []);
  assert.deepEqual(summariseBills([]), {
    memberCount: 0, closingCount: 0, total: 0, totalDue: 0,
  });
});
