/**
 * commission.js — agent earnings maths.
 *
 * Pure functions, like ledger.js. No Firestore, no I/O.
 *
 * Two independent streams, both configurable per program with a per-agent
 * override, so changing an agent's rate is a settings edit — never a deploy:
 *
 *   1. JOIN FEE      earned when a new member's joining fee is collected
 *   2. COLLECTION    earned when that agent collects closing contributions
 *
 * Every earning is written as one append-only `commission_entries` document
 * INSIDE the same Firestore transaction as the payment that caused it. That is
 * what makes commission impossible to drift from collections: if the money did
 * not land, neither did the commission, and cancelling the receipt cancels the
 * entry in the same atomic step.
 */

import { COMMISSION_MODE, COMMISSION_TYPE } from '../../config/constants.js';

/** Money is rupees to 2 dp. Never let floating point leak into a ledger. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const DISABLED = { enabled: false, mode: COMMISSION_MODE.FIXED, value: 0 };

export const DEFAULT_POLICY = {
  joinFee: { enabled: false, mode: COMMISSION_MODE.PERCENT, value: 0, slabs: [] },
  collection: { enabled: false, mode: COMMISSION_MODE.PERCENT, value: 0, slabs: [] },
  minPayout: 0,
  autoApprove: false,
};

/**
 * Merge program defaults with an agent-level override.
 * The override wins field by field, so an agent can have a special collection
 * rate while still inheriting the program's join-fee rule.
 */
export function resolvePolicy(programPolicy, agentOverride) {
  const base = { ...DEFAULT_POLICY, ...(programPolicy ?? {}) };
  const over = agentOverride ?? {};

  return {
    ...base,
    ...over,
    joinFee: { ...DISABLED, ...base.joinFee, ...(over.joinFee ?? {}) },
    collection: { ...DISABLED, ...base.collection, ...(over.collection ?? {}) },
  };
}

/**
 * Pick the slab that applies to a running count.
 * Slabs are `[{upTo: 50, value: 10}, {upTo: null, value: 15}]` — read as
 * "up to and including 50 → 10, everything after → 15". `upTo: null` is the
 * open-ended final slab.
 */
export function slabValue(slabs, count) {
  if (!Array.isArray(slabs) || !slabs.length) return null;
  const sorted = [...slabs].sort((a, b) => {
    if (a.upTo == null) return 1;
    if (b.upTo == null) return -1;
    return a.upTo - b.upTo;
  });
  for (const slab of sorted) {
    if (slab.upTo == null || count <= Number(slab.upTo)) return Number(slab.value);
  }
  return Number(sorted[sorted.length - 1].value);
}

/**
 * Compute one commission amount.
 *
 * @param {object} rule       resolved policy.joinFee or policy.collection
 * @param {object} ctx
 * @param {number} ctx.baseAmount     money the commission is computed on
 * @param {number} [ctx.units]        closings collected / members joined
 * @param {number} [ctx.runningCount] this agent's count so far, for slabs
 * @returns {{amount:number, mode:string, rate:number, basis:string}|null}
 */
export function computeCommission(rule, ctx) {
  if (!rule?.enabled) return null;

  const baseAmount = Number(ctx.baseAmount) || 0;
  const units = Number(ctx.units) || 0;
  const running = Number(ctx.runningCount) || 0;

  let mode = rule.mode;
  let rate = Number(rule.value) || 0;

  if (mode === COMMISSION_MODE.SLAB) {
    const picked = slabValue(rule.slabs, running + units);
    if (picked == null) return null;
    rate = picked;
    // A slab's value is a percentage unless the rule says otherwise.
    mode = rule.slabMode ?? COMMISSION_MODE.PERCENT;
  }

  let amount = 0;
  let basis = '';

  switch (mode) {
    case COMMISSION_MODE.PERCENT:
      amount = (baseAmount * rate) / 100;
      basis = `${rate}% of ₹${round2(baseAmount)}`;
      break;

    case COMMISSION_MODE.FIXED:
      amount = rate;
      basis = `₹${rate} flat`;
      break;

    case COMMISSION_MODE.FIXED_PER_CLOSING:
      amount = rate * units;
      basis = `₹${rate} × ${units}`;
      break;

    default:
      return null;
  }

  amount = round2(amount);
  if (amount <= 0) return null;

  // A safety rail: commission can never exceed what was actually collected.
  if (amount > baseAmount && baseAmount > 0) {
    amount = round2(baseAmount);
    basis += ' (capped at collected amount)';
  }

  return { amount, mode, rate, basis };
}

/** Commission for a collected receipt. */
export function commissionForPayment(policy, { collectedAmount, closingCount, runningCount = 0 }) {
  const result = computeCommission(policy.collection, {
    baseAmount: collectedAmount,
    units: closingCount,
    runningCount,
  });
  if (!result) return null;
  return { ...result, type: COMMISSION_TYPE.COLLECTION };
}

/** Commission for a member's joining fee. */
export function commissionForJoinFee(policy, { joinFeeAmount, runningCount = 0 }) {
  const result = computeCommission(policy.joinFee, {
    baseAmount: joinFeeAmount,
    units: 1,
    runningCount,
  });
  if (!result) return null;
  return { ...result, type: COMMISSION_TYPE.JOIN_FEE };
}

/**
 * Total up a set of entries for a payout statement.
 * Only `earned` and `approved` entries are payable — `paid` ones are already
 * settled and `cancelled` ones never existed.
 */
export function summariseEntries(entries) {
  const summary = {
    joinFeeCount: 0, joinFeeTotal: 0,
    collectionCount: 0, collectionTotal: 0,
    otherCount: 0, otherTotal: 0,
    payableCount: 0, payableTotal: 0,
    paidCount: 0, paidTotal: 0,
    cancelledCount: 0,
    grossTotal: 0,
  };

  for (const e of entries) {
    const amount = Number(e.amount) || 0;

    if (e.status === 'cancelled') {
      summary.cancelledCount += 1;
      continue;
    }

    if (e.type === COMMISSION_TYPE.JOIN_FEE) {
      summary.joinFeeCount += 1;
      summary.joinFeeTotal = round2(summary.joinFeeTotal + amount);
    } else if (e.type === COMMISSION_TYPE.COLLECTION) {
      summary.collectionCount += 1;
      summary.collectionTotal = round2(summary.collectionTotal + amount);
    } else {
      summary.otherCount += 1;
      summary.otherTotal = round2(summary.otherTotal + amount);
    }

    summary.grossTotal = round2(summary.grossTotal + amount);

    if (e.status === 'paid') {
      summary.paidCount += 1;
      summary.paidTotal = round2(summary.paidTotal + amount);
    } else {
      summary.payableCount += 1;
      summary.payableTotal = round2(summary.payableTotal + amount);
    }
  }

  return summary;
}

/** Net payable after deductions, used when drafting a payout. */
export function computePayout({ entries, deductions = [] }) {
  const summary = summariseEntries(entries);
  const deductionTotal = round2(
    deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0),
  );
  return {
    ...summary,
    deductionTotal,
    netTotal: round2(summary.payableTotal - deductionTotal),
  };
}
