/**
 * ledger.js — the heart of the system.
 *
 * PURE FUNCTIONS ONLY. No Firestore, no Next.js, no I/O, no Date.now().
 * Everything here is deterministic and unit-tested, because every rupee in the
 * trust depends on it.
 *
 * ─── The model ────────────────────────────────────────────────────────────
 *
 * The old system stored one document per (member × closing) — 2.5 million rows
 * at target scale. We store none of them. An obligation is DERIVED:
 *
 *     member M owes closing C  ⟺  M joined on or before C's date
 *                              ∧  M had not exited on or before C's date
 *                              ∧  M is not C's own member
 *                              ∧  C is not reverted
 *
 * What each member DOES store is which obligations are settled, compressed
 * into two fields:
 *
 *     paidUpTo : number    every obligation with seq <= paidUpTo is settled
 *     paidSeqs : number[]  individually-paid seqs ABOVE the watermark
 *     exemptSeqs: number[] waived / not-applicable seqs above the watermark
 *
 * In the normal case (member is paid up to date) `paidSeqs` is empty and the
 * whole ledger is a single integer. Worst case at 500 closings it is ~4.5 KB
 * against Firestore's 1 MB document limit, so the design holds to ~100,000
 * closings.
 *
 * `seq` is an IMMUTABLE integer assigned to each closing at creation time.
 * It is only an identifier — eligibility is always decided by DATE, never by
 * seq — so back-dating a closing can never corrupt an existing ledger.
 */

import { LIMITS, MEMBER_STATUS } from '../../config/constants.js';

/* ══════════════════════════════════════════════════════════════════════════
   Normalisation
   ══════════════════════════════════════════════════════════════════════════ */

/** Read a member's ledger into a normalised, defensive shape. */
export function readLedger(member = {}) {
  return {
    paidUpTo: toInt(member.paidUpTo, 0),
    paidSeqs: toSortedUniqueInts(member.paidSeqs),
    exemptSeqs: toSortedUniqueInts(member.exemptSeqs),
    partialPaid: toPartialMap(member.partialPaid),
  };
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toSortedUniqueInts(arr) {
  if (!Array.isArray(arr)) return [];
  const set = new Set();
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) set.add(Math.trunc(n));
  }
  return [...set].sort((a, b) => a - b);
}

function toPartialMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const seq = Number(k);
    const amt = Number(v);
    if (Number.isFinite(seq) && Number.isFinite(amt) && amt > 0) {
      out[Math.trunc(seq)] = amt;
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Eligibility
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Does this member owe a contribution for this closing?
 *
 * Boundary rules, chosen to match the trust's real-world practice and the
 * behaviour of the old Cloud Functions:
 *   • joined ON the closing date  → owes (joinDateMs <= closing.dateMs)
 *   • exited ON the closing date  → does NOT owe (exitDateMs <= closing.dateMs)
 *   • the closing's own member    → never owes
 *
 * @param {{id?:string, joinDateMs?:number, exitDateMs?:number|null}} member
 * @param {{seq:number, dateMs:number, memberId?:string, status?:string}} closing
 */
export function isEligible(member, closing) {
  if (!member || !closing) return false;
  if (closing.status === 'reverted') return false;
  if (!Number.isFinite(closing.dateMs)) return false;

  const joinMs = Number(member.joinDateMs);
  if (!Number.isFinite(joinMs)) return false;
  if (joinMs > closing.dateMs) return false;

  const memberId = member.id ?? member.memberId;
  if (memberId && closing.memberId && memberId === closing.memberId) return false;

  /**
   * Whether a blocked member is billed is the CLOSING's decision, taken when
   * it was created and stored on it — not a setting that can be changed later.
   *
   * That matters: if it were a live setting, flipping it would silently
   * rewrite what every blocked member owes for every closing already made,
   * including ones they have receipts for. Freezing it per closing means a
   * closing bills exactly whom it was created to bill, forever.
   *
   * Absent means true, so every closing made before this existed keeps
   * behaving exactly as it did.
   */
  if (closing.includeBlocked === false && member.status === MEMBER_STATUS.BLOCKED) {
    return false;
  }

  const exitMs = member.exitDateMs;
  if (exitMs != null && Number.isFinite(Number(exitMs))) {
    if (Number(exitMs) <= closing.dateMs) return false;
  }

  return true;
}

/**
 * The per-closing amount THIS member pays.
 *
 * Precedence: an explicit override on the closing → the member's own rate
 * (which comes from their group) → the closing's default → the system default.
 * Outstanding dues therefore re-price if a member's group rate changes, while
 * money already collected is never re-priced (that comes from payment records).
 */
export function amountFor(member, closing) {
  const override = Number(closing?.amountOverride);
  if (Number.isFinite(override) && override > 0) return override;

  const memberRate = Number(member?.payAmount);
  if (Number.isFinite(memberRate) && memberRate > 0) return memberRate;

  const closingRate = Number(closing?.amount ?? closing?.amountPerMember);
  if (Number.isFinite(closingRate) && closingRate > 0) return closingRate;

  return LIMITS.DEFAULT_PAY_AMOUNT;
}

/* ══════════════════════════════════════════════════════════════════════════
   Due computation
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything a member currently owes.
 *
 * Cost: zero reads. `closings` is the cached index document that the whole
 * application shares, and the member document is already in hand.
 *
 * @param {object} member          the member document
 * @param {Array}  closings        the closings index: [{seq,id,dateMs,...}]
 * @returns {{dueItems:Array, dueSeqs:number[], dueCount:number,
 *            dueAmount:number, settledCount:number, exemptCount:number,
 *            eligibleCount:number, eligibleAmount:number}}
 */
export function computeDue(member, closings) {
  const { paidUpTo, paidSeqs, exemptSeqs, partialPaid } = readLedger(member);
  const paidSet = new Set(paidSeqs);
  const exemptSet = new Set(exemptSeqs);

  const dueItems = [];
  let dueAmount = 0;
  let settledCount = 0;
  let exemptCount = 0;
  let eligibleCount = 0;
  let eligibleAmount = 0;

  for (const closing of closings) {
    if (!isEligible(member, closing)) continue;

    const seq = closing.seq;
    const amount = amountFor(member, closing);
    eligibleCount += 1;
    eligibleAmount += amount;

    if (seq <= paidUpTo) {
      settledCount += 1;
      continue;
    }
    if (exemptSet.has(seq)) {
      exemptCount += 1;
      continue;
    }
    if (paidSet.has(seq)) {
      settledCount += 1;
      continue;
    }

    const already = partialPaid[seq] || 0;
    const remaining = Math.max(0, amount - already);
    if (remaining <= 0) {
      settledCount += 1;
      continue;
    }

    dueItems.push({
      seq,
      closingId: closing.id,
      name: closing.name ?? closing.displayName ?? '',
      regNo: closing.regNo ?? closing.registrationNumber ?? '',
      fatherName: closing.fatherName ?? '',
      village: closing.village ?? '',
      dateMs: closing.dateMs,
      amount,
      alreadyPaid: already,
      remaining,
      partial: already > 0,
    });
    dueAmount += remaining;
  }

  return {
    dueItems,
    dueSeqs: dueItems.map((d) => d.seq),
    dueCount: dueItems.length,
    dueAmount,
    settledCount,
    exemptCount,
    eligibleCount,
    eligibleAmount,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Watermark compaction
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Absorb the leading run of settled seqs into `paidUpTo` and drop them from
 * the arrays. This is what keeps a fully-paid member's ledger a single
 * integer instead of a 500-element array.
 *
 * A seq counts as settled if it is paid, exempt, or the member was never
 * eligible for it in the first place.
 */
export function compactLedger(ledger, member, closings, maxSeq) {
  const paidSet = new Set(ledger.paidSeqs);
  const exemptSet = new Set(ledger.exemptSeqs);
  const bySeq = new Map(closings.map((c) => [c.seq, c]));
  const partialPaid = { ...ledger.partialPaid };

  const top = Number.isFinite(maxSeq)
    ? maxSeq
    : closings.reduce((m, c) => Math.max(m, c.seq), 0);

  let watermark = ledger.paidUpTo;

  while (watermark < top) {
    const next = watermark + 1;
    const closing = bySeq.get(next);

    // Gap in the sequence (reverted or not yet indexed) → nothing to owe.
    const settled =
      !closing ||
      !isEligible(member, closing) ||
      paidSet.has(next) ||
      exemptSet.has(next);

    if (!settled) break;
    watermark = next;
  }

  const keep = (s) => s > watermark;
  for (const seq of Object.keys(partialPaid)) {
    if (Number(seq) <= watermark) delete partialPaid[seq];
  }

  return {
    paidUpTo: watermark,
    paidSeqs: ledger.paidSeqs.filter(keep),
    exemptSeqs: ledger.exemptSeqs.filter(keep),
    partialPaid,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Applying a payment
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Settle a set of closings for a member.
 *
 * This runs INSIDE the Firestore transaction, against the freshly-read member
 * document — never against what the browser sent. That is what makes
 * double-submits, stale tabs and races harmless: a seq that is already settled
 * is silently rejected and reported back, not charged twice.
 *
 * @param {object} member
 * @param {number[]} seqs        seqs the caller wants to pay
 * @param {Array} closings       the closings index
 * @param {object} [opts]
 * @param {Object<number,number>} [opts.amounts]  seq → amount actually tendered
 *                                                (omit for full payment)
 * @returns {{ledger:object, accepted:Array, rejected:Array,
 *            totalAmount:number, counters:object}}
 */
export function applyPayment(member, seqs, closings, opts = {}) {
  const ledger = readLedger(member);
  const bySeq = new Map(closings.map((c) => [c.seq, c]));
  const paidSet = new Set(ledger.paidSeqs);
  const exemptSet = new Set(ledger.exemptSeqs);
  const partialPaid = { ...ledger.partialPaid };

  const accepted = [];
  const rejected = [];
  let totalAmount = 0;
  let newlySettled = 0;

  for (const raw of toSortedUniqueInts(seqs)) {
    const closing = bySeq.get(raw);

    if (!closing) {
      rejected.push({ seq: raw, reason: 'unknown_closing' });
      continue;
    }
    if (closing.status === 'reverted') {
      rejected.push({ seq: raw, reason: 'closing_reverted' });
      continue;
    }
    if (!isEligible(member, closing)) {
      rejected.push({ seq: raw, reason: 'not_eligible' });
      continue;
    }
    if (raw <= ledger.paidUpTo || paidSet.has(raw)) {
      rejected.push({ seq: raw, reason: 'already_paid' });
      continue;
    }
    if (exemptSet.has(raw)) {
      rejected.push({ seq: raw, reason: 'exempt' });
      continue;
    }

    const full = amountFor(member, closing);
    const already = partialPaid[raw] || 0;
    const remaining = full - already;
    const tendered = opts.amounts?.[raw] != null
      ? Number(opts.amounts[raw])
      : remaining;

    if (!Number.isFinite(tendered) || tendered <= 0) {
      rejected.push({ seq: raw, reason: 'invalid_amount' });
      continue;
    }
    if (tendered > remaining) {
      rejected.push({ seq: raw, reason: 'amount_exceeds_due', remaining });
      continue;
    }

    if (tendered >= remaining) {
      paidSet.add(raw);
      delete partialPaid[raw];
      newlySettled += 1;
      accepted.push({
        seq: raw,
        closingId: closing.id,
        name: closing.name ?? closing.displayName ?? '',
        regNo: closing.regNo ?? closing.registrationNumber ?? '',
        closingDateMs: closing.dateMs,
        amount: tendered,
        full: true,
      });
    } else {
      partialPaid[raw] = already + tendered;
      accepted.push({
        seq: raw,
        closingId: closing.id,
        name: closing.name ?? closing.displayName ?? '',
        regNo: closing.regNo ?? closing.registrationNumber ?? '',
        closingDateMs: closing.dateMs,
        amount: tendered,
        full: false,
      });
    }

    totalAmount += tendered;
  }

  const compacted = compactLedger(
    {
      paidUpTo: ledger.paidUpTo,
      paidSeqs: [...paidSet].sort((a, b) => a - b),
      exemptSeqs: [...exemptSet].sort((a, b) => a - b),
      partialPaid,
    },
    member,
    closings,
  );

  const after = computeDue({ ...member, ...compacted }, closings);

  return {
    ledger: compacted,
    accepted,
    rejected,
    totalAmount,
    counters: {
      paidCountDelta: newlySettled,
      paidAmountDelta: totalAmount,
      dueCount: after.dueCount,
      dueAmount: after.dueAmount,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reversal
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un-settle a set of closings — used when a receipt is cancelled, or a closing
 * is reverted. Money records are never deleted; this only moves the obligation
 * back to "due".
 *
 * If a reversed seq sits below the watermark, the watermark is lowered and
 * every still-settled seq above the new watermark is written back into
 * `paidSeqs`, so no settlement is silently lost.
 */
export function reversePayment(member, seqs, closings) {
  const ledger = readLedger(member);
  const targets = toSortedUniqueInts(seqs);
  if (!targets.length) {
    return { ledger, reversed: [], counters: null };
  }

  const paidSet = new Set(ledger.paidSeqs);
  const exemptSet = new Set(ledger.exemptSeqs);
  const partialPaid = { ...ledger.partialPaid };
  const bySeq = new Map(closings.map((c) => [c.seq, c]));

  const lowest = targets[0];
  let watermark = ledger.paidUpTo;

  if (lowest <= watermark) {
    // Expand the watermark back out into explicit entries before lowering it,
    // so settlements between `lowest` and the old watermark survive.
    for (let s = lowest; s <= watermark; s += 1) {
      const closing = bySeq.get(s);
      if (!closing) continue;
      if (!isEligible(member, closing)) continue;
      paidSet.add(s);
    }
    watermark = lowest - 1;
  }

  const reversed = [];
  let reversedAmount = 0;

  for (const seq of targets) {
    const closing = bySeq.get(seq);
    const amount = closing ? amountFor(member, closing) : 0;

    if (paidSet.delete(seq)) {
      reversed.push({ seq, amount, was: 'paid' });
      reversedAmount += amount;
    } else if (partialPaid[seq]) {
      reversed.push({ seq, amount: partialPaid[seq], was: 'partial' });
      reversedAmount += partialPaid[seq];
      delete partialPaid[seq];
    } else {
      reversed.push({ seq, amount: 0, was: 'not_paid' });
    }
  }

  const next = {
    paidUpTo: watermark,
    paidSeqs: [...paidSet].sort((a, b) => a - b),
    exemptSeqs: [...exemptSet].sort((a, b) => a - b),
    partialPaid,
  };

  const compacted = compactLedger(next, member, closings);
  const after = computeDue({ ...member, ...compacted }, closings);

  const reversedCount = reversed.filter((r) => r.was === 'paid').length;

  return {
    ledger: compacted,
    reversed,
    counters: {
      // `x ? -x : 0` avoids -0, which is legal JS but ugly in Firestore/JSON.
      paidCountDelta: reversedCount ? -reversedCount : 0,
      paidAmountDelta: reversedAmount ? -reversedAmount : 0,
      dueCount: after.dueCount,
      dueAmount: after.dueAmount,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Exemptions
   ══════════════════════════════════════════════════════════════════════════ */

/** Waive a member's obligation for specific closings (admin action). */
export function applyExemption(member, seqs, closings) {
  const ledger = readLedger(member);
  const exemptSet = new Set(ledger.exemptSeqs);
  const paidSet = new Set(ledger.paidSeqs);
  const applied = [];

  for (const seq of toSortedUniqueInts(seqs)) {
    if (seq <= ledger.paidUpTo || paidSet.has(seq)) continue; // already settled
    exemptSet.add(seq);
    applied.push(seq);
  }

  const compacted = compactLedger(
    { ...ledger, exemptSeqs: [...exemptSet].sort((a, b) => a - b) },
    member,
    closings,
  );
  const after = computeDue({ ...member, ...compacted }, closings);

  return {
    ledger: compacted,
    applied,
    counters: { dueCount: after.dueCount, dueAmount: after.dueAmount },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reconciliation — used by the migration verifier and the nightly audit
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rebuild a member's ledger from scratch out of their raw payment records.
 * The result of this is the ONLY source of truth we trust when verifying the
 * migration, or when auditing for drift. If this disagrees with the stored
 * ledger, the stored ledger is wrong.
 *
 * @param {object} member
 * @param {Array} closings
 * @param {Array} payments  completed receipts: [{seqs:number[], items:[...]}]
 */
export function rebuildLedger(member, closings, payments) {
  const paidSeqs = new Set();
  let paidAmount = 0;
  let paidCount = 0;

  for (const p of payments) {
    if (p.status === 'cancelled' || p.delete_flag === true) continue;
    for (const item of p.items ?? []) {
      if (item.seq == null) continue;
      if (item.full === false) continue; // partials handled below
      if (!paidSeqs.has(item.seq)) {
        paidSeqs.add(item.seq);
        paidCount += 1;
      }
      paidAmount += Number(item.amount) || 0;
    }
  }

  const base = {
    paidUpTo: 0,
    paidSeqs: [...paidSeqs].sort((a, b) => a - b),
    exemptSeqs: toSortedUniqueInts(member.exemptSeqs),
    partialPaid: {},
  };

  const compacted = compactLedger(base, member, closings);
  const due = computeDue({ ...member, ...compacted }, closings);

  return {
    ledger: compacted,
    counters: {
      paidCount,
      paidAmount,
      dueCount: due.dueCount,
      dueAmount: due.dueAmount,
    },
  };
}

/**
 * Compare a stored ledger against a rebuilt one. Returns null when they agree.
 * Used by the nightly integrity job and the migration reconciliation report.
 */
export function diffLedger(stored, rebuilt) {
  const a = readLedger(stored);
  const b = readLedger(rebuilt);
  const problems = [];

  if (a.paidUpTo !== b.paidUpTo) {
    problems.push({ field: 'paidUpTo', stored: a.paidUpTo, rebuilt: b.paidUpTo });
  }
  const sa = new Set(a.paidSeqs);
  const sb = new Set(b.paidSeqs);
  const onlyStored = [...sa].filter((s) => !sb.has(s));
  const onlyRebuilt = [...sb].filter((s) => !sa.has(s));
  if (onlyStored.length) problems.push({ field: 'paidSeqs', onlyStored });
  if (onlyRebuilt.length) problems.push({ field: 'paidSeqs', onlyRebuilt });

  return problems.length ? problems : null;
}
