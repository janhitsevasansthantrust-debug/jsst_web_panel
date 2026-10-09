import 'server-only';

import { db, serverNow, inc } from '../firebase/admin.js';
import { computeDue, rebuildLedger, reverseReceiptItems } from './ledger.js';
import {
  getClosingsIndex,
  getMembersIndex,
  patchMemberInIndex,
  patchMembersInIndex,
  toIndexEntry,
  invalidateIndexCache,
  rebuildClosingsIndex,
} from './indexes.js';
import { resolveBatch, bumpBatch, setClosingBatch } from './closingBatches.js';
import { reverseCommission, round2 } from './commission.js';

import { eligibleForClosing } from '../../lib/closingEligibility.js';
import { collectionReport } from './collectionReport.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { assertSameProgram } from './scope.js';
import {
  CLOSING_STATUS,
  COMMISSION_STATUS,
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
   * What this closing is expected to raise — summed from the members.
   *
   * Read from the shared member index, which is already in memory, so this
   * costs nothing and gives the exact total rather than a count. The old code
   * ran an aggregation query for the count and multiplied it by a rate typed
   * into the form; see `lib/closingEligibility.js` for why that rate was
   * always the wrong one.
   *
   * It is a REPORTING figure only. The authoritative obligation is derived per
   * member from dates by `ledger.computeDue`, so a stale snapshot here can
   * never mis-bill anybody.
   */
  const includeBlocked = input.includeBlocked !== false;

  const eligible = eligibleForClosing((await getMembersIndex(trustId)).items, {
    programId,
    closingDateMs,
    exceptMemberId: input.memberId,
    includeBlocked,
  });

  const eligibleCount = eligible.count;

  /**
   * A fallback rate, NOT a rate for everybody.
   *
   * `ledger.amountFor` puts each member's own `payAmount` ahead of this, so it
   * is reached only by a member who has no rate of their own — and it is the
   * average of the members who do, which is the least surprising thing to
   * charge them. It is deliberately no longer taken from the request: a number
   * typed into the closing form could never change anybody's dues, only the
   * reported total, which made the screen and the receipts disagree.
   */
  const amountPerMember = eligible.typicalAmount;

  /**
   * The notice this closing will be billed on.
   *
   * Checked BEFORE the transaction opens, because a transaction cannot run a
   * query and a `batchId` pointing at nothing is worse than no batch at all:
   * the closing would exist, owe money, and appear on no sheet.
   */
  const batch = await resolveBatch(scope, input.batchId ?? null);
  await getClosingsIndex(trustId, programId);

  const closingRef = db.collection(paths.closings(trustId, programId)).doc();
  const seqRef = db.doc(paths.counterSeq(trustId, programId));
  const statsRef = db.doc(paths.counterStats(trustId, programId));
  const indexRef = db.doc(paths.closingsIndex(trustId, programId));

  const created = await db.runTransaction(async (tx) => {
    const [seqSnap, freshMember, indexSnap, batchSnap] = await Promise.all([
      tx.get(seqRef),
      tx.get(memberRef),
      tx.get(indexRef),
      batch.batchId ? tx.get(db.doc(paths.closingBatch(trustId, programId, batch.batchId))) : null,
    ]);
    if (batch.batchId && (!batchSnap?.exists || batchSnap.data().status !== 'open')) {
      throw conflict('क्लोजिंग समूह खुला नहीं है');
    }

    if (freshMember.data()?.closingId) {
      throw conflict('This member already has a closing');
    }
    if (!freshMember.exists || freshMember.data().status !== MEMBER_STATUS.ACCEPTED ||
        freshMember.data().programId !== programId) {
      throw conflict('This member can no longer be closed');
    }
    if (closingDateMs < Number(freshMember.data().joinDateMs ?? 0)) {
      throw conflict('The member’s join date changed; refresh before creating the closing');
    }

    // seq is allocated atomically and is IMMUTABLE from here on. Eligibility
    // is decided by date, so a back-dated closing getting a high seq is fine.
    const seq = (seqSnap.data()?.closing ?? 0) + 1;

    const closing = {
      seq,
      memberId: input.memberId,
      registrationNumber: freshMember.data().registrationNumber ?? '',
      displayName: freshMember.data().displayName ?? '',
      fatherName: freshMember.data().fatherName ?? '',
      village: freshMember.data().village ?? '',
      district: freshMember.data().district ?? '',
      jati: freshMember.data().jati ?? '',
      phone: freshMember.data().phone ?? '',
      photoURL: freshMember.data().photoURL ?? '',

      closingDate: input.closingDate ?? '',
      closingDateMs,
      closingType: input.closingType ?? 'marriage',
      amountPerMember,
      // Frozen here. See `ledger.isEligible` for why it must never become a
      // setting that can be changed after the fact.
      includeBlocked,

      // The यूनिट the member belonged to — their rate card.
      groupId: input.groupId ?? freshMember.data().groupId ?? null,
      groupName: input.groupName ?? freshMember.data().groupName ?? null,

      // The क्लोजिंग समूह this closing is billed on — the month's notice.
      batchId: batch.batchId,
      batchName: batch.batchName,

      invitationCardURL: input.invitationCardURL ?? '',
      notes: input.notes ?? '',
      pdfData: input.pdfData ?? {},

      eligibleCount,
      // The SUM of what each eligible member pays, not count × one rate.
      eligibleAmount: eligible.amount,
      /** Band-by-band, so the collection sheet can be read at a glance. */
      eligibleByBand: eligible.byBand,
      paidCount: 0,
      paidAmount: 0,

      status: CLOSING_STATUS.ACTIVE,
      programId,
      createdAt: serverNow(),
      createdBy: uid,
      updatedAt: serverNow(),
    };

    tx.set(closingRef, closing);
    const items = [...(indexSnap.data()?.items ?? []), toIndexEntry(closingRef.id, closing)].sort((a, b) => a.seq - b.seq);
    tx.set(indexRef, { items, count: items.length, maxSeq: seq, version: Date.now(), updatedAt: serverNow() });
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
        /**
         * What this closing is expected to raise joins the trust's totals here.
         *
         * Every receipt takes its amount OFF `dueTotal` and revert takes the
         * eligible amount off again — but nothing ever put it on. So the
         * dashboard's "कुल बकाया" went negative by exactly what had been
         * collected, and वसूली % sat at zero because `expectedTotal` never
         * moved. `recomputeStats` (dashboard → ?recompute=true) heals counters
         * written before this line existed.
         */
        money: {
          expectedTotal: inc(Number(eligible.amount) || 0),
          dueTotal: inc(Number(eligible.amount) || 0),
        },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    return { id: closingRef.id, ...closing, createdAt: null, updatedAt: null };
  });

  // Outside the transaction: refresh the shared index so every screen sees it.
  invalidateIndexCache(trustId, programId);
  const updatedMember = await memberRef.get();
  await patchMemberInIndex(trustId, input.memberId, updatedMember.data());

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
 *   2. reverse each receipt line in its own retry-safe transaction
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

  // Fence off new receipts before enumerating payers. Re-running a failed
  // revert is safe: each receipt records which seqs were already reversed.
  if (closing.status === CLOSING_STATUS.ACTIVE) {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(closingRef);
      if (current.data()?.status !== CLOSING_STATUS.ACTIVE) {
        throw conflict('Closing is already being reverted');
      }
      tx.update(closingRef, {
        status: CLOSING_STATUS.REVERTING,
        revertReason: opts.reason ?? '',
        refundMode: opts.refundMode ?? 'keep',
        updatedAt: serverNow(),
      });
    });
  } else if (closing.status !== CLOSING_STATUS.REVERTING) {
    throw conflict('Closing is not active');
  }
  const refundMode = closing.status === CLOSING_STATUS.REVERTING
    ? (closing.refundMode ?? 'keep')
    : (opts.refundMode ?? 'keep');

  const seq = closing.seq;
  const { items: closings } = await getClosingsIndex(trustId, programId);
  const withoutClosing = closings.map((item) => item.seq === seq
    ? { ...item, status: CLOSING_STATUS.REVERTED }
    : item);

  /* ── 1. Who actually paid for this closing? ────────────────────────────── */

  const paidSnap = await db
    .collection(paths.payments(trustId, programId))
    .where('seqs', 'array-contains', seq)
    .where('status', '==', PAYMENT_STATUS.COMPLETED)
    .get();

  const affected = paidSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  /* ── 2. Reverse each receipt exactly once ───────────────────────────────── */

  const statsRef = db.doc(paths.counterStats(trustId, programId));
  let totalClawedBack = 0;
  for (const payment of affected) {
    const receiptRef = db.doc(paths.payment(trustId, programId, payment.id));
    const memberRef = db.doc(paths.member(trustId, payment.memberId));
    // eslint-disable-next-line no-await-in-loop
    await db.runTransaction(async (tx) => {
      const [receiptSnap, memberSnap] = await Promise.all([
        tx.get(receiptRef), tx.get(memberRef),
      ]);
      if (!receiptSnap.exists || receiptSnap.data().status !== PAYMENT_STATUS.COMPLETED ||
          receiptSnap.data().reversedSeqs?.includes(seq)) return null;
      if (!memberSnap.exists) throw notFound('Payer not found during closing reversal');

      const item = (receiptSnap.data().items ?? []).find((x) => x.seq === seq);
      if (!item) throw conflict('Receipt line for this closing is missing');
      const member = { id: memberSnap.id, ...memberSnap.data() };
      assertSameProgram(member, programId);
      const reversed = reverseReceiptItems(member, [item], closings);
      const due = computeDue({ ...member, ...reversed.ledger }, withoutClosing);
      const amount = Number(item.amount);

      /**
       * The agent earned commission when this money was collected. It is going
       * back, so the commission earned on it goes back too — the trust cannot
       * pay commission on a collection that no longer exists.
       *
       * Only the SHARE this line earned is taken: a receipt carrying four
       * closings has one entry, and reverting one of them must not cancel the
       * commission for the three that were collected perfectly well. An entry
       * already paid out is left alone for the same reason `cancelPayment`
       * leaves it: the money has left the trust and cannot be un-earned.
       */
      const commissionIds = receiptSnap.data().commissionEntryIds?.length
        ? receiptSnap.data().commissionEntryIds
        : [receiptSnap.data().commissionEntryId].filter(Boolean);
      const commissionRefs = commissionIds.map((id) =>
        db.doc(`${paths.commissionEntries(trustId, programId)}/${id}`));
      const agentId = receiptSnap.data().collectedByAgentId;
      const agentRef = agentId ? db.doc(paths.agent(trustId, agentId)) : null;

      const [commissionSnaps, agentSnap] = await Promise.all([
        Promise.all(commissionRefs.map((ref) => tx.get(ref))),
        agentRef ? tx.get(agentRef) : null,
      ]);

      let clawedBack = 0;
      commissionSnaps.forEach((snap, i) => {
        if (!snap?.exists) return;
        if (snap.data().status === COMMISSION_STATUS.PAID) return;
        const take = reverseCommission(snap.data(), { amount, baseAmount: receiptSnap.data().closingAmount });
        if (take.amount <= 0) return;
        clawedBack = round2(clawedBack + take.amount);
        tx.update(commissionRefs[i], {
          reversedAmount: round2((Number(snap.data().reversedAmount) || 0) + take.amount),
          ...(take.exhausted
            ? {
                status: COMMISSION_STATUS.CANCELLED,
                cancelledAt: serverNow(),
                cancelReason: `Closing #${seq} reverted — ${receiptSnap.data().receiptNo}`,
              }
            : { reversalNote: `Closing #${seq} reverted` }),
        });
      });

      tx.update(memberRef, {
        ...reversed.ledger,
        paidCount: inc(reversed.counters.paidCountDelta),
        paidAmount: inc(reversed.counters.paidAmountDelta),
        dueCount: due.dueCount,
        dueAmount: due.dueAmount,
        ...(refundMode === 'cancel' ? {} : { creditBalance: inc(amount) }),
        updatedAt: serverNow(), updatedBy: uid,
      });
      tx.update(receiptRef, {
        reversedSeqs: [...(receiptSnap.data().reversedSeqs ?? []), seq],
        reversedAmount: inc(amount),
        lastReversalAt: serverNow(),
        lastReversalReason: `Closing #${seq} reverted`,
      });
      tx.update(closingRef, {
        paidCount: inc(reversed.counters.paidCountDelta),
        paidAmount: inc(-amount),
        updatedAt: serverNow(),
      });
      tx.set(statsRef, {
        money: {
          collectedTotal: inc(-amount),
          creditTotal: inc(refundMode === 'cancel' ? 0 : amount),
        },
        ...(clawedBack > 0
          ? { commission: { earnedTotal: inc(-clawedBack), dueTotal: inc(-clawedBack) } }
          : {}),
        updatedAt: serverNow(),
      }, { merge: true });

      if (agentRef && agentSnap?.exists) {
        tx.update(agentRef, {
          earnedTotal: inc(-clawedBack),
          dueTotal: inc(-clawedBack),
          // One closing no longer counts as one the agent collected. The money
          // is a closing's worth, not the receipt's whole total.
          collectionCount: inc(-1),
          collectedAmount: inc(-amount),
          updatedAt: serverNow(),
        });
      }

      totalClawedBack = round2(totalClawedBack + clawedBack);
    });
  }

  /* ── 3 & 4. Retire the closing, restore the member ─────────────────────── */

  const memberRef = db.doc(paths.member(trustId, closing.memberId));
  const indexRef = db.doc(paths.closingsIndex(trustId, programId));
  const auditRef = db.doc(`${paths.auditLogs(trustId, programId)}/closing_revert_${closingId}`);
  // Re-read after processing: a receipt cancelled while the revert was
  // starting must not be counted as money reversed by this operation.
  const finalPaidSnap = await db.collection(paths.payments(trustId, programId))
    .where('seqs', 'array-contains', seq)
    .where('status', '==', PAYMENT_STATUS.COMPLETED)
    .get();
  const finalAffected = finalPaidSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (finalAffected.some((receipt) => !receipt.reversedSeqs?.includes(seq))) {
    throw conflict('A new receipt appeared during reversal — retry to finish it');
  }
  // Includes receipts reversed by an earlier attempt that stopped halfway.
  const totalReversed = finalAffected.reduce((sum, receipt) => sum +
    Number((receipt.items ?? []).find((item) => item.seq === seq)?.amount ?? 0), 0);

  await db.runTransaction(async (tx) => {
    const [memberSnap, freshClosing, indexSnap, ownPayments] = await Promise.all([
      tx.get(memberRef), tx.get(closingRef), tx.get(indexRef),
      tx.get(db.collection(paths.payments(trustId, programId)).where('memberId', '==', closing.memberId)),
    ]);
    if (freshClosing.data()?.status !== CLOSING_STATUS.REVERTING) {
      throw conflict('Closing reversal has already finished');
    }

    tx.update(closingRef, {
      status: CLOSING_STATUS.REVERTED,
      revertedAt: serverNow(),
      revertedAtMs: Date.now(),
      revertedBy: uid,
      revertReason: closing.revertReason ?? opts.reason ?? '',
      revertedPayerCount: finalAffected.length,
      revertedAmount: totalReversed,
      updatedAt: serverNow(),
    });
    const currentClosings = (indexSnap.data()?.items ?? []).map((c) => c.id === closingId
      ? { ...c, status: CLOSING_STATUS.REVERTED } : c);
    tx.set(indexRef, { items: currentClosings, version: Date.now(), updatedAt: serverNow() }, { merge: true });

    // A reverted closing is off the notice — the sheet must not bill for it.
    // The `batchId` stays on the document so the history still says which
    // notice it WOULD have gone out on.
    bumpBatch(tx, scope, closing.batchId ?? null, -1);

    if (memberSnap.exists) {
      const restored = {
        id: memberSnap.id, ...memberSnap.data(),
        status: MEMBER_STATUS.ACCEPTED,
        closingId: null, closingSeq: null, closingDateMs: null,
        exitDateMs: null, exitReason: null,
      };
      // Closing a member may have compacted later ineligible seqs. Once they
      // are restored those seqs must be due, not mistaken for paid receipts.
      const rebuilt = rebuildLedger(restored, currentClosings, ownPayments.docs.map((d) => d.data()));
      tx.update(memberRef, {
        ...rebuilt.ledger,
        ...rebuilt.counters,
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
        money: {
          dueTotal: inc(-(Number(closing.eligibleAmount) || 0) + totalReversed),
          // Taken back off what the trust expects, matching what create added.
          expectedTotal: inc(-(Number(closing.eligibleAmount) || 0)),
        },
        updatedAt: serverNow(),
      },
      { merge: true },
    );
    tx.set(auditRef, {
      action: 'closing.revert',
      closingId, seq,
      memberId: closing.memberId,
      memberName: closing.displayName ?? '',
      reason: closing.revertReason ?? opts.reason ?? '',
      refundMode,
      affectedReceipts: finalAffected.length,
      affectedMembers: new Set(finalAffected.map((p) => p.memberId)).size,
      reversedAmount: totalReversed,
      commissionClawedBack: totalClawedBack,
      at: serverNow(), atMs: Date.now(), by: uid,
    });
  });

  invalidateIndexCache(trustId, programId);

  const ids = [...new Set([...finalAffected.map((p) => p.memberId), closing.memberId])];
  const snaps = await db.getAll(...ids.map((id) => db.doc(paths.member(trustId, id))));
  await patchMembersInIndex(trustId, snaps.filter((snap) => snap.exists).map((snap) => ({
    id: snap.id, member: snap.data(),
  })));

  return {
    closingId,
    seq,
    affectedReceipts: finalAffected.length,
    affectedMembers: new Set(finalAffected.map((p) => p.memberId)).size,
    reversedAmount: totalReversed,
    commissionClawedBack: totalClawedBack,
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

  const report = await collectionReport(scope, { closingId });
  const rows = report.rows.map((member) => ({
    id: member.id, memberId: member.id,
    registrationNumber: member.registrationNumber,
    displayName: member.displayName, name: member.displayName,
    fatherName: member.fatherName, phone: member.phone, village: member.village,
    ageGroupRange: member.ageGroupRange, age: member.age, photoURL: member.photoURL,
    agentId: member.agentId, agentName: member.agentName,
    amount: member.items[0].amount, paidAmount: member.items[0].paid,
    remaining: member.items[0].remaining, status: member.items[0].status,
  }));

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
      eligibleCount: rows.length,
      eligibleAmount: report.totals.amount,
      paidCount: rows.filter((r) => r.status === 'paid').length,
      paidAmount: report.totals.paidAmount,
      pendingCount: rows.filter((r) => r.remaining > 0).length,
      pendingAmount: report.totals.dueAmount,
      status: closing.status,

      /**
       * What happened when it was taken back.
       *
       * All of this was already being written by `revertClosing` and none of
       * it was ever read: the only sign a closing had been reverted was a red
       * tag, with no date, no reason, no who, and no figure for what was
       * credited back to members. A reversal of money that the system cannot
       * explain afterwards is not an audit trail, it is a rumour.
       */
      revertedAtMs: closing.revertedAtMs ?? null,
      revertedBy: closing.revertedBy ?? null,
      revertReason: closing.revertReason ?? '',
      revertedPayerCount: closing.revertedPayerCount ?? 0,
      revertedAmount: closing.revertedAmount ?? 0,
    },
    rows,
    nextCursor: null,
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
      entry.paidAmount += row.paidAmount ?? 0;
    } else if (row.status === 'exempt') {
      entry.exempt += 1;
    } else {
      entry.pending += 1;
      entry.pendingAmount += row.remaining ?? row.amount ?? 0;
      entry.paidAmount += row.paidAmount ?? 0;
    }
  }

  // Bands read as "18-30", "31-45" — sort by the number they start with, so
  // the sheet runs youngest to oldest rather than alphabetically.
  return [...map.values()].sort(
    (a, b) => (parseInt(a.band, 10) || 999) - (parseInt(b.band, 10) || 999),
  );
}

