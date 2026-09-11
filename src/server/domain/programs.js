import 'server-only';

import { db, serverNow } from '../firebase/admin.js';
import { badRequest, notFound } from '../http.js';
import { resolveRegistrationConfig } from '../../lib/registration.js';
import { matchAgeGroup } from '../../lib/ageGroup.js';
import { LIMITS, paths } from '../../config/constants.js';

/**
 * programs.js — योजना.
 *
 * A program is a self-contained book (its own members, closings, receipts,
 * counters and indexes) AND the rulebook that decides what members pay:
 *
 *   ageGroups[]      age band → joinFee + payAmount
 *   locationGroups[] the geographic grouping a member belongs to
 *
 * Rates live here, on the program, not on the member form. That is what makes
 * `resolveMemberRates()` below the single place a contribution amount is ever
 * decided — and why the browser cannot choose one.
 */

const PROGRAM_CATEGORIES = ['isSuraksha', 'isMamera', 'isVivah', 'isOther'];

/** Stable ids so a member's `ageGroup` reference survives a program edit. */
function withIds(items, prefix) {
  return (items ?? []).map((item, i) => ({
    ...item,
    id: item.id || `${prefix}_${Date.now()}_${i}`,
  }));
}

function categoryFlags(category) {
  const flags = {};
  for (const c of PROGRAM_CATEGORIES) flags[c] = c === category;
  return flags;
}

export async function listPrograms(scope) {
  const snap = await db.collection(paths.programs(scope.trustId)).get();

  const programs = await Promise.all(
    snap.docs.map(async (doc) => {
      const [statsSnap, seqSnap] = await Promise.all([
        db.doc(paths.counterStats(scope.trustId, doc.id)).get(),
        db.doc(paths.counterSeq(scope.trustId, doc.id)).get(),
      ]);
      const s = statsSnap.data() ?? {};
      return {
        id: doc.id,
        ...doc.data(),
        // Both normalised here, because the edit form is opened straight from
        // this list: a form that loads a setting blank saves it blank.
        registration: resolveRegistrationConfig(doc.data()),
        receiptPrefix: seqSnap.data()?.receiptPrefix ?? 'RSD',
        stats: {
          members: s.members?.total ?? 0,
          accepted: s.members?.accepted ?? 0,
          closings: s.closings?.total ?? 0,
          collected: s.money?.collectedTotal ?? 0,
          due: s.money?.dueTotal ?? 0,
        },
      };
    }),
  );

  programs.sort((a, b) => (b.isSelected ? 1 : 0) - (a.isSelected ? 1 : 0));
  return { programs };
}

export async function getProgram(scope, programId) {
  const [snap, seqSnap] = await Promise.all([
    db.doc(paths.program(scope.trustId, programId)).get(),
    db.doc(paths.counterSeq(scope.trustId, programId)).get(),
  ]);
  if (!snap.exists) throw notFound('योजना नहीं मिली');

  return {
    id: snap.id,
    ...snap.data(),
    // Normalised on the way out so the form never has to guess at defaults for
    // a योजना created before this setting existed.
    registration: resolveRegistrationConfig(snap.data()),
    // Lives on the counter document, but the edit form treats it as part of
    // the योजना — and a form that loads it blank saves it blank.
    receiptPrefix: seqSnap.data()?.receiptPrefix ?? 'RSD',
  };
}

/**
 * Create a योजना.
 *
 * Creates the program AND everything it needs to function: the sequence
 * allocator, the stats counters, the closings index and the member search
 * shard. Miss any of them and the program's first page load fails in a way
 * that is very hard to diagnose.
 */
