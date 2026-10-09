import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePolicy, computeCommission, commissionForPayment, commissionForJoinFee,
  slabValue, summariseEntries, round2, DEFAULT_POLICY, reverseCommission, netAmount,
} from './commission.js';
import { COMMISSION_TYPE } from '../../config/constants.js';

/**
 * Both commission streams, and the one that was silently missing.
 *
 * `commissionForJoinFee` existed and was correct — it was simply never called
 * by the payment path, so a trust paying its agents for enrolling members paid
 * them nothing and nothing failed. These tests pin down both streams and, in
 * particular, that a receipt carrying ONLY a joining fee still earns.
 */

const policy = (over = {}) =>
  resolvePolicy(
    {
      collection: { enabled: true, mode: 'percent', value: 10 },
      joinFee: { enabled: true, mode: 'percent', value: 20 },
      autoApprove: true,
      ...over,
    },
    null,
  );

test('a collection earns on the closing total', () => {
  const r = commissionForPayment(policy(), {
    collectedAmount: 1000,
    closingCount: 5,
  });
  assert.equal(r.amount, 100);
});

test('a joining fee earns on the joining fee, separately', () => {
  const r = commissionForJoinFee(policy(), { joinFeeAmount: 500 });
  assert.equal(r.amount, 100);
  assert.notEqual(r.type, commissionForPayment(policy(), {
    collectedAmount: 1000, closingCount: 1,
  }).type, 'the two streams must be distinguishable on the entry');
});

test('the two streams are independent — either can be off', () => {
  const collectionOnly = policy({ joinFee: { enabled: false } });
  assert.ok(commissionForPayment(collectionOnly, { collectedAmount: 1000, closingCount: 1 }));
  assert.equal(commissionForJoinFee(collectionOnly, { joinFeeAmount: 500 }), null);

  const feeOnly = policy({ collection: { enabled: false } });
  assert.equal(commissionForPayment(feeOnly, { collectedAmount: 1000, closingCount: 1 }), null);
  assert.ok(commissionForJoinFee(feeOnly, { joinFeeAmount: 500 }));
});

test('a receipt that is only a joining fee still earns', () => {
  // This is the case the payment path used to skip entirely: it required a
  // closing total before it looked at commission at all.
  const p = policy();
  assert.equal(commissionForPayment(p, { collectedAmount: 0, closingCount: 0 })?.amount ?? 0, 0);
  assert.equal(commissionForJoinFee(p, { joinFeeAmount: 500 }).amount, 100);
});

test('a fixed rate ignores the amount; per-closing multiplies by units', () => {
  const fixed = policy({ collection: { enabled: true, mode: 'fixed', value: 50 } });
  assert.equal(commissionForPayment(fixed, { collectedAmount: 9999, closingCount: 3 }).amount, 50);

  const perClosing = policy({
    collection: { enabled: true, mode: 'fixed_per_closing', value: 20 },
  });
  assert.equal(
    commissionForPayment(perClosing, { collectedAmount: 9999, closingCount: 3 }).amount,
    60,
  );
});

test('slabs are picked by the running count INCLUDING this payment', () => {
  const slabs = [
    { upTo: 10, value: 5 },
    { upTo: 50, value: 10 },
    { upTo: null, value: 15 },
  ];
  assert.equal(slabValue(slabs, 5), 5);
  assert.equal(slabValue(slabs, 25), 10);
  assert.equal(slabValue(slabs, 500), 15);

  const slabbed = policy({
    collection: { enabled: true, mode: 'slab', value: 0, slabs, slabMode: 'percent' },
  });
  // 9 already collected + 1 now = 10, still the first slab.
  assert.equal(
    commissionForPayment(slabbed, {
      collectedAmount: 1000, closingCount: 1, runningCount: 9,
    }).amount,
    50,
  );
  // One more tips it into the second.
  assert.equal(
    commissionForPayment(slabbed, {
      collectedAmount: 1000, closingCount: 1, runningCount: 10,
    }).amount,
    100,
  );
});

test('a disabled policy earns nothing rather than zero-rated something', () => {
  assert.equal(computeCommission({ enabled: false, mode: 'percent', value: 10 }, {
    baseAmount: 1000, units: 1,
  }), null);
});

test('an agent override replaces the program policy for that stream only', () => {
  const merged = resolvePolicy(
    {
      collection: { enabled: true, mode: 'percent', value: 10 },
      joinFee: { enabled: true, mode: 'percent', value: 20 },
    },
    { collection: { enabled: true, mode: 'percent', value: 25 } },
  );

  assert.equal(commissionForPayment(merged, { collectedAmount: 1000, closingCount: 1 }).amount, 250);
  assert.equal(commissionForJoinFee(merged, { joinFeeAmount: 500 }).amount, 100);
});

