import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFeesState, applyJoinFeePayment } from './joinFees.js';

test('nothing paid yet', () => {
  const s = joinFeesState({ joinFees: 11000, joinFeesPaid: 0 });
  assert.equal(s.total, 11000);
  assert.equal(s.paid, 0);
  assert.equal(s.due, 11000);
  assert.equal(s.done, false);
  assert.equal(s.partial, false);
});

test('part paid — the case this exists for', () => {
  const s = joinFeesState({ joinFees: 11000, joinFeesPaid: 2100 });
  assert.equal(s.due, 8900);
  assert.equal(s.done, false);
  assert.equal(s.partial, true);
});

test('paid in full', () => {
  const s = joinFeesState({ joinFees: 11000, joinFeesPaid: 11000 });
  assert.equal(s.due, 0);
  assert.equal(s.done, true);
  assert.equal(s.partial, false);
});

test('a fee of zero is settled, not outstanding', () => {
  const s = joinFeesState({ joinFees: 0 });
  assert.equal(s.due, 0);
  assert.equal(s.done, true);
});

test('legacy member: the old boolean means the whole fee was paid', () => {
  // No `joinFeesPaid` field at all — enrolled before amounts were tracked.
  const s = joinFeesState({ joinFees: 11000, joinFeesDone: true });
  assert.equal(s.paid, 11000);
  assert.equal(s.due, 0);
  assert.equal(s.done, true);
});

test('legacy member, fee never paid', () => {
  const s = joinFeesState({ joinFees: 11000, joinFeesDone: false });
  assert.equal(s.paid, 0);
  assert.equal(s.due, 11000);
});

test('a later payment overrides the legacy boolean', () => {
  // Once a real amount exists it is the truth, even if the flag disagrees.
  const s = joinFeesState({ joinFees: 11000, joinFeesDone: true, joinFeesPaid: 2100 });
  assert.equal(s.paid, 2100);
  assert.equal(s.due, 8900);
  assert.equal(s.done, false);
});

test('instalments add up and settle exactly', () => {
  let member = { joinFees: 11000, joinFeesPaid: 0 };

  member = { ...member, ...applyJoinFeePayment(member, 2100) };
  assert.equal(member.joinFeesPaid, 2100);
  assert.equal(member.joinFeesDue, 8900);
  assert.equal(member.joinFeesDone, false);

  member = { ...member, ...applyJoinFeePayment(member, 3000) };
  assert.equal(member.joinFeesDue, 5900);

  member = { ...member, ...applyJoinFeePayment(member, 5900) };
  assert.equal(member.joinFeesPaid, 11000);
  assert.equal(member.joinFeesDue, 0);
  assert.equal(member.joinFeesDone, true);
});

test('odd instalments do not leave a floating-point remainder', () => {
  let member = { joinFees: 1100, joinFeesPaid: 0 };
  for (let i = 0; i < 3; i += 1) {
    member = { ...member, ...applyJoinFeePayment(member, 366.67) };
  }
  // 366.67 × 3 = 1100.01 — over, so settled and clamped at the fee.
  assert.equal(member.joinFeesDue, 0);
  assert.equal(member.joinFeesDone, true);
});

test('cancelling a receipt reverses the amount, not the flag', () => {
  let member = { joinFees: 11000, joinFeesPaid: 0 };

  member = { ...member, ...applyJoinFeePayment(member, 11000) };
  assert.equal(member.joinFeesDone, true);

  member = { ...member, ...applyJoinFeePayment(member, -11000) };
  assert.equal(member.joinFeesPaid, 0);
  assert.equal(member.joinFeesDue, 11000);
  assert.equal(member.joinFeesDone, false);
});

test('cancelling one instalment of several leaves the rest paid', () => {
  let member = { joinFees: 11000, joinFeesPaid: 5100 };
  member = { ...member, ...applyJoinFeePayment(member, -3000) };
  assert.equal(member.joinFeesPaid, 2100);
  assert.equal(member.joinFeesDue, 8900);
  assert.equal(member.joinFeesDone, false);
});

test('paid never goes below zero', () => {
  const member = { joinFees: 11000, joinFeesPaid: 500 };
  const next = applyJoinFeePayment(member, -5000);
  assert.equal(next.joinFeesPaid, 0);
  assert.equal(next.joinFeesDue, 11000);
});

test('overpayment is reported rather than hidden', () => {
  const s = joinFeesState({ joinFees: 11000, joinFeesPaid: 11500 });
  assert.equal(s.over, 500);
  assert.equal(s.due, 0);
  assert.equal(s.done, true);
});

/* ── किश्त में नामांकन शुल्क ───────────────────────────────────────────── */

import {
  joinFeeSplit, suggestedClosingDeduction, closingNetAmount, JOIN_FEE_BALANCE,
} from './joinFees.js';

test('band with an at-join amount: 2100 now, 8900 at closing', () => {
  const s = joinFeeSplit({ joinFee: 11000, joinFeeAtJoin: 2100 });
  assert.deepEqual(s, { total: 11000, atJoin: 2100, later: 8900, instalment: true });
});

