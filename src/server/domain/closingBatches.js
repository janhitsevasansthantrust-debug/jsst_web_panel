import 'server-only';

import { db, serverNow, inc } from '../firebase/admin.js';
import { getClosingsIndex } from './indexes.js';
import { badRequest, conflict, notFound } from '../http.js';
import { paths, LIMITS } from '../../config/constants.js';
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

export async function createBatch(scope, input) {
  const { trustId, programId, uid } = scope;

  const ref = db
    .collection(paths.closingBatches(trustId, programId))
    .doc();

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
    invitationCardURL: input.invitationCardURL ?? '',

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

  for (const field of ['name', 'description', 'dueDate', 'paymentNote', 'invitationCardURL']) {
    if (input[field] !== undefined) patch[field] = input[field];
  }
  if (input.dueDateMs !== undefined) {
    patch.dueDateMs = Number.isFinite(Number(input.dueDateMs)) ? Number(input.dueDateMs) : null;
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

  return { batch, ...summariseBatch(rows) };
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