export async function createProgram(scope, input) {
  const { trustId, uid } = scope;
  const programRef = db.collection(paths.programs(trustId)).doc();
  const programId = programRef.id;

  const ageGroups = withIds(input.ageGroups, 'ag');
  const locationGroups = withIds(input.locationGroups, 'lg');

  // Normalised once, here, so the stored config is always complete and every
  // reader gets the same answer without re-deriving defaults.
  const registration = resolveRegistrationConfig({ registration: input.registration });

  const batch = db.batch();

  batch.set(programRef, {
    name: input.name,
    hiname: input.hiname ?? '',
    about: input.about ?? '',
    noteLine: input.noteLine ?? '',
    category: input.category ?? 'isOther',
    ...categoryFlags(input.category ?? 'isOther'),

    ageGroups,
    locationGroups,

    // How this योजना's registration numbers are made — prefix, where to start
    // counting, padding, or random. Printed on every receipt, so it is the
    // trust's decision rather than ours.
    registration,

    isSelected: Boolean(input.isSelected),
    memberCount: 0,
    inactivemembercount: 0,

    commissionPolicy: input.commissionPolicy ?? {
      joinFee: { enabled: false, mode: 'percent', value: 0, slabs: [] },
      collection: { enabled: false, mode: 'percent', value: 0, slabs: [] },
      minPayout: 0,
      autoApprove: false,
    },

    active: true,
    createdAt: serverNow(),
    createdBy: uid,
    updatedAt: serverNow(),
  });

  batch.set(db.doc(paths.counterSeq(trustId, programId)), {
    closing: 0,
    receipt: 0,
    payout: 0,
    // The counter holds the LAST number issued, so it starts one BELOW the
    // configured first number — otherwise the very first member is handed
    // startFrom + 1 and the number the trust asked for is never used.
    registration: registration.startFrom - 1,
    receiptPrefix: input.receiptPrefix ?? 'RSD',
    updatedAt: serverNow(),
  });

  batch.set(db.doc(paths.counterStats(trustId, programId)), {
    members: { total: 0, pending: 0, accepted: 0, closed: 0, blocked: 0, left: 0 },
    closings: { total: 0, active: 0, reverted: 0, maxSeq: 0 },
    money: { collectedTotal: 0, expectedTotal: 0, dueTotal: 0, joinFeesTotal: 0, creditTotal: 0 },
    receipts: { total: 0, cancelled: 0 },
    commission: { earnedTotal: 0, paidTotal: 0, dueTotal: 0 },
    updatedAt: serverNow(),
  });

  batch.set(db.doc(paths.closingsIndex(trustId, programId)), {
    items: [], maxSeq: 0, count: 0, version: Date.now(), updatedAt: serverNow(),
  });

  // No member shard here. The member index is trust-wide now — one index for
  // every program — so a new योजना adds nothing to it. It starts empty and
  // fills as members are created.

  await batch.commit();

  return { id: programId, name: input.name, ageGroups, locationGroups };
}

/**
 * Edit a योजना.
 *
 * Changing `ageGroups` re-prices OUTSTANDING dues for members in those bands
 * (their `payAmount` is re-derived on their next write), but never re-prices
 * money already collected — that comes from receipts, which are immutable.
 */