test('band without an at-join amount takes the whole fee up front', () => {
  assert.deepEqual(joinFeeSplit({ joinFee: 11000 }),
    { total: 11000, atJoin: 11000, later: 0, instalment: false });
  assert.deepEqual(joinFeeSplit({ joinFee: 11000, joinFeeAtJoin: 0 }),
    { total: 11000, atJoin: 11000, later: 0, instalment: false });
});

test('an at-join amount equal to or above the fee is not an instalment', () => {
  assert.equal(joinFeeSplit({ joinFee: 11000, joinFeeAtJoin: 11000 }).instalment, false);
  assert.equal(joinFeeSplit({ joinFee: 11000, joinFeeAtJoin: 15000 }).atJoin, 11000);
});

test('member-shaped input (joinFees) works too', () => {
  assert.equal(joinFeeSplit({ joinFees: 11000, joinFeeAtJoin: 2100 }).later, 8900);
});

test('closing deduction suggests exactly what is outstanding', () => {
  const member = { joinFees: 11000, joinFeesPaid: 2100 };
  assert.equal(suggestedClosingDeduction(member, JOIN_FEE_BALANCE.DEDUCT), 8900);
});

test('collect mode suggests no deduction', () => {
  const member = { joinFees: 11000, joinFeesPaid: 2100 };
  assert.equal(suggestedClosingDeduction(member, JOIN_FEE_BALANCE.COLLECT), 0);
});

test('a deduction never exceeds the payout', () => {
  const member = { joinFees: 11000, joinFeesPaid: 2100 };
  assert.equal(suggestedClosingDeduction(member, JOIN_FEE_BALANCE.DEDUCT, 5000), 5000);
});

test('a fully paid member has nothing to deduct', () => {
  assert.equal(suggestedClosingDeduction({ joinFees: 11000, joinFeesPaid: 11000 }), 0);
});

test('net amount = given − arrears − joining fee', () => {
  assert.equal(closingNetAmount({ amountGiven: 100000, oldPending: 500, joinFeeDeducted: 8900 }), 90600);
  assert.equal(closingNetAmount({ amountGiven: 5000, joinFeeDeducted: 8900 }), 0);
});

/* ── commission only on the at-join part ──────────────────────────────── */

import { commissionableJoinFee } from './joinFees.js';

const split = { joinFees: 11000, joinFeeAtJoin: 2100 };

test('commission: the ₹2,100 taken at joining earns', () => {
  assert.equal(commissionableJoinFee({ ...split, joinFeesPaid: 0 }, 2100), 2100);
});

test('commission: the ₹8,900 settled at closing earns nothing', () => {
  assert.equal(commissionableJoinFee({ ...split, joinFeesPaid: 2100 }, 8900), 0);
});

test('commission: a payment straddling the line earns only up to ₹2,100', () => {
  assert.equal(commissionableJoinFee({ ...split, joinFeesPaid: 1000 }, 5000), 1100);
  assert.equal(commissionableJoinFee({ ...split, joinFeesPaid: 0 }, 11000), 2100);
});

test('commission: an unsplit fee earns on all of it, as before', () => {
  assert.equal(commissionableJoinFee({ joinFees: 11000, joinFeesPaid: 0 }, 11000), 11000);
  assert.equal(commissionableJoinFee({ joinFees: 11000, joinFeeAtJoin: 11000, joinFeesPaid: 0 }, 11000), 11000);
});

test('commission: legacy part-paid member without joinFeeAtJoin keeps old behaviour', () => {
  assert.equal(commissionableJoinFee({ joinFees: 11000, joinFeesPaid: 2100 }, 8900), 8900);
});

/* ── applying a split to members who joined before it existed ─────────── */

import { joinFeeAtJoinForExisting } from './joinFees.js';

const bands = [
  { id: 'ag_1', startAge: 0, endAge: 40, joinFee: 11000, joinFeeAtJoin: 2100 },
  { id: 'ag_2', startAge: 40, endAge: 70, joinFee: 15000 },
];

test('existing: member in a split band gets the band at-join figure', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'ag_1', joinFees: 11000 }, bands), 2100);
});

test('existing: band found by range when the id changed', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'old', ageGroupRange: '0-40', joinFees: 11000 }, bands), 2100);
});

test('existing: already set — nothing to do', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'ag_1', joinFees: 11000, joinFeeAtJoin: 2100 }, bands), null);
});

test('existing: unsplit band and legacy member — nothing to do', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'ag_2', joinFees: 15000 }, bands), null);
});

test('existing: split removed from the band puts the member back to all-at-join', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'ag_2', joinFees: 15000, joinFeeAtJoin: 3000 }, bands), 15000);
});

test('existing: member on an older, smaller fee keeps their own total', () => {
  // Enrolled at ₹1,100; band now says 11000/2100 — at-join can't exceed 1100.
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'ag_1', joinFees: 1100 }, bands), null);
});

test('existing: no band found — left alone', () => {
  assert.equal(joinFeeAtJoinForExisting({ ageGroup: 'x', ageGroupRange: '9-9', joinFees: 11000 }, bands), null);
});
