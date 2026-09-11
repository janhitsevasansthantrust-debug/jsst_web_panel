import 'server-only';

import { db, serverNow, inc, countQuery } from '../firebase/admin.js';
import { reversePayment } from './ledger.js';
import {
  getClosingsIndex,
  appendClosingToIndex,
  patchClosingInIndex,
  rebuildClosingsIndex,
} from './indexes.js';
import { resolveBatch, bumpBatch } from './closingBatches.js';
import { badRequest, conflict, notFound } from '../http.js';
import { assertSameProgram } from './scope.js';
import {
  CLOSING_STATUS,
  EXIT_REASON,
  LIMITS,
  MEMBER_STATUS,
  PAYMENT_STATUS,
  paths,
} from '../../config/constants.js';

/**
 * closings.js — creating and reverting a closing.
 *
 * ─── What the old system did ─────────────────────────────────────────────
 *
 * Setting `marriage_flag = true` fired a Cloud Function that wrote one
 * `payment_pending` document for every accepted member — up to 5,000 writes,
 * committed in batches of 499, with no transaction around them. A batch that
 * failed halfway left some members billed and others not, and nothing detected
 * it. `revertClosingMember` then DELETED all of those documents, destroying the
 * record of who had already paid.
 *
 * ─── What happens here ───────────────────────────────────────────────────
 *
 * Creating a closing is ONE transaction and FIVE writes, regardless of whether
 * the trust has 500 members or 500,000. Nobody is "billed" because obligations
 * are derived, not stored.
 *
 * Reverting touches only the members who ACTUALLY PAID — found by querying the
 * receipts, typically a few hundred rather than five thousand — and it reverses
 * rather than deletes. The closing document survives, marked `reverted`, so its
 * seq stays retired and the history stays explainable.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Create
   ══════════════════════════════════════════════════════════════════════════ */

