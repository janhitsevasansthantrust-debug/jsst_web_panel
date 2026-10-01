import 'server-only';

import { db, FieldValue, serverNow, inc, chunk } from '../firebase/admin.js';
import { applyPayment, reversePayment } from './ledger.js';
import { getClosingsIndex, patchMemberInIndex, patchMembersInIndex } from './indexes.js';
import {
  resolvePolicy, commissionForPayment, commissionForJoinFee, round2,
} from './commission.js';
import { badRequest, conflict, notFound } from '../http.js';
import { joinFeesState, applyJoinFeePayment } from '../../lib/joinFees.js';
import { allocateDeposit, allocateExplicit } from '../../lib/bulkAllocate.js';
import { assertSameProgram } from './scope.js';
import {
  LIMITS,
  PAYMENT_STATUS,
  COMMISSION_STATUS,
  paths,
} from '../../config/constants.js';

/**
 * payments.js — where money is recorded.
 *
 * This module fixes the specific bug you described: "closing member ke baad
 * pending/paid ka issue".
 *
 * In the old system a payment was a `batch.update` over `payment_pending`
 * documents. A batch is not a transaction: it has no read consistency, so the
 * browser decided what was pending, and by the time the write landed that
 * decision could already be wrong. Two tabs, a double-tap, a retried request
 * after a timeout — each of them charged twice or left an obligation stuck.
 *
 * Here, every payment is a single Firestore TRANSACTION which:
 *
 *   1. re-reads the member's ledger inside the transaction
 *   2. recomputes on the SERVER which of the requested closings are genuinely
 *      due — the browser's opinion is only a request, never the decision
 *   3. rejects (and reports) anything already paid, exempt or not eligible
 *   4. writes the receipt, the ledger, the closing counters, the program
 *      stats and the agent's commission entry together, or writes nothing
 *
 * Plus an idempotency key, so a retried request returns the ORIGINAL receipt
 * instead of creating a second one.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Post a payment
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {{trustId:string, programId:string, uid:string}} scope
 * @param {object} input
 * @param {string} input.memberId
 * @param {number[]} input.seqs                closings being paid
 * @param {Object<number,number>} [input.amounts]  partial amounts by seq
 * @param {string} input.method
 * @param {number} input.paidAtMs
 * @param {string} [input.reference]
 * @param {string} [input.note]
 * @param {number} [input.joinFeeAmount]
 * @param {string} [input.collectedByAgentId]
 * @param {string} [input.idempotencyKey]
 */
