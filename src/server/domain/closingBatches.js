import 'server-only';

import { db, serverNow, inc, getAllDocs } from '../firebase/admin.js';
import { getClosingsIndex, invalidateIndexCache } from './indexes.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { paths, LIMITS, CLOSING_STATUS } from '../../config/constants.js';
import { batchCode, selectBatchRows, summariseBatch } from '../../lib/closingBatch.js';

/**
 * Re-exported so the rest of the server can reach them from one place, while
 * the functions themselves stay importable without pulling in Firestore.
 */
export { batchCode, selectBatchRows, summariseBatch };

/**
 * क्लोजिंग समूह — a batch of closings that go out on one notice.
 *
 * A trust does not tell its members about closings one at a time. It collects
 * whatever happened over a month, prints ONE sheet listing all of them, and
 * hands that sheet round: "these fifteen families this month, your share is
 * ₹300 each, ₹4,500 in total, due by the 30th". The batch is that sheet.
 *
 * ─── Why this is not the existing `closing_groups` collection ────────────
 *
 * That one is the यूनिट — a member's rate group, carrying `payAmount` and
 * `joinFees`, answering "what does this member pay per closing". A batch
 * answers "which closings are we billing together". They are different
 * questions with different lifetimes: a member belongs to one यूनिट for years,
 * and to a new batch every month. Folding them into one collection would mean
 * a document that is sometimes a rate card and sometimes a billing period, and
 * no way to tell which from the outside.
 *
 * ─── What a batch does NOT do ────────────────────────────────────────────
 *
 * It does not decide who owes anything. That is still the date rule in
 * `ledger.isEligible`, member by member, and it stays that way deliberately:
 * a batch is a piece of stationery, and stationery must never be able to
 * change what somebody owes. Put a closing in a batch, take it out, rename the
 * batch, delete it — every member's dues are exactly what they were.
 */

export async function listBatches(scope, { includeClosed = true } = {}) {
  const snap = await db
    .collection(paths.closingBatches(scope.trustId, scope.programId))
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  const batches = snap.docs
    .map((d) => ({ id: d.id, ...d.data(), createdAt: null }))
    .filter((b) => includeClosed || b.status !== 'issued');

  return { batches };
}

/**
 * Read the closed member off the closings index and return everything the batch
 * needs to carry about them.
 *
 * The name and reg. no. are denormalised onto the batch so the list renders and
 * the notice prints without a read per row — the same reason closings denormalise
 * `batchName` onto themselves.
 *
 * Validated against the index rather than the members collection on purpose:
 * "बंद हुआ सदस्य" means a member who HAS closed, and the closings index is the
 * cheapest honest answer to that question. Accepting an arbitrary member id would
 * let a batch claim a card belonging to somebody still paying instalments.
 */
async function readClosedMember(trustId, programId, memberId) {
  const none = {
    closedMemberId: null,
    closedMemberName: '',
    closedMemberRegNo: '',
  };
  if (!memberId) return none;

  const { items } = await getClosingsIndex(trustId, programId);
  const own = items.filter((c) => (c.memberId ?? null) === memberId);
  if (!own.length) {
    throw badRequest(
      'यह सदस्य किसी क्लोजिंग के साथ नहीं जुड़ा है — निमंत्रण पत्र के लिए बंद हुआ सदस्य चुनें',
    );
  }

  const newest = (a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0) || (b.seq ?? 0) - (a.seq ?? 0);
  // Most recent active closing: the one whose card belongs on a sheet issued
  // today. A reverted closing is skipped where possible — its card was withdrawn
  // with it — but a member whose only closing was reverted still names a card,
  // because otherwise the batch could not be attributed to anybody.
  const latest =
    own.filter((c) => c.status === CLOSING_STATUS.ACTIVE).sort(newest)[0] ??
    [...own].sort(newest)[0];

  return {
    closedMemberId: memberId,
    closedMemberName: latest.name ?? '',
    closedMemberRegNo: latest.regNo ?? '',
  };
}

