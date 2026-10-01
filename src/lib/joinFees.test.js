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