/**
 * Edit a closing after the fact.
 *
 * The old system let an operator reopen a closed case and correct the date,
 * the notes, the invitation card and the group. This system could create a
 * closing and revert one, and nothing in between — so a card scanned upside
 * down, or a date typed as 08 instead of 03, meant reverting the whole thing
 * (unwinding every payment against it) and closing the member again.
 *
 * The date cannot be changed in place: previously ineligible sequences may
 * already be compacted into members' paid watermarks. Revert and recreate.
 */
export async function updateClosing(scope, closingId, input) {
  const { trustId, programId, uid } = scope;

  const ref = db.doc(paths.closing(trustId, programId, closingId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('क्लोजिंग नहीं मिली');

  const closing = snap.data();
  if (closing.status !== CLOSING_STATUS.ACTIVE) {
    throw conflict('सिर्फ़ चालू क्लोजिंग संपादित की जा सकती है');
  }

  const patch = { updatedAt: serverNow(), updatedBy: uid };

  for (const field of ['closingType', 'notes', 'invitationCardURL']) {
    if (input[field] !== undefined) patch[field] = input[field];
  }

  /** The money on the समापन पत्र — what the family was handed, and against what. */
  if (input.payout) {
    patch.payout = {
      ...(closing.payout ?? {}),
      ...input.payout,
    };
  }

  if (input.closingDate !== undefined && input.closingDate !== closing.closingDate ||
      input.closingDateMs !== undefined && Number(input.closingDateMs) !== Number(closing.closingDateMs)) {
    // Membership ledgers compress ineligible sequences into a watermark. A
    // date edit can turn those sequences into newly owed contributions without
    // touching any member, silently hiding the debt. Revert and recreate with
    // the corrected date instead of changing the immutable billing rule.
    throw conflict('क्लोजिंग की तारीख़ बदलने के लिए इसे वापस लेकर सही तारीख़ पर नई क्लोजिंग बनाएँ');
  }

  /* ── the batch ──────────────────────────────────────────────────────── */

  if (input.batchId !== undefined && (input.batchId ?? null) !== (closing.batchId ?? null)) {
    // Reuses the same path the batch screen uses, so the counters and the
    // index stay correct however the move was made.
    await setClosingBatch(scope, input.batchId ?? null, [closingId]);
  }

  await ref.update(patch);

  return { id: closingId, ...closing, ...patch, updatedAt: null };
}