/**
 * The closed member's own invitation card, read back from their closing.
 *
 * Not stored on the batch. One card belongs to one family, and it is already on
 * the closing — this reads it for the notice rather than keeping a second copy
 * that could disagree with the one printed on that member's समापन पत्र.
 */
async function readClosedMemberCard(scope, batch) {
  if (!batch.closedMemberId) return '';
  try {
    const { items } = await getClosingsIndex(scope.trustId, scope.programId);
    const ids = items
      .filter((c) => (c.memberId ?? null) === batch.closedMemberId)
      .sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0) || (b.seq ?? 0) - (a.seq ?? 0))
      .map((c) => c.id);
    if (!ids.length) return '';

    // All of that member's closings in one call, not one read each. The card
    // lives on the closing document, which the index deliberately does not carry.
    const snaps = await db.getAll(
      ...ids.map((id) => db.doc(paths.closing(scope.trustId, scope.programId, id))),
    );
    for (const snap of snaps) {
      const url = snap.data()?.invitationCardURL;
      if (url) return url;
    }
  } catch {
    // A card that cannot be fetched must not stop the notice printing. The
    // sheet without it is still a correct sheet; a failed notice is not.
  }
  return '';
}

export async function createBatch(scope, input) {
  const { trustId, programId, uid } = scope;

  const ref = db
    .collection(paths.closingBatches(trustId, programId))
    .doc();

  const closed = await readClosedMember(trustId, programId, input.closedMemberId);

  const batch = {
    name: input.name,
    code: batchCode(input.code || input.name),
    description: input.description ?? '',

    /**
     * When the money is due.
     *
     * Printed on the notice and nowhere else — it is a request, not a rule.
     * Nothing in the ledger reads it, so a batch whose due date has passed
     * does not make anybody's dues behave differently; it just means the
     * sheet said the 30th and today is the 5th.
     */
    dueDate: input.dueDate ?? '',
    dueDateMs: Number.isFinite(Number(input.dueDateMs)) ? Number(input.dueDateMs) : null,

    /** The line at the bottom of the notice — where and how to pay. */
    paymentNote: input.paymentNote ?? '',

    /**
     * Whose card the notice carries, and who that is.
     *
     * Pure stationery, like the rest of the batch: it does NOT scope which
     * closings are on the sheet — the ⊞ button does that — and it cannot move
     * a rupee, because nothing in `ledger` reads a batch.
     */
    ...closed,

    closingCount: 0,
    perMemberAmount: 0,

    status: 'open',
    programId,
    createdAt: serverNow(),
    createdBy: uid,
    updatedAt: serverNow(),
  };

  await ref.set(batch);
  return { id: ref.id, ...batch, createdAt: null, updatedAt: null };
}