export async function postPayment(scope, input, context = {}) {
  const { trustId, programId, uid } = scope;

  /**
   * The closings index and the group codes are the same for every member, so a
   * caller posting a run of receipts hands them in rather than making this
   * re-read them per member. Banking an agent's round of forty was doing two
   * extra round trips per member for data that had not changed.
   */
  const closings =
    context.closings ?? (await getClosingsIndex(trustId, programId)).items;

  /**
   * Closing-group codes, for the receipt number.
   *
   * Read here rather than inside the transaction: a transaction cannot run a
   * query, and there are a handful of groups in a programme — one small read
   * per payment, and it is the same read whether the payment covers one
   * closing or four hundred.
   */
  const groupCodes = context.groupCodes ?? (await loadGroupCodes(trustId, programId));

  const requested = [...new Set(input.seqs ?? [])];
  const joinFeeOnly = !requested.length && Number(input.joinFeeAmount) > 0;

  if (!requested.length && !joinFeeOnly) {
    throw badRequest('कम से कम एक क्लोजिंग चुनें');
  }

  /**
   * A receipt for closings needs closings to exist. A JOINING FEE does not.
   *
   * This guard used to run before that distinction was made, and it refused
   * every payment in a programme with no closings — including the joining-fee
   * receipt that is now written when a member is enrolled with their fee
   * marked paid. So the very first member of a brand-new योजना could not be
   * added at all, and the message blamed closings, which the operator had not
   * mentioned and did not want.
   */
  if (!joinFeeOnly && !closings.length) {
    throw badRequest('इस योजना में अभी कोई क्लोजिंग नहीं है');
  }

  // A receipt covering more closings than one transaction can safely write is
  // split into linked receipts rather than silently truncated.
  const batches = chunk(requested, LIMITS.MAX_RECEIPT_ITEMS);
  if (!batches.length) batches.push([]);

  const linkGroupId = batches.length > 1 ? newId() : null;
  const receipts = [];
  const allRejected = [];

  for (let i = 0; i < batches.length; i += 1) {
    const result = await postOneReceipt(scope, {
      ...input,
      seqs: batches[i],
      // The joining fee rides on the first receipt only.
      joinFeeAmount: i === 0 ? input.joinFeeAmount : 0,
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:${i}`
        : null,
      linkGroupId,
      linkIndex: i,
      linkCount: batches.length,
    }, closings, uid, groupCodes);

    if (result.receipt) receipts.push(result.receipt);
    allRejected.push(...result.rejected);
  }

  if (!receipts.length) {
    throw conflict(
      'Nothing was payable — every selected closing is already paid or not applicable',
      { rejected: allRejected },
    );
  }

  /**
   * Refresh this member in the search index. Every list, filter and total in
   * the app is served from that index, so a payment that does not reach it is
   * a payment the operator cannot see they took — they would collect it twice.
   *
   * Outside the transaction on purpose: the money is already recorded, and a
   * failed index write must not roll back a receipt. `reindex` heals it.
   *
   * `deferIndex` lets a caller posting many receipts do this ONCE for all of
   * them instead of once each — see `bulkCollect`. The patch rewrites a whole
   * index shard, so doing it per member meant rewriting the same document over
   * and over, each write contending with the last.
   */
  if (!context.deferIndex) {
    await patchMemberInIndex(
      scope.trustId,
      input.memberId,
      await readMember(scope, input.memberId),
    ).catch(() => {});
  }

  return {
    receipts,
    receipt: receipts[0],
    rejected: allRejected,
    totalAmount: round2(receipts.reduce((s, r) => s + r.totalAmount, 0)),
  };
}

/** The member document as it stands now — used to refresh the search index. */
async function readMember(scope, memberId) {
  const snap = await db.doc(paths.member(scope.trustId, memberId)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : {};
}

async function postOneReceipt(scope, input, closings, uid, groupCodes = new Map()) {
  const { trustId, programId } = scope;

  const memberRef = db.doc(paths.member(trustId, input.memberId));
  const seqRef = db.doc(paths.counterSeq(trustId, programId));
  const statsRef = db.doc(paths.counterStats(trustId, programId));
  const receiptRef = db.collection(paths.payments(trustId, programId)).doc();

  const idemRef = input.idempotencyKey
    ? db.doc(`${paths.idempotency(trustId, programId)}/${input.idempotencyKey}`)
    : null;

  return db.runTransaction(async (tx) => {
    /* ─── ALL READS FIRST (Firestore requires it) ─────────────────────── */

    const [idemSnap, memberSnap, seqSnap] = await Promise.all([
      idemRef ? tx.get(idemRef) : Promise.resolve(null),
      tx.get(memberRef),
      tx.get(seqRef),
    ]);

    // Replay of a request we already processed → hand back the original.
    if (idemSnap?.exists) {
      return {
        receipt: idemSnap.data().receipt,
        rejected: idemSnap.data().rejected ?? [],
        replayed: true,
      };
    }

    if (!memberSnap.exists) throw notFound('Member not found');
    const member = { id: memberSnap.id, ...memberSnap.data() };

    const agentId = input.collectedByAgentId ?? member.agentId ?? null;
    const agentRef = agentId ? db.doc(paths.agent(trustId, agentId)) : null;
    const programRef = db.doc(paths.program(trustId, programId));

    const [agentSnap, programSnap] = await Promise.all([
      agentRef ? tx.get(agentRef) : Promise.resolve(null),
      agentRef ? tx.get(programRef) : Promise.resolve(null),
    ]);

    /* ─── DECIDE (server-side, against freshly-read state) ─────────────── */

    const applied = applyPayment(member, input.seqs, closings, {
      amounts: input.amounts,
    });

    const joinFee = round2(Number(input.joinFeeAmount) || 0);
    if (!applied.accepted.length && joinFee <= 0) {
      return { receipt: null, rejected: applied.rejected };
    }

    /**
     * A joining fee can be paid in instalments — ₹2,100 now against ₹11,000 —
     * so what is accepted here is bounded by what is still outstanding, read
     * inside this transaction rather than trusted from the form. Two counter
     * staff taking the last instalment at the same moment is exactly the case
     * a transaction exists for, and without this check the second one would
     * take money for a fee that no longer existed.
     */
    const fees = joinFeesState(member);
    if (joinFee > 0 && joinFee > fees.due + 0.009) {
      throw badRequest(
        fees.due > 0
          ? `नामांकन शुल्क में सिर्फ़ ${fees.due} बाकी है — इससे ज़्यादा नहीं लिया जा सकता`
          : 'नामांकन शुल्क पहले ही पूरा जमा हो चुका है',
      );
    }

    const closingTotal = round2(applied.totalAmount);
    const totalAmount = round2(closingTotal + joinFee);

    /**
     * The receipt number, numbered within its closing group.
     *
     * A trust running several groups wants each one's receipts to run 1, 2, 3
     * — the group's own book — rather than sharing one series in which its
     * receipts appear at 412, 418, 431. So each group counts separately and
     * carries its code: `MLP-2026-000012`.
     *
     * A payment covering closings from more than one group has no single
     * group's book to sit in, so it falls back to the programme-wide series.
     * Putting it in one of the two groups' books would make that book's
     * numbering wrong.
     */
    const groupIds = new Set(
      applied.accepted
        .map((a) => closings.find((c) => c.seq === a.seq)?.groupId)
        .filter(Boolean),
    );

    const groupId = groupIds.size === 1 ? [...groupIds][0] : null;
    const groupCode = groupId ? (groupCodes.get(groupId) ?? null) : null;

    const lastNumber = groupId
      ? (seqSnap.data()?.receiptByGroup?.[groupId] ?? 0)
      : (seqSnap.data()?.receipt ?? 0);

    const nextReceiptNo = lastNumber + 1;
    const receiptNo = formatReceiptNo(
      seqSnap.data()?.receiptPrefix ?? 'RSD',
      input.paidAtMs,
      nextReceiptNo,
      groupCode,
    );

    /* ─── COMMISSION ──────────────────────────────────────────────────── */

    /** Zero, one or two entries: closings collected, and the joining fee. */
    let commissionDocs = [];
    let commissionTotal = 0;

    // A receipt that is nothing but a joining fee still earns commission, so
    // this no longer requires a closing total to be present.
    if (agentSnap?.exists && (closingTotal > 0 || joinFee > 0)) {
      const agent = agentSnap.data();
      const policy = resolvePolicy(
        programSnap?.data()?.commissionPolicy,
        agent.commissionOverride,
      );
      /**
       * One receipt can earn commission on TWO things, and it used to earn on
       * only one.
       *
       * `commissionForJoinFee` existed, was tested, and was never called — so a
       * trust that paid its agents for enrolling members paid them nothing,
       * silently, because the receipt that carried the joining fee only ever
       * looked at the closing total. Both streams are computed here and each
       * gets its own entry, so a payout report can still say which is which.
       */
      const entries = [];

      const onClosings = commissionForPayment(policy, {
        collectedAmount: closingTotal,
        closingCount: applied.accepted.length,
        runningCount: agent.collectionCount ?? 0,
      });

      if (onClosings) {
        entries.push({
          computed: onClosings,
          sourceType: 'payment',
          baseAmount: closingTotal,
          units: applied.accepted.length,
        });
      }

      if (joinFee > 0) {
        const onJoinFee = commissionForJoinFee(policy, {
          joinFeeAmount: joinFee,
          // Counted in members enrolled, not closings collected — a slab on
          // the joining stream is "your 50th member", not "your 50th receipt".
          runningCount: agent.memberCount ?? 0,
        });

        if (onJoinFee) {
          entries.push({
            computed: onJoinFee,
            sourceType: 'joinFee',
            baseAmount: joinFee,
            units: 1,
          });
        }
      }

      commissionDocs = entries.map((e) => ({
        ref: db.collection(paths.commissionEntries(trustId, programId)).doc(),
        data: {
          agentId,
          agentName: agent.displayName ?? '',
          type: e.computed.type,
          sourceType: e.sourceType,
          sourceId: receiptRef.id,
          receiptNo,
          memberId: member.id,
          memberName: member.displayName ?? '',
          memberRegNo: member.registrationNumber ?? '',
          baseAmount: e.baseAmount,
          units: e.units,
          rateMode: e.computed.mode,
          rateValue: e.computed.rate,
          basis: e.computed.basis,
          amount: e.computed.amount,
          earnedAtMs: input.paidAtMs,
          status: policy.autoApprove
            ? COMMISSION_STATUS.APPROVED
            : COMMISSION_STATUS.EARNED,
          payoutId: null,
          createdAt: serverNow(),
          createdBy: uid,
        },
      }));

      commissionTotal = round2(
        commissionDocs.reduce((sum, d) => sum + d.data.amount, 0),
      );
    }

    /* ─── WRITES ──────────────────────────────────────────────────────── */

    const receipt = {
      receiptNo,
      receiptSeq: nextReceiptNo,

      memberId: member.id,
      memberSnapshot: {
        name: member.displayName ?? '',
        regNo: member.registrationNumber ?? '',
        fatherName: member.fatherName ?? '',
        village: member.village ?? '',
        phone: member.phone ?? '',
        photoURL: member.photoURL ?? '',
      },

      collectedByAgentId: agentId,
      collectedByAgentName: agentSnap?.data()?.displayName ?? '',

      paidAtMs: input.paidAtMs,
      method: input.method,
      reference: input.reference ?? '',
      referenceVerified: false,
      note: input.note ?? '',

      items: applied.accepted,
      seqs: applied.accepted.map((a) => a.seq),
      itemCount: applied.accepted.length,

      closingAmount: closingTotal,
      joinFeeAmount: joinFee,
      totalAmount,

      // Which group's receipt book this number came from — so a reprint or a
      // report can say so without re-deriving it from the closings.
      groupId,
      groupCode,

      // Both ids, and the first one on its own — the cancel path and any
      // stored receipt written before join-fee commission existed still read
      // `commissionEntryId`.
      commissionEntryIds: commissionDocs.map((d) => d.ref.id),
      commissionEntryId: commissionDocs[0]?.ref.id ?? null,
      commissionAmount: commissionTotal,

      linkGroupId: input.linkGroupId ?? null,
      linkIndex: input.linkIndex ?? 0,
      linkCount: input.linkCount ?? 1,

      status: PAYMENT_STATUS.COMPLETED,
      programId,
      createdAt: serverNow(),
      createdBy: uid,
      delete_flag: false,
    };

    tx.set(receiptRef, receipt);

    tx.update(memberRef, {
      paidUpTo: applied.ledger.paidUpTo,
      paidSeqs: applied.ledger.paidSeqs,
      exemptSeqs: applied.ledger.exemptSeqs,
      partialPaid: applied.ledger.partialPaid,
      paidCount: inc(applied.counters.paidCountDelta),
      paidAmount: inc(applied.counters.paidAmountDelta),
      dueCount: applied.counters.dueCount,
      dueAmount: applied.counters.dueAmount,
      lastPaymentAt: input.paidAtMs,
      lastReceiptNo: receiptNo,
      /**
       * The joining fee is an AMOUNT, not a flag.
       *
       * `applyJoinFeePayment` adds this receipt to what the member has already
       * put down and works out what is left; `joinFeesDone` is set only when
       * nothing is. Writing `joinFeesDone: true` on any payment — which is
       * what this did — wrote off ₹8,900 of a ₹11,000 fee the moment somebody
       * paid the first ₹2,100.
       */
      ...(joinFee > 0
        ? { ...applyJoinFeePayment(member, joinFee), joinFeesReceiptId: receiptRef.id }
        : {}),
      updatedAt: serverNow(),
      updatedBy: uid,
    });

    // Per-closing collection counters. `increment` is contention-friendly and
    // each receipt touches a different set of closings, so these stay cool.
    for (const item of applied.accepted) {
      tx.update(db.doc(paths.closing(trustId, programId, item.closingId)), {
        paidCount: inc(item.full ? 1 : 0),
        paidAmount: inc(item.amount),
        updatedAt: serverNow(),
      });
    }

    // Only the counter this receipt was drawn from moves. A dotted path in a
    // `set(..., {merge:true})` would write a literal key with a dot in it, so
    // the nested shape is built explicitly.
    tx.set(
      seqRef,
      groupId
        ? { receiptByGroup: { [groupId]: nextReceiptNo }, updatedAt: serverNow() }
        : { receipt: nextReceiptNo, updatedAt: serverNow() },
      { merge: true },
    );


    tx.set(
      statsRef,
      {
        money: {
          collectedTotal: inc(closingTotal),
          joinFeesTotal: inc(joinFee),
          dueTotal: inc(-closingTotal),
        },
        receipts: { total: inc(1) },
        ...(commissionTotal
          ? { commission: { earnedTotal: inc(commissionTotal), dueTotal: inc(commissionTotal) } }
          : {}),
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    for (const doc of commissionDocs) tx.set(doc.ref, doc.data);

    if (agentRef && (commissionTotal > 0 || applied.accepted.length > 0)) {
      tx.update(agentRef, {
        earnedTotal: inc(commissionTotal),
        dueTotal: inc(commissionTotal),
        collectionCount: inc(applied.accepted.length),
        collectedAmount: inc(closingTotal),
        updatedAt: serverNow(),
      });
    }

    const stored = { id: receiptRef.id, ...receipt, createdAt: null };

    if (idemRef) {
      tx.set(idemRef, {
        receipt: stored,
        rejected: applied.rejected,
        createdAt: serverNow(),
        // TTL policy on this collection cleans these up after 24h.
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    return { receipt: stored, rejected: applied.rejected, replayed: false };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Cancel a payment  — a reversal, never a delete
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Money records are immutable. Cancelling writes a reversal and un-does the
 * ledger, the closing counters, the stats and the commission entry in ONE
 * transaction. The original receipt stays, marked cancelled, so the trust can
 * always explain what happened.
 */
export async function cancelPayment(scope, receiptId, { reason, uid }) {
  const { trustId, programId } = scope;
  const { items: closings } = await getClosingsIndex(trustId, programId);

  const receiptRef = db.doc(paths.payment(trustId, programId, receiptId));
  const statsRef = db.doc(paths.counterStats(trustId, programId));

  const result = await db.runTransaction(async (tx) => {
    const receiptSnap = await tx.get(receiptRef);
    if (!receiptSnap.exists) throw notFound('Receipt not found');

    const receipt = receiptSnap.data();
    if (receipt.status === PAYMENT_STATUS.CANCELLED) {
      throw conflict('This receipt is already cancelled');
    }

    const memberRef = db.doc(paths.member(trustId, receipt.memberId));
    // A receipt can carry two commission entries — closings and joining fee.
    // Older receipts have only the single `commissionEntryId`, so both shapes
    // are read; reversing one of two would leave an agent paid for a payment
    // that no longer exists.
    const commissionIds =
      receipt.commissionEntryIds?.length
        ? receipt.commissionEntryIds
        : [receipt.commissionEntryId].filter(Boolean);

    const commissionRefs = commissionIds.map((id) =>
      db.doc(`${paths.commissionEntries(trustId, programId)}/${id}`),
    );
    const agentRef = receipt.collectedByAgentId
      ? db.doc(paths.agent(trustId, receipt.collectedByAgentId))
      : null;

    const [memberSnap, ...commissionSnaps] = await Promise.all([
      tx.get(memberRef),
      ...commissionRefs.map((ref) => tx.get(ref)),
    ]);

    if (!memberSnap.exists) throw notFound('Member not found');
    const member = { id: memberSnap.id, ...memberSnap.data() };

    const seqs = receipt.seqs ?? receipt.items?.map((i) => i.seq) ?? [];
    const reversed = reversePayment(member, seqs, closings);

    const closingAmount = Number(receipt.closingAmount) || 0;
    const joinFee = Number(receipt.joinFeeAmount) || 0;

    /* writes */

    tx.update(receiptRef, {
      status: PAYMENT_STATUS.CANCELLED,
      cancelledAt: serverNow(),
      cancelledAtMs: Date.now(),
      cancelledBy: uid,
      cancelReason: reason ?? '',
    });

    tx.update(memberRef, {
      paidUpTo: reversed.ledger.paidUpTo,
      paidSeqs: reversed.ledger.paidSeqs,
      exemptSeqs: reversed.ledger.exemptSeqs,
      partialPaid: reversed.ledger.partialPaid,
      paidCount: inc(reversed.counters.paidCountDelta),
      paidAmount: inc(reversed.counters.paidAmountDelta),
      dueCount: reversed.counters.dueCount,
      dueAmount: reversed.counters.dueAmount,
      /**
       * Cancelling the receipt that carried a joining fee takes that amount
       * back off, or the member shows as having paid a fee whose receipt no
       * longer exists.
       *
       * Only THIS receipt's amount is reversed — not the whole fee. A member
       * who paid ₹2,100 and then ₹3,000 and has the second receipt cancelled
       * is back to ₹2,100 paid, not to nothing paid.
       */
      ...(joinFee > 0
        ? { ...applyJoinFeePayment(member, -joinFee), joinFeesReceiptId: null }
        : {}),
      updatedAt: serverNow(),
      updatedBy: uid,
    });

    for (const item of receipt.items ?? []) {
      tx.update(db.doc(paths.closing(trustId, programId, item.closingId)), {
        paidCount: inc(item.full ? -1 : 0),
        paidAmount: inc(-(Number(item.amount) || 0)),
        updatedAt: serverNow(),
      });
    }

    tx.set(
      statsRef,
      {
        money: {
          collectedTotal: inc(-closingAmount),
          joinFeesTotal: inc(-joinFee),
          dueTotal: inc(closingAmount),
        },
        receipts: { cancelled: inc(1) },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    // An entry already PAID OUT is left alone deliberately: money that has
    // left the trust cannot be un-earned by cancelling the receipt, and
    // pretending otherwise would put the agent's balance out by that amount.
    let reversedCommission = 0;

    commissionSnaps.forEach((snap, i) => {
      if (!snap?.exists) return;
      if (snap.data().status === COMMISSION_STATUS.PAID) return;

      reversedCommission += Number(snap.data().amount) || 0;
      tx.update(commissionRefs[i], {
        status: COMMISSION_STATUS.CANCELLED,
        cancelledAt: serverNow(),
        cancelReason: `Receipt ${receipt.receiptNo} cancelled`,
      });
    });

    if (agentRef) {
      tx.update(agentRef, {
        earnedTotal: inc(-reversedCommission),
        dueTotal: inc(-reversedCommission),
        collectionCount: inc(-(receipt.itemCount ?? 0)),
        collectedAmount: inc(-closingAmount),
        updatedAt: serverNow(),
      });
    }

    if (reversedCommission > 0) {
      tx.set(
        statsRef,
        {
          commission: {
            earnedTotal: inc(-reversedCommission),
            dueTotal: inc(-reversedCommission),
          },
        },
        { merge: true },
      );
    }


    return {
      receiptId,
      receiptNo: receipt.receiptNo,
      memberId: receipt.memberId,
      reversedSeqs: reversed.reversed.map((r) => r.seq),
      refundAmount: Math.abs(reversed.counters.paidAmountDelta),
    };
  });

  // Same reason as postPayment: the reversal has to reach the search index, or
  // the member keeps showing as paid on every screen that matters.
  await patchMemberInIndex(
    scope.trustId,
    result.memberId,
    await readMember(scope, result.memberId),
  ).catch(() => {});

  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   Bulk collection — one deposit, many members
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * An agent's round, banked in one go.
 *
 * The agent collected from forty members and hands over ₹20,000. Recording
 * that one member at a time meant forty searches, forty ledgers and forty
 * submits with the agent standing there, so in practice it did not get
 * recorded — it got written in a notebook and entered later, or not at all.
 *
 * Three things make this safe rather than merely fast:
 *
 *  1. **The split is computed from the ledger, never from the browser.** Every
 *     selected member's dues are re-derived here, from the closings index and
 *     their own per-closing rate, immediately before the money is placed.
 *
 *  2. **Preview and posting run the same function.** `preview: true` returns
 *     the plan and writes nothing; posting re-computes it from freshly read
 *     members. Because the operator can edit the figures, what they approved
 *     is sent back as `byMember` and honoured exactly — but still clamped to
 *     what each member actually owes.
 *
 *  3. **Each member still gets their own receipt**, through `postPayment`,
 *     with its own transaction, its own number and its own commission entry.
 *     There is no such thing here as a receipt belonging to several members:
 *     the person who paid has to be able to hold the paper for their own
 *     money. What is shared is the deposit, and `batchRef` ties them together.
 *
 * One member failing does not abandon the rest. Each is posted independently
 * and the failures come back named, because the alternative — rolling back
 * thirty-nine good receipts because the fortieth member was closed an hour
 * ago — is worse at the counter than a short list to redo.
 */
export async function bulkCollect(scope, input) {
  const { trustId, programId } = scope;

  const memberIds = [...new Set(input.memberIds ?? [])];
  if (!memberIds.length) throw badRequest('कम से कम एक सदस्य चुनें');
  if (memberIds.length > LIMITS.BULK_MEMBERS) {
    throw badRequest(
      `एक बार में ज़्यादा से ज़्यादा ${LIMITS.BULK_MEMBERS} सदस्य — अभी ${memberIds.length} चुने हैं`,
    );
  }

  const [{ items: closings }, groupCodes, snaps] = await Promise.all([
    getClosingsIndex(trustId, programId),
    loadGroupCodes(trustId, programId),
    // One round trip for every selected member, rather than one read each.
    db.getAll(...memberIds.map((id) => db.doc(paths.member(trustId, id)))),
  ]);

  const { computeDue } = await import('./ledger.js');

  const rows = [];
  const missing = [];

  for (const snap of snaps) {
    if (!snap.exists) {
      missing.push({ memberId: snap.id, reason: 'सदस्य नहीं मिला' });
      continue;
    }

    const member = { id: snap.id, ...snap.data() };

    // A member filed under a different योजना must not be paid from this
    // programme's counter — their dues belong to another book entirely.
    if (member.programId !== programId) {
      missing.push({ memberId: snap.id, name: member.displayName, reason: 'दूसरी योजना का सदस्य' });
      continue;
    }

    const due = computeDue(member, closings);
    const fees = joinFeesState(member);

    rows.push({
      memberId: member.id,
      name: member.displayName ?? '',
      regNo: member.registrationNumber ?? '',
      phone: member.phone ?? '',
      village: member.village ?? '',
      agentId: member.agentId ?? null,
      agentName: member.agentName ?? '',

      dueCount: due.dueCount,
      dueTotal: due.dueAmount,
      due: due.dueItems.map((d) => ({
        seq: d.seq,
        remaining: d.remaining,
        dateMs: d.dateMs,
        partial: d.partial,
      })),

      /**
       * The joining fee is collected on the same round, out of the same
       * pocket, so it is part of what this deposit can settle. Dated by the
       * member's joining date, which is what puts it ahead of their closings
       * — they could not owe a closing from before they joined.
       */
      joinFeeTotal: fees.total,
      joinFeePaid: fees.paid,
      joinFeeDue: fees.due,
      joinDateMs: member.joinDateMs ?? 0,
    });
  }

  // Keep the operator's order — the "member" rule pays down the list, so the
  // order they see is the order the money goes in.
  const position = new Map(memberIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (position.get(a.memberId) ?? 0) - (position.get(b.memberId) ?? 0));

  const include = input.include ?? 'both';

  const plan = input.byMember
    ? allocateExplicit(rows, input.byMember, { include })
    : allocateDeposit(rows, Number(input.amount) || 0, { rule: input.rule, include });

  if (input.preview) {
    return {
      preview: true,
      plan,
      rows: rows.map(({ due, ...rest }) => rest),
      missing,
    };
  }

  if (!plan.lines.length) {
    throw badRequest(
      include === 'fees'
        ? 'चुने हुए सदस्यों का नामांकन शुल्क बाकी नहीं है'
        : include === 'closings'
          ? 'चुने हुए सदस्यों पर कोई क्लोजिंग बकाया नहीं है'
          : 'बाँटने लायक कुछ नहीं — चुने हुए सदस्यों पर कोई बकाया नहीं है',
    );
  }

  /* ─── post, one member at a time ──────────────────────────────────────── */

  const batchRef = input.idempotencyKey || newId();
  const receipts = [];
  const failed = [];

  /**
   * Shared context, read once above rather than per member.
   *
   * `deferIndex` is the important one: the search-index patch rewrites a whole
   * shard document, and doing it inside this loop rewrote the SAME shard once
   * per member — serially, with every write contending on the one document.
   * Four members banked together spent most of their time there, not on the
   * money. One pass at the end does all of them.
   */
  const context = { closings, groupCodes, deferIndex: true };

  const postOne = async (line) => {
    try {
      const result = await postPayment(scope, {
        memberId: line.memberId,
        seqs: line.seqs,
        amounts: line.amounts,
        // One receipt carries both: the member's closings and whatever part
        // of their joining fee this deposit covered.
        ...(line.joinFee > 0 ? { joinFeeAmount: line.joinFee } : {}),
        method: input.method,
        paidAtMs: input.paidAtMs,
        reference: input.reference ?? '',
        note: input.note ?? '',
        collectedByAgentId: input.collectedByAgentId ?? null,
        // Derived from the batch, so a retried submit returns the receipts
        // already written instead of taking the money a second time.
        idempotencyKey: `bulk:${batchRef}:${line.memberId}`,
      }, context);

      for (const receipt of result.receipts) {
        receipts.push({ ...receipt, memberName: line.name, regNo: line.regNo });
      }
    } catch (error) {
      failed.push({
        memberId: line.memberId,
        name: line.name,
        regNo: line.regNo,
        amount: line.total,
        error: error.message ?? 'नहीं हो सका',
      });
    }
  };

  /**
   * A few at a time, not one after another and not all at once.
   *
   * Each member is an independent transaction on their own documents, so there
   * is nothing to gain from making them queue — forty members one-by-one is
   * forty round-trip latencies added up. But they DO share two documents: the
   * receipt-number counter and the agent's commission totals, and a hundred
   * transactions contending on those would abort and retry each other into
   * something slower than the serial version. Six is wide enough to hide the
   * latency and narrow enough to stay off that cliff.
   */
  const CONCURRENCY = 6;
  for (let i = 0; i < plan.lines.length; i += CONCURRENCY) {
    await Promise.all(plan.lines.slice(i, i + CONCURRENCY).map(postOne));
  }

  /* One index pass for everybody who was actually paid. */
  if (receipts.length) {
    const paidIds = [...new Set(receipts.map((r) => r.memberId))];
    await Promise.all(paidIds.map((id) => readMember(scope, id)))
      .then((docs) =>
        patchMembersInIndex(
          trustId,
          docs.map((m, i) => ({ id: paidIds[i], member: m })).filter((x) => x.member),
        ),
      )
      .catch(() => {});
  }

  const collected = round2(receipts.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0));

  return {
    batchRef,
    receipts,
    receiptCount: receipts.length,
    memberCount: plan.lines.length - failed.length,
    collected,
    /** Of what was banked, how much went to joining fees rather than closings. */
    feeCollected: round2(
      receipts.reduce((s, r) => s + (Number(r.joinFeeAmount) || 0), 0),
    ),
    /** What the operator meant to bank, so a shortfall is visible at a glance. */
    intended: plan.allocated,
    shortfall: round2(plan.allocated - collected),
    leftover: plan.leftover,
    failed,
    missing,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Reads
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A member's full picture: what they owe (derived, zero extra reads) and what
 * they have paid (their receipts, paginated).
 *
 * Cost: 1 member read + 1 cached index read + N receipts. The old system read
 * every one of that member's ~500 payment_pending documents for this screen.
 */
export async function getMemberLedger(scope, memberId, { receiptLimit = 20 } = {}) {
  const { trustId, programId } = scope;

  const [memberSnap, { items: closings }] = await Promise.all([
    db.doc(paths.member(trustId, memberId)).get(),
    getClosingsIndex(trustId, programId),
  ]);

  if (!memberSnap.exists) throw notFound('Member not found');
  const member = { id: memberSnap.id, ...memberSnap.data() };
  assertSameProgram(member, programId);

  const { computeDue } = await import('./ledger.js');
  const due = computeDue(member, closings);

  const receiptsSnap = await db
    .collection(paths.payments(trustId, programId))
    .where('memberId', '==', memberId)
    .where('delete_flag', '==', false)
    .orderBy('paidAtMs', 'desc')
    .limit(receiptLimit)
    .get();

  return {
    member: stripLedgerInternals(member),
    due: {
      items: due.dueItems,
      count: due.dueCount,
      amount: due.dueAmount,
    },
    settled: {
      count: due.settledCount,
      exemptCount: due.exemptCount,
      amount: member.paidAmount ?? 0,
    },
    eligible: { count: due.eligibleCount, amount: due.eligibleAmount },
    receipts: receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** The ledger arrays are an implementation detail; the UI never needs them. */
function stripLedgerInternals(member) {
  const { paidSeqs, exemptSeqs, partialPaid, ...rest } = member;
  return rest;
}

/* ══════════════════════════════════════════════════════════════════════════
   helpers
   ══════════════════════════════════════════════════════════════════════════ */

/** `RSD-2026-000123`, or `RSD-MLP-2026-000012` inside a closing group. */
function formatReceiptNo(prefix, atMs, n, groupCode) {
  const year = new Date(atMs || Date.now()).getFullYear();
  const middle = groupCode ? `${groupCode}-${year}` : String(year);
  return `${prefix}-${middle}-${String(n).padStart(6, '0')}`;
}

function newId() {
  return db.collection('_ids').doc().id;
}

/** `{ groupId → "MLP" }` for the receipt number's middle section. */
async function loadGroupCodes(trustId, programId) {
  const snap = await db
    .collection(paths.groups(trustId, programId))
    .select('code', 'name')
    .get();

  const map = new Map();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.get('code') || null);
  }
  return map;
}