export async function createClosing(scope, input) {
  const { trustId, programId, uid } = scope;

  const memberRef = db.doc(paths.member(trustId, input.memberId));
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw notFound('Member not found');

  const member = memberSnap.data();
  assertSameProgram(member, programId);

  if (member.closingId) {
    throw conflict('This member already has a closing', {
      closingId: member.closingId,
    });
  }
  if (member.status !== MEMBER_STATUS.ACCEPTED) {
    throw badRequest(
      `Only an accepted member can be closed (this one is "${member.status}")`,
    );
  }

  const closingDateMs = Number(input.closingDateMs);
  if (!Number.isFinite(closingDateMs)) {
    throw badRequest('A valid closing date is required');
  }
  if (closingDateMs < Number(member.joinDateMs ?? 0)) {
    throw badRequest('Closing date cannot be before the member joined');
  }

  /**
   * Eligibility snapshot — how many members owed this closing at the moment it
   * was created. An aggregation query: Firestore charges a handful of reads no
   * matter how many members match, so this stays cheap at any scale.
   *
   * It is a REPORTING figure. The authoritative obligation is always derived
   * per member from dates, so a stale snapshot can never mis-bill anyone.
   */
  const membersRef = db
    .collection(paths.members(trustId))
    .where('programId', '==', programId);
  const eligibleCount = await countQuery(
    membersRef
      .where('delete_flag', '==', false)
      .where('status', '==', MEMBER_STATUS.ACCEPTED)
      .where('joinDateMs', '<=', closingDateMs),
  );

  const amountPerMember =
    Number(input.amountPerMember) ||
    Number(member.payAmount) ||
    LIMITS.DEFAULT_PAY_AMOUNT;

  /**
   * The notice this closing will be billed on.
   *
   * Checked BEFORE the transaction opens, because a transaction cannot run a
   * query and a `batchId` pointing at nothing is worse than no batch at all:
   * the closing would exist, owe money, and appear on no sheet.
   */
  const batch = await resolveBatch(scope, input.batchId ?? null);

  const closingRef = db.collection(paths.closings(trustId, programId)).doc();
  const seqRef = db.doc(paths.counterSeq(trustId, programId));
  const statsRef = db.doc(paths.counterStats(trustId, programId));

  const created = await db.runTransaction(async (tx) => {
    const [seqSnap, freshMember] = await Promise.all([
      tx.get(seqRef),
      tx.get(memberRef),
    ]);

    if (freshMember.data()?.closingId) {
      throw conflict('This member already has a closing');
    }

    // seq is allocated atomically and is IMMUTABLE from here on. Eligibility
    // is decided by date, so a back-dated closing getting a high seq is fine.
    const seq = (seqSnap.data()?.closing ?? 0) + 1;

    const closing = {
      seq,
      memberId: input.memberId,
      registrationNumber: member.registrationNumber ?? '',
      displayName: member.displayName ?? '',
      fatherName: member.fatherName ?? '',
      village: member.village ?? '',
      district: member.district ?? '',
      jati: member.jati ?? '',
      phone: member.phone ?? '',
      photoURL: member.photoURL ?? '',

      closingDate: input.closingDate ?? '',
      closingDateMs,
      closingType: input.closingType ?? 'marriage',
      amountPerMember,

      // The यूनिट the member belonged to — their rate card.
      groupId: input.groupId ?? member.groupId ?? null,
      groupName: input.groupName ?? member.groupName ?? null,

      // The क्लोजिंग समूह this closing is billed on — the month's notice.
      batchId: batch.batchId,
      batchName: batch.batchName,

      invitationCardURL: input.invitationCardURL ?? '',
      notes: input.notes ?? '',
      pdfData: input.pdfData ?? {},

      eligibleCount,
      eligibleAmount: eligibleCount * amountPerMember,
      paidCount: 0,
      paidAmount: 0,

      status: CLOSING_STATUS.ACTIVE,
      programId,
      createdAt: serverNow(),
      createdBy: uid,
      updatedAt: serverNow(),
    };

    tx.set(closingRef, closing);
    tx.set(seqRef, { closing: seq, updatedAt: serverNow() }, { merge: true });
    bumpBatch(tx, scope, batch.batchId, 1);

    // The member stops owing future closings from this date onward. `exitDateMs`
    // is the single field the eligibility rule reads — no flags to keep in sync.
    tx.update(memberRef, {
      status: MEMBER_STATUS.CLOSED,
      closingId: closingRef.id,
      closingSeq: seq,
      closingDateMs,
      exitDateMs: closingDateMs,
      exitReason: EXIT_REASON.CLOSED,
      updatedAt: serverNow(),
      updatedBy: uid,
    });

    tx.set(
      statsRef,
      {
        closings: { total: inc(1), active: inc(1), maxSeq: seq },
        members: {
          accepted: inc(-1),
          closed: inc(1),
        },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    return { id: closingRef.id, ...closing, createdAt: null, updatedAt: null };
  });

  // Outside the transaction: refresh the shared index so every screen sees it.
  await appendClosingToIndex(trustId, programId, closingRef.id, created);

  return created;
}

/* ══════════════════════════════════════════════════════════════════════════
   Revert
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Undo a closing.
 *
 * Steps:
 *   1. find only the receipts that actually contain this seq
 *   2. reverse each payer's ledger, in chunked transactions
 *   3. mark the closing reverted (never deleted — the seq stays retired)
 *   4. restore the member to `accepted`
 *   5. write an audit log
 *
 * @param {object} scope
 * @param {string} closingId
 * @param {{reason?:string, uid:string, refundMode?:'cancel'|'keep'}} opts
 *        refundMode 'cancel' — cancel the receipt lines for this closing
 *        refundMode 'keep'   — leave the money as credit (default)
 */
export async function revertClosing(scope, closingId, opts) {
  const { trustId, programId } = scope;
  const uid = opts.uid;

  const closingRef = db.doc(paths.closing(trustId, programId, closingId));
  const closingSnap = await closingRef.get();
  if (!closingSnap.exists) throw notFound('Closing not found');

  const closing = closingSnap.data();
  if (closing.status === CLOSING_STATUS.REVERTED) {
    throw conflict('This closing is already reverted');
  }

  const seq = closing.seq;
  const { items: closings } = await getClosingsIndex(trustId, programId);

  /* ── 1. Who actually paid for this closing? ────────────────────────────── */

  const paidSnap = await db
    .collection(paths.payments(trustId, programId))
    .where('seqs', 'array-contains', seq)
    .where('status', '==', PAYMENT_STATUS.COMPLETED)
    .get();

  const affected = paidSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  /* ── 2. Reverse each payer, in safe chunks ─────────────────────────────── */

  const statsRef = db.doc(paths.counterStats(trustId, programId));
  let refundedTotal = 0;
  const touchedMembers = [];

  for (let i = 0; i < affected.length; i += 50) {
    const slice = affected.slice(i, i + 50);

    // eslint-disable-next-line no-await-in-loop
    await db.runTransaction(async (tx) => {
      const memberRefs = slice.map((p) =>
        db.doc(paths.member(trustId, p.memberId)),
      );
      const memberSnaps = await Promise.all(memberRefs.map((r) => tx.get(r)));

      let chunkRefund = 0;

      slice.forEach((payment, n) => {
        const snap = memberSnaps[n];
        if (!snap.exists) return;

        const member = { id: snap.id, ...snap.data() };
        const reversed = reversePayment(member, [seq], closings);
        const item = (payment.items ?? []).find((x) => x.seq === seq);
        const amount = Number(item?.amount) || 0;

        tx.update(memberRefs[n], {
          paidUpTo: reversed.ledger.paidUpTo,
          paidSeqs: reversed.ledger.paidSeqs,
          exemptSeqs: reversed.ledger.exemptSeqs,
          partialPaid: reversed.ledger.partialPaid,
          paidCount: inc(reversed.counters.paidCountDelta),
          paidAmount: inc(reversed.counters.paidAmountDelta),
          dueCount: reversed.counters.dueCount,
          dueAmount: reversed.counters.dueAmount,
          // Money already collected becomes credit against future closings
          // unless the operator asked to cancel the lines outright.
          ...(opts.refundMode === 'cancel'
            ? {}
            : { creditBalance: inc(amount) }),
          updatedAt: serverNow(),
          updatedBy: uid,
        });

        // The receipt itself is never deleted. We annotate the reversed line so
        // the printed रसीद and the ledger can always be reconciled.
        tx.update(db.doc(paths.payment(trustId, programId, payment.id)), {
          reversedSeqs: [...(payment.reversedSeqs ?? []), seq],
          reversedAmount: inc(amount),
          lastReversalAt: serverNow(),
          lastReversalReason: `Closing #${seq} reverted`,
        });

        chunkRefund += amount;
        touchedMembers.push(member.id);
      });

      tx.set(
        statsRef,
        {
          money: {
            collectedTotal: inc(-chunkRefund),
            creditTotal: inc(opts.refundMode === 'cancel' ? 0 : chunkRefund),
          },
          updatedAt: serverNow(),
        },
        { merge: true },
      );

      refundedTotal += chunkRefund;
    });
  }

  /* ── 3 & 4. Retire the closing, restore the member ─────────────────────── */

  const memberRef = db.doc(paths.member(trustId, closing.memberId));

  await db.runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef);

    tx.update(closingRef, {
      status: CLOSING_STATUS.REVERTED,
      revertedAt: serverNow(),
      revertedAtMs: Date.now(),
      revertedBy: uid,
      revertReason: opts.reason ?? '',
      revertedPayerCount: affected.length,
      revertedAmount: refundedTotal,
      updatedAt: serverNow(),
    });

    // A reverted closing is off the notice — the sheet must not bill for it.
    // The `batchId` stays on the document so the history still says which
    // notice it WOULD have gone out on.
    bumpBatch(tx, scope, closing.batchId ?? null, -1);

    if (memberSnap.exists) {
      tx.update(memberRef, {
        status: MEMBER_STATUS.ACCEPTED,
        closingId: null,
        closingSeq: null,
        closingDateMs: null,
        exitDateMs: null,
        exitReason: null,
        updatedAt: serverNow(),
        updatedBy: uid,
      });
    }

    tx.set(
      db.doc(paths.counterStats(trustId, programId)),
      {
        closings: { active: inc(-1), reverted: inc(1) },
        members: { accepted: inc(1), closed: inc(-1) },
        updatedAt: serverNow(),
      },
      { merge: true },
    );
  });

  /* ── 5. Audit ──────────────────────────────────────────────────────────── */

  await db.collection(paths.auditLogs(trustId, programId)).add({
    action: 'closing.revert',
    closingId,
    seq,
    memberId: closing.memberId,
    memberName: closing.displayName ?? '',
    reason: opts.reason ?? '',
    refundMode: opts.refundMode ?? 'keep',
    affectedReceipts: affected.length,
    affectedMembers: [...new Set(touchedMembers)].length,
    reversedAmount: refundedTotal,
    at: serverNow(),
    atMs: Date.now(),
    by: uid,
  });

  await patchClosingInIndex(trustId, programId, closingId, {
    status: CLOSING_STATUS.REVERTED,
  });

  return {
    closingId,
    seq,
    affectedReceipts: affected.length,
    affectedMembers: [...new Set(touchedMembers)].length,
    reversedAmount: refundedTotal,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reads
   ══════════════════════════════════════════════════════════════════════════ */

/** The closings list — one cached read, no matter how many closings exist. */
export async function listClosings(scope, { includeReverted = false } = {}) {
  const { items, maxSeq, version } = await getClosingsIndex(
    scope.trustId,
    scope.programId,
  );

  const visible = includeReverted
    ? items
    : items.filter((c) => c.status !== CLOSING_STATUS.REVERTED);

  return {
    closings: [...visible].sort((a, b) => b.seq - a.seq),
    maxSeq,
    version,
    total: visible.length,
  };
}

/**
 * Collection status for one closing: how much has come in, and who still owes.
 *
 * The "who still owes" list is paginated over MEMBERS (5,000 max), not over
 * obligations (2.5M in the old model) — and each page is a single indexed
 * query, because a member's `dueCount` is a real field we keep current.
 */
export async function getClosingCollection(scope, closingId, { cursor, limit = LIMITS.PAGE_SIZE } = {}) {
  const { trustId, programId } = scope;

  const [closingSnap, { items: closings }] = await Promise.all([
    db.doc(paths.closing(trustId, programId, closingId)).get(),
    getClosingsIndex(trustId, programId),
  ]);

  if (!closingSnap.exists) throw notFound('Closing not found');
  const closing = { id: closingSnap.id, ...closingSnap.data() };
  const entry = closings.find((c) => c.id === closingId);

  let query = db
    .collection(paths.members(trustId))
    .where('programId', '==', programId)
    .where('delete_flag', '==', false)
    .where('joinDateMs', '<=', closing.closingDateMs)
    .orderBy('joinDateMs', 'asc')
    .select(
      'registrationNumber', 'displayName', 'fatherName', 'phone', 'village',
      'agentId', 'agentName', 'status', 'payAmount', 'joinDateMs', 'exitDateMs',
      'paidUpTo', 'paidSeqs', 'exemptSeqs',
      // The age band a member falls in decides their contribution, so a
      // collection sheet that does not show it cannot be checked against the
      // programme's own rates.
      'ageGroupRange', 'age', 'photoURL', 'groupId', 'groupName',
    )
    .limit(limit);

  if (cursor) query = query.startAfter(cursor);

  const snap = await query.get();

  const { isEligible, amountFor } = await import('./ledger.js');
  const rows = [];

  for (const doc of snap.docs) {
    const member = { id: doc.id, ...doc.data() };
    if (!entry || !isEligible(member, entry)) continue;

    const paidSet = new Set(member.paidSeqs ?? []);
    const exemptSet = new Set(member.exemptSeqs ?? []);
    const seq = closing.seq;

    const isPaid = seq <= (member.paidUpTo ?? 0) || paidSet.has(seq);
    const isExempt = exemptSet.has(seq);

    rows.push({
      ageGroupRange: member.ageGroupRange ?? '',
      age: member.age ?? null,
      photoURL: member.photoURL ?? '',
      groupId: member.groupId ?? null,
      groupName: member.groupName ?? '',
      memberId: member.id,
      registrationNumber: member.registrationNumber,
      name: member.displayName,
      fatherName: member.fatherName,
      phone: member.phone,
      village: member.village,
      agentId: member.agentId ?? null,
      agentName: member.agentName ?? '',
      amount: amountFor(member, entry),
      status: isExempt ? 'exempt' : isPaid ? 'paid' : 'pending',
    });
  }

  const last = snap.docs[snap.docs.length - 1];

  return {
    /**
     * Pending and paid, broken down by age band.
     *
     * The band is what sets a member's contribution, so "₹42,000 outstanding"
     * is not a number anyone can check on its own — but "180 members in the
     * 18–30 band at ₹200, 60 in 31–45 at ₹300" is arithmetic somebody can do
     * on paper against the programme's rate card, which is exactly what
     * happens when a collection sheet is queried.
     */
    byAgeBand: summariseBands(rows),
    closing: {
      id: closing.id,
      seq: closing.seq,
      name: closing.displayName,
      regNo: closing.registrationNumber,
      dateMs: closing.closingDateMs,
      amountPerMember: closing.amountPerMember,
      eligibleCount: closing.eligibleCount,
      eligibleAmount: closing.eligibleAmount,
      paidCount: closing.paidCount ?? 0,
      paidAmount: closing.paidAmount ?? 0,
      pendingCount: Math.max(0, (closing.eligibleCount ?? 0) - (closing.paidCount ?? 0)),
      pendingAmount: Math.max(0, (closing.eligibleAmount ?? 0) - (closing.paidAmount ?? 0)),
      status: closing.status,
    },
    rows,
    nextCursor: snap.size === limit && last ? last.get('joinDateMs') : null,
  };
}

/** Force a full index rebuild — used after a bulk import or a manual fix. */
export async function reindexClosings(scope) {
  return rebuildClosingsIndex(scope.trustId, scope.programId);
}

/**
 * Group the collection rows by age band.
 *
 * Pure, over rows already in hand — no extra reads, and the totals cannot
 * disagree with the list they came from because they are computed from it.
 */
function summariseBands(rows) {
  const map = new Map();

  for (const row of rows) {
    const band = row.ageGroupRange || 'अन्य';
    let entry = map.get(band);

    if (!entry) {
      entry = {
        band,
        total: 0,
        paid: 0,
        pending: 0,
        exempt: 0,
        paidAmount: 0,
        pendingAmount: 0,
        rate: row.amount ?? 0,
      };
      map.set(band, entry);
    }

    entry.total += 1;
    if (row.status === 'paid') {
      entry.paid += 1;
      entry.paidAmount += row.amount ?? 0;
    } else if (row.status === 'exempt') {
      entry.exempt += 1;
    } else {
      entry.pending += 1;
      entry.pendingAmount += row.amount ?? 0;
    }
  }

  // Bands read as "18-30", "31-45" — sort by the number they start with, so
  // the sheet runs youngest to oldest rather than alphabetically.
  return [...map.values()].sort(
    (a, b) => (parseInt(a.band, 10) || 999) - (parseInt(b.band, 10) || 999),
  );
}