export async function updateBatch(scope, batchId, input) {
  const ref = db.doc(paths.closingBatch(scope.trustId, scope.programId, batchId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('क्लोजिंग समूह नहीं मिला');

  const patch = { updatedAt: serverNow(), updatedBy: scope.uid };

  for (const field of ['name', 'description', 'dueDate', 'paymentNote']) {
    if (input[field] !== undefined) patch[field] = input[field];
  }
  if (input.dueDateMs !== undefined) {
    patch.dueDateMs = Number.isFinite(Number(input.dueDateMs)) ? Number(input.dueDateMs) : null;
  }
  if (input.closedMemberId !== undefined) {
    Object.assign(
      patch,
      await readClosedMember(scope.trustId, scope.programId, input.closedMemberId),
    );
  }
  if (input.status !== undefined) patch.status = input.status === 'issued' ? 'issued' : 'open';

  /**
   * The code is NOT editable.
   *
   * It is baked into every receipt number already issued under this batch.
   * Changing it would leave one billing period with two receipt series that
   * look unrelated, and no way to tell from a receipt which batch it belonged
   * to. Rename the batch freely; the code it prints under is fixed at birth.
   */

  await ref.update(patch);
  return { id: batchId, ...snap.data(), ...patch, updatedAt: null, createdAt: null };
}

/**
 * Assert a batch exists and is still open, and return its name.
 *
 * Called from `createClosing`, which must not write a `batchId` pointing at
 * nothing — a notice built from a dangling id would silently omit the closing
 * it was printed for.
 */
export async function resolveBatch(scope, batchId) {
  if (!batchId) return { batchId: null, batchName: null };

  const snap = await db
    .doc(paths.closingBatch(scope.trustId, scope.programId, batchId))
    .get();

  if (!snap.exists) throw badRequest('क्लोजिंग समूह नहीं मिला');
  if (snap.data().status === 'issued') {
    throw conflict(
      'यह समूह जारी हो चुका है — इसमें नई क्लोजिंग नहीं जुड़ सकती। नया समूह बनाएँ।',
    );
  }

  return { batchId, batchName: snap.data().name ?? null };
}

/** Keep the batch's headline count in step as closings join or leave it. */
export function bumpBatch(tx, scope, batchId, delta) {
  if (!batchId) return;
  tx.set(
    db.doc(paths.closingBatch(scope.trustId, scope.programId, batchId)),
    { closingCount: inc(delta), updatedAt: serverNow() },
    { merge: true },
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The notice sheet
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the printed notice needs, in ONE index read.
 *
 * The closings come from the shared closings index rather than from a query,
 * so a batch of fifteen costs the same as a batch of one, and the same as
 * loading the closings screen — which has usually already warmed the cache.
 */
export async function getBatchSheet(scope, batchId) {
  const ref = db.doc(paths.closingBatch(scope.trustId, scope.programId, batchId));
  const [snap, index] = await Promise.all([
    ref.get(),
    getClosingsIndex(scope.trustId, scope.programId),
  ]);

  if (!snap.exists) throw notFound('क्लोजिंग समूह नहीं मिला');

  const batch = { id: batchId, ...snap.data(), createdAt: null, updatedAt: null };
  const rows = selectBatchRows(index.items, batchId);

  return {
    batch,
    /**
     * Derived here, not stored: the card comes from the closed member's own
     * closing so there is exactly one copy of it in the system. Costs one read
     * and only when a batch names somebody.
     */
    closedMemberCardURL: await readClosedMemberCard(scope, batch),
    ...summariseBatch(rows),
  };
}

/**
 * Mark a batch as issued — the notice has been printed and handed out.
 *
 * After this no closing may be added to it, which is the point: a member
 * holding a sheet that lists fifteen names must not be billed for a sixteenth
 * that was slipped in afterwards.
 */
export async function issueBatch(scope, batchId) {
  const ref = db.doc(paths.closingBatch(scope.trustId, scope.programId, batchId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('क्लोजिंग समूह नहीं मिला');

  const index = await getClosingsIndex(scope.trustId, scope.programId);
  const { rows, perMemberAmount } = summariseBatch(
    selectBatchRows(index.items, batchId),
  );

  if (!rows.length) {
    throw badRequest('इस समूह में कोई क्लोजिंग नहीं है');
  }
  if (rows.length > LIMITS.MAX_BATCH_CLOSINGS) {
    throw badRequest(
      `एक समूह में ज़्यादा से ज़्यादा ${LIMITS.MAX_BATCH_CLOSINGS} क्लोजिंग रखी जा सकती हैं`,
    );
  }

  await ref.update({
    status: 'issued',
    closingCount: rows.length,
    perMemberAmount,
    issuedAt: serverNow(),
    issuedBy: scope.uid,
    updatedAt: serverNow(),
  });

  return { id: batchId, ...snap.data(), status: 'issued', closingCount: rows.length, perMemberAmount };
}

/* ══════════════════════════════════════════════════════════════════════════
   Moving closings in and out of a batch
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Put existing closings on a batch's notice, or take them off it.
 *
 * The batch used to be choosable only while CREATING a closing, which left no
 * way to deal with the ordinary case: the month's closings were entered as
 * they happened, and the समूह for that month was made afterwards. Everything
 * already entered was then stranded — on no notice, on no receipt, collected
 * from nobody.
 *
 * Moving a closing between batches changes NOTHING about what anybody owes.
 * Dues come from the closing's date, member by member; the batch only decides
 * which sheet it is printed on. That is why this is allowed to be a free edit
 * up until the moment the batch is issued — and refused completely afterwards,
 * because by then the sheet is in people's hands.
 *
 * @param batchId   the batch to move them ONTO, or null to take them off
 * @param closingIds which closings
 */
export async function setClosingBatch(scope, batchId, closingIds, { batchName } = {}) {
  const { trustId, programId } = scope;

  const ids = [...new Set((closingIds ?? []).filter(Boolean))];
  if (!ids.length) throw badRequest('कोई क्लोजिंग नहीं चुनी');
  if (ids.length > LIMITS.MAX_BATCH_CLOSINGS) {
    throw badRequest(
      `एक बार में ज़्यादा से ज़्यादा ${LIMITS.MAX_BATCH_CLOSINGS} क्लोजिंग जोड़ी जा सकती हैं`,
    );
  }

  await getClosingsIndex(trustId, programId);
  const refs = ids.map((id) => db.doc(paths.closing(trustId, programId, id)));
  const indexRef = db.doc(paths.closingsIndex(trustId, programId));
  const moved = await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const indexSnap = await tx.get(indexRef);
    if (snaps.some((snap) => !snap.exists)) throw notFound('क्लोजिंग नहीं मिली');
    if (snaps.some((snap) => snap.data().status !== CLOSING_STATUS.ACTIVE)) {
      throw conflict('सिर्फ़ चालू क्लोजिंग समूह में रखी जा सकती है');
    }
    const batchIds = [...new Set([batchId, ...snaps.map((s) => s.data().batchId)].filter(Boolean))];
    const batchSnaps = batchIds.length ? await tx.getAll(...batchIds.map((id) =>
      db.doc(paths.closingBatch(trustId, programId, id)))) : [];
    if (batchSnaps.some((s) => !s.exists || s.data().status !== 'open')) {
      throw conflict('जारी समूह की क्लोजिंग बदली नहीं जा सकती');
    }
    const name = batchSnaps.find((s) => s.id === batchId)?.data().name ?? null;
    const deltas = new Map();
    const changes = [];
    snaps.forEach((snap, i) => {
      const closing = snap.data();
      const from = closing.batchId ?? null;
      if (from === (batchId ?? null)) return;
      if (from) deltas.set(from, (deltas.get(from) ?? 0) - 1);
      if (batchId) deltas.set(batchId, (deltas.get(batchId) ?? 0) + 1);
      changes.push({ id: snap.id, seq: closing.seq, from });
      tx.update(refs[i], { batchId: batchId ?? null, batchName: name,
        updatedAt: serverNow(), updatedBy: scope.uid });
    });
    for (const [id, delta] of deltas) bumpBatch(tx, scope, id, delta);
    const changedIds = new Set(changes.map((c) => c.id));
    tx.set(indexRef, {
      items: (indexSnap.data()?.items ?? []).map((c) => changedIds.has(c.id)
        ? { ...c, batchId: batchId ?? null } : c),
      version: Date.now(), updatedAt: serverNow(),
    }, { merge: true });
    return changes;
  });
  invalidateIndexCache(trustId, programId);
  return { moved: moved.length, closings: moved };
}

/**
 * Closings that can still be put on a notice.
 *
 * Reverted ones are left out: they are owed by nobody, so putting one on a
 * bill would be asking for money the trust has already decided not to take.
 */
export async function assignableClosings(scope, { batchId } = {}) {
  const { items } = await getClosingsIndex(scope.trustId, scope.programId);

  return {
    closings: items
      .filter((c) => c.status !== CLOSING_STATUS.REVERTED)
      // Everything not already on this batch — including closings sitting on
      // another one, because "I put it on the wrong sheet" is a normal
      // mistake and the fix should not be to unpick it first.
      .filter((c) => (c.batchId ?? null) !== (batchId ?? null))
      .sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0) || (b.seq ?? 0) - (a.seq ?? 0)),
  };
}
