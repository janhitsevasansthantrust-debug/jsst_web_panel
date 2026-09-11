import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePolicy, computeCommission, commissionForPayment, commissionForJoinFee,
  slabValue, summariseEntries, round2, DEFAULT_POLICY,
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