export async function updateProgram(scope, programId, input) {
  const ref = db.doc(paths.program(scope.trustId, programId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('योजना नहीं मिली');

  const patch = {
    name: input.name,
    hiname: input.hiname ?? '',
    about: input.about ?? '',
    noteLine: input.noteLine ?? '',
    category: input.category ?? 'isOther',
    ...categoryFlags(input.category ?? 'isOther'),
    ageGroups: withIds(input.ageGroups, 'ag'),
    locationGroups: withIds(input.locationGroups, 'lg'),
    isSelected: Boolean(input.isSelected),
    updatedAt: serverNow(),
    updatedBy: scope.uid,
  };

  if (input.commissionPolicy) patch.commissionPolicy = input.commissionPolicy;

  /**
   * How this योजना's registration numbers are made.
   *
   * This was missing, and the symptom was baffling: the program form offered a
   * prefix and a random/sequential choice, accepted them, said "योजना अपडेट हो
   * गई" — and every member added afterwards still got a bare number in the old
   * shape. The edit was never written. A setting the UI accepts and the server
   * silently drops is worse than one that is not offered at all.
   *
   * The counter is deliberately NOT rewritten here. It holds the last number
   * issued, and `nextSequential` already jumps forward when `startFrom` is
   * raised later; resetting it to `startFrom - 1` would re-issue numbers that
   * are already printed on receipts.
   */
  if (input.registration) {
    patch.registration = resolveRegistrationConfig({ registration: input.registration });
  }

  // "Active" is exclusive: making this one active must clear the others, or
  // two programs both claim to be the default and new members land in
  // whichever one happened to be read first.
  // The receipt prefix lives on the counter document rather than the program,
  // so it needs its own write — and was being dropped for the same reason.
  if (input.receiptPrefix !== undefined) {
    await db
      .doc(paths.counterSeq(scope.trustId, programId))
      .set(
        { receiptPrefix: input.receiptPrefix || 'RSD', updatedAt: serverNow() },
        { merge: true },
      );
  }

  if (patch.isSelected) {
    const all = await db.collection(paths.programs(scope.trustId)).get();
    const batch = db.batch();
    batch.update(ref, patch);
    for (const doc of all.docs) {
      if (doc.id !== programId && doc.data().isSelected) {
        batch.update(doc.ref, { isSelected: false, updatedAt: serverNow() });
      }
    }
    await batch.commit();
  } else {
    await ref.update(patch);
  }

  return { id: programId, ...snap.data(), ...patch, updatedAt: null };
}

/* ══════════════════════════════════════════════════════════════════════════
   Rate resolution — the only place a contribution amount is decided
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Work out what a member pays, from the program's rules and their own dates.
 *
 * The form computes the same thing so the operator sees the rate as they type,
 * but this is the answer that gets stored. Deriving it server-side means an
 * edited request cannot register somebody at ₹1 a closing, and it means a
 * member's rate always matches the program's published bands.
 *
 * Throws when no band covers the member's age — a silent fallback of zero
 * would create a member who owes nothing and nobody would notice for months.
 */
export function resolveMemberRates(program, { bobDateMs, joinDateMs, locationGroupId }) {
  const matched = matchAgeGroup(program.ageGroups, bobDateMs, joinDateMs);

  if (!matched) {
    const bands = (program.ageGroups ?? [])
      .map((g) => `${g.startAge}-${g.endAge}`)
      .join(', ');
    throw badRequest(
      `इस सदस्य की आयु किसी भी आयु समूह में नहीं आती। ` +
      `उपलब्ध समूह: ${bands || 'कोई नहीं'}`,
    );
  }

  const locationGroup =
    (program.locationGroups ?? []).find((g) => g.id === locationGroupId) ?? null;

  return {
    ageGroup: matched.id,
    ageGroupRange: matched.range,
    age: matched.ageYears,
    payAmount: Number(matched.payAmount) || LIMITS.DEFAULT_PAY_AMOUNT,
    joinFees: Number(matched.joinFee) || 0,

    locactionGroupId: locationGroup?.id ?? null,
    locationGroup: locationGroup?.location ?? '',
    memberGroup: locationGroup?.groupName ?? '',
    groupType: locationGroup?.groupType ?? '',
  };
}

/**
 * Delete a योजना.
 *
 * Refuses when:
 *   - the program is the active/selected one
 *   - the program has any members, closings or payments
 *
 * All associated documents (counterSeq, counterStats, closingsIndex) are
 * deleted in a single batch. The member search index is trust-wide and
 * contains no program-specific documents to clean up.
 */
export async function deleteProgram(scope, programId) {
  const { trustId, uid } = scope;
  const ref = db.doc(paths.program(trustId, programId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('योजना नहीं मिली');

  const program = snap.data();

  if (program.isSelected) {
    throw badRequest('चालू योजना को हटाया नहीं जा सकता — पहले कोई दूसरी योजना चालू करें');
  }

  // Check for members in this program
  const membersSnap = await db
    .collection(paths.members(trustId))
    .where('programId', '==', programId)
    .limit(1)
    .get();
  if (!membersSnap.empty) {
    throw badRequest(
      'इस योजना में सदस्य हैं — पहले सभी सदस्यों को हटाएँ या दूसरी योजना में ले जाएँ',
    );
  }

  // Check for closings
  const closingsSnap = await db
    .collection(paths.closings(trustId, programId))
    .limit(1)
    .get();
  if (!closingsSnap.empty) {
    throw badRequest('इस योजना में क्लोजिंग हैं — पहले उन्हें हटाएँ');
  }

  // Check for payments
  const paymentsSnap = await db
    .collection(paths.payments(trustId, programId))
    .limit(1)
    .get();
  if (!paymentsSnap.empty) {
    throw badRequest('इस योजना में भुगतान हैं — उन्हें हटाया नहीं जा सकता');
  }

  const batch = db.batch();
  batch.delete(ref);
  batch.delete(db.doc(paths.counterSeq(trustId, programId)));
  batch.delete(db.doc(paths.counterStats(trustId, programId)));
  batch.delete(db.doc(paths.closingsIndex(trustId, programId)));
  await batch.commit();

  return { id: programId, deleted: true };
}

/* ── Location groups, read by the member form ────────────────────────────── */

export async function getProgramRules(scope, programId) {
  const program = await getProgram(scope, programId ?? scope.programId);
  return {
    id: program.id,
    name: program.name,
    hiname: program.hiname ?? '',
    ageGroups: program.ageGroups ?? [],
    locationGroups: program.locationGroups ?? [],
  };
}