test('money is rounded to paise, not left as binary float dust', () => {
  const r = commissionForPayment(
    policy({ collection: { enabled: true, mode: 'percent', value: 3.33 } }),
    { collectedAmount: 1000, closingCount: 1 },
  );
  assert.equal(r.amount, round2(r.amount));
  assert.equal(r.amount, 33.3);
});

test('summarising keeps the two streams apart and drops cancelled entries', () => {
  const summary = summariseEntries([
    { amount: 100, status: 'earned', type: COMMISSION_TYPE.COLLECTION },
    { amount: 40, status: 'earned', type: COMMISSION_TYPE.JOIN_FEE },
    { amount: 25, status: 'cancelled', type: COMMISSION_TYPE.COLLECTION },
    { amount: 60, status: 'paid', type: COMMISSION_TYPE.JOIN_FEE },
  ]);

  // Separate totals are the point: an agent asks "how much for enrolling" and
  // "how much for collecting" as two different questions.
  assert.equal(summary.collectionTotal, 100);
  assert.equal(summary.joinFeeTotal, 100);

  // Cancelled money was never earned.
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.grossTotal, 200);

  // Already paid out is not still owed.
  assert.equal(summary.paidTotal, 60);
  assert.equal(summary.payableTotal, 140);
});

test('DEFAULT_POLICY is inert until someone turns it on', () => {
  assert.equal(commissionForPayment(DEFAULT_POLICY, { collectedAmount: 1000, closingCount: 1 }), null);
  assert.equal(commissionForJoinFee(DEFAULT_POLICY, { joinFeeAmount: 500 }), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   Reverting a closing takes the commission back with it
   ══════════════════════════════════════════════════════════════════════════ */

const entry = (over = {}) => ({
  amount: 100, baseAmount: 1000, units: 4, sourceType: 'payment',
  status: 'earned', type: COMMISSION_TYPE.COLLECTION, ...over,
});

test('one reverted closing takes back only its share of the receipt’s entry', () => {
  // A receipt of ₹1,000 over four closings earns ₹100. Reverting the ₹250
  // instalment must claw back ₹25, not the whole ₹100 — the other three
  // closings were collected perfectly well.
  const take = reverseCommission(entry(), { amount: 250, baseAmount: 1000 });
  assert.equal(take.amount, 25);
  assert.equal(take.remaining, 75);
  assert.equal(take.exhausted, false);
});

test('the last share reversed cancels the entry instead of leaving a zero row', () => {
  const first = reverseCommission(entry(), { amount: 250, baseAmount: 1000 });
  const second = reverseCommission(
    { ...entry(), reversedAmount: first.amount },
    { amount: 750, baseAmount: 1000 },
  );
  assert.equal(second.amount, 75);
  assert.equal(second.remaining, 0);
  assert.equal(second.exhausted, true);
});

test('a joining-fee entry is untouched by a closing reversal', () => {
  // The joining fee is not part of any closing. A receipt can carry both
  // entries, and cancelling the closings half must not touch the other.
  const take = reverseCommission(
    entry({ sourceType: 'joinFee', type: COMMISSION_TYPE.JOIN_FEE, amount: 20, baseAmount: 500 }),
    { amount: 250, baseAmount: 1000 },
  );
  assert.equal(take.amount, 0);
  assert.equal(take.exhausted, false);
});

test('nothing is clawed back from an entry with no base to take a share of', () => {
  // Better to leave the agent whole than to guess and take all of it.
  assert.equal(reverseCommission(entry({ baseAmount: 0 }), { amount: 250 }).amount, 0);
  assert.equal(reverseCommission(entry(), { amount: 0 }).amount, 0);
  assert.equal(reverseCommission(null, { amount: 250 }).amount, 0);
});

test('summaries and payouts count the net, not the figure originally earned', () => {
  const summary = summariseEntries([
    { ...entry(), reversedAmount: 25 },
    { ...entry({ amount: 40, type: COMMISSION_TYPE.JOIN_FEE }), status: 'paid' },
  ]);
  assert.equal(summary.collectionTotal, 75);
  assert.equal(summary.payableTotal, 75);
  assert.equal(netAmount({ ...entry(), reversedAmount: 100 }), 0);
  assert.equal(netAmount({ ...entry(), reversedAmount: 500 }), 0);
  assert.equal(netAmount(entry()), 100);
});
