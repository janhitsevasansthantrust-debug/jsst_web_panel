import 'server-only';

import { db, serverNow, inc, countQuery } from '../firebase/admin.js';
import { computeDue, compactLedger, readLedger } from './ledger.js';
import {
  getClosingsIndex, patchMemberInIndex, removeMemberFromIndex,
  getMembersIndex, fromMemberEntry,
} from './indexes.js';
import {
  filterMembers, sortMembers, paginate, facetsFor, summarise,
  groupMembers, countsFor,
} from './memberQuery.js';
import { getProgram, resolveMemberRates } from './programs.js';
import {
  resolveRegistrationConfig, formatRegistration, nextSequential,
  randomRegistrationNumber, REGISTRATION_MODE,
} from '../../lib/registration.js';
import { postPayment } from './payments.js';
import { memberKeywords } from '../../lib/memberSearch.js';
import { joinFeesState } from '../../lib/joinFees.js';
import { badRequest, conflict, notFound } from '../http.js';
import { assertSameProgram } from './scope.js';
import {
  LIMITS,
  MEMBER_STATUS,
  EXIT_REASON,
  PAYMENT_METHOD,
  paths,
} from '../../config/constants.js';

/**
 * members.js — member records and the list screens.
 *
 * The list endpoints here are the ones that used to cost the most. The old
 * `/api/payments/fetch` read EVERY member, EVERY payment_pending document and
 * EVERY transaction on each dashboard load. This one reads one page of members
 * — 50 documents — because each member already carries their own due counters.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Create
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A random registration number that nobody else has.
 *
 * Six random digits give a million possibilities, so a clash in a
 * 5,000-member trust is unlikely — but "unlikely" is not "impossible", and the
 * failure mode is two members sharing a number on printed receipts. Five
 * attempts is cheap insurance; running out means the number space is too small
 * for the trust, which is worth saying out loud rather than working around.
 */
async function drawUniqueRandom(membersRef, config) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomRegistrationNumber(config);

    const clash = await membersRef
      .where('registrationNumber', '==', candidate)
      .limit(1)
      .get();

    if (clash.empty) return candidate;
  }

  throw conflict(
    'नया रजिस्ट्रेशन नंबर नहीं बन सका — योजना की सेटिंग में अंकों की संख्या बढ़ाएँ',
  );
}

/**
 * The member of this योजना holding this आधार, if any.
 *
 * Equality on three fields, so Firestore serves it without a composite index.
 * `limit(2)` rather than 1: when editing a member, the first hit is usually
 * themselves, and one more is needed to tell "nobody else has it" from "I only
 * looked at myself".
 */
async function lookupAadhaar(trustId, programId, aadhaar, { exceptId } = {}) {
  const clean = String(aadhaar ?? '').replace(/\D+/g, '');
  if (clean.length !== 12) return null;

  const snap = await db
    .collection(paths.members(trustId))
    .where('programId', '==', programId)
    .where('delete_flag', '==', false)
    .where('aadhaarNo', '==', clean)
    .limit(2)
    .get();

  return snap.docs.find((d) => d.id !== exceptId) ?? null;
}

/**
 * Who holds this आधार in this योजना — for the form to warn as it is typed.
 *
 * Returns the same person the save would refuse for, so the warning and the
 * refusal can never disagree.
 */
export async function findMemberByAadhaar(scope, aadhaar, { exceptId } = {}) {
  const doc = await lookupAadhaar(scope.trustId, scope.programId, aadhaar, { exceptId });
  if (!doc) return null;

  const m = doc.data();
  return {
    id: doc.id,
    displayName: m.displayName ?? '',
    registrationNumber: m.registrationNumber ?? '',
    fatherName: m.fatherName ?? '',
    village: m.village ?? '',
    phone: m.phone ?? '',
    status: m.status ?? '',
  };
}

/**
 * Refuse a आधार number that is already on another member of this योजना.
 *
 * Scoped to the PROGRAM, not the trust: the same person joining a second
 * योजना is a normal thing and must not be blocked. Joining the same one
 * twice is what this stops — which is how a household ends up paying two
 * contributions for one member and nobody notices until the closing sheet is
 * a name longer than the register.
 *
 * `exceptId` is the member being edited, so saving a member without touching
 * their आधार does not report them as their own duplicate.
 *
 * The check is a query run BEFORE the transaction, not a uniqueness document
 * written inside it. Two operators entering the same आधार in the same second
 * could still slip past, and that is an accepted trade: the alternative is an
 * index document that has to be created, moved and deleted in step with every
 * member write, and a bug in that bookkeeping blocks a real person from being
 * registered at all. A query reads the truth and cannot drift from it.
 */
async function assertAadhaarFree(trustId, programId, aadhaar, { exceptId } = {}) {
  const other = await lookupAadhaar(trustId, programId, aadhaar, { exceptId });
  if (!other) return;

  const m = other.data();

  // The message names WHO holds it. "आधार पहले से दर्ज है" sends the operator
  // to search for it; this sends them straight to the member.
  throw conflict(
    `यह आधार नंबर पहले से दर्ज है — ${m.displayName || 'सदस्य'}` +
    `${m.registrationNumber ? ` (रजि. ${m.registrationNumber})` : ''}`,
    { memberId: other.id, field: 'aadhaarNo' },
  );
}

/**
 * The agent's name for a member record, read from the agent document.
 *
 * Members carry the agent's NAME as well as their id — that is what makes the
 * grid's agent column and the agent filter free. But the name has to come from
 * the agent record, never from the request: the browser sent one and the
 * schema stripped it (it was never a field), so every member added by an agent
 * had a blank agent column. Even had it survived, a name the client supplies
 * is a name the client can get wrong, and the rename cascade would have
 * nothing to keep it honest against.
 */
async function resolveAgent(trustId, agentId) {
  if (!agentId) return { agentId: null, agentName: '' };

  const snap = await db.doc(paths.agent(trustId, agentId)).get();
  if (!snap.exists) throw badRequest('यह एजेंट मौजूद नहीं है');

  return { agentId, agentName: snap.data().displayName ?? '' };
}

export async function createMember(scope, input) {
  const { trustId, programId, uid } = scope;

  const joinDateMs = Number(input.joinDateMs);
  if (!Number.isFinite(joinDateMs)) {
    throw badRequest('जुड़ने की तारीख़ ज़रूरी है');
  }
  if (!Number.isFinite(Number(input.bobDateMs))) {
    throw badRequest('जन्म तिथि ज़रूरी है — इसी से आयु समूह और राशि तय होती है');
  }

  /**
   * Rates come from the PROGRAM's age bands, matched against this member's
   * date of birth — never from the request body. The form shows the same
   * number as it is typed, but this is the one that gets stored.
   */
  const program = await getProgram(scope, programId);

  // Resolved before the transaction: it is a read of a document outside the
  // member's own tree, and a transaction that reads widely is a transaction
  // that contends widely.
  const agent = await resolveAgent(
    trustId,
    input.addedBy === 'agent' ? input.agentId : null,
  );
  const rates = resolveMemberRates(program, {
    bobDateMs: Number(input.bobDateMs),
    joinDateMs,
    locationGroupId: input.locationGroupId,
  });

  const membersRef = db.collection(paths.members(trustId));

  // Registration numbers must be unique within a program — check before we
  // burn a sequence number.
  if (input.registrationNumber) {
    const clash = await membersRef
      .where('registrationNumber', '==', String(input.registrationNumber))
      .where('delete_flag', '==', false)
      .limit(1)
      .get();
    if (!clash.empty) {
      throw conflict(
        `Registration number ${input.registrationNumber} is already used`,
        { memberId: clash.docs[0].id },
      );
    }
  }

  await assertAadhaarFree(trustId, programId, input.aadhaarNo);

  const { items: closings } = await getClosingsIndex(trustId, programId);

  /**
   * How this योजना builds a registration number.
   *
   * For random numbers the candidate is drawn and checked for a clash BEFORE
   * the transaction opens. A transaction cannot run a query, and drawing
   * inside one without checking would eventually hand two members the same
   * number — rarely enough that it would be found on a receipt, not in a test.
   */
  const regConfig = resolveRegistrationConfig(program);

  const randomNumber =
    !input.registrationNumber && regConfig.mode === REGISTRATION_MODE.RANDOM
      ? await drawUniqueRandom(membersRef, regConfig)
      : null;

  const memberRef = membersRef.doc();
  const seqRef = db.doc(paths.counterSeq(trustId, programId));
  const statsRef = db.doc(paths.counterStats(trustId, programId));

  const created = await db.runTransaction(async (tx) => {
    const seqSnap = await tx.get(seqRef);

    // The number is built to the योजना's own recipe — prefix, start, padding,
    // or random. An explicitly supplied number wins: an operator entering an
    // existing number from a paper register is transcribing history, not
    // asking for a new one.
    // Held separately from the formatted string: the counter stores a NUMBER,
    // and `Number('RJ-1001')` is NaN — which would wipe the counter and start
    // the whole योजना over at its first number.
    const nextNumber = nextSequential(regConfig, seqSnap.data()?.registration);

    const registrationNumber =
      input.registrationNumber ??
      (regConfig.mode === REGISTRATION_MODE.RANDOM
        ? randomNumber
        : formatRegistration(regConfig, nextNumber));

    const base = {
      registrationNumber: String(registrationNumber),

      // व्यक्तिगत जानकारी
      displayName: input.displayName ?? '',
      fatherName: input.fatherName ?? '',
      jati: input.jati ?? '',
      gotra: input.gotra ?? '',
      guardian: input.guardian ?? '',
      guardianRelation: input.guardianRelation ?? '',
      gender: input.gender ?? '',

      // संपर्क
      phone: input.phone ?? '',
      phoneAlt: input.phoneAlt ?? '',
      aadhaarNo: input.aadhaarNo ?? '',

      // आयु और तिथियाँ
      bobDate: input.bobDate ?? '',
      bobDateMs: Number(input.bobDateMs),
      joinDate: input.joinDate ?? '',
      joinDateMs,
      exitDate: null,
      exitDateMs: null,
      exitReason: null,

      // पता
      state: input.state ?? '',
      district: input.district ?? '',
      village: input.village ?? '',
      pinCode: input.pinCode ?? '',
      currentAddress: input.currentAddress ?? '',

      // दस्तावेज़
      photoURL: input.photoURL ?? '',
      extraImageURL: input.extraImageURL ?? '',
      documentFrontURL: input.documentFrontURL ?? '',
      documentBackURL: input.documentBackURL ?? '',
      guardianDocumentURL: input.guardianDocumentURL ?? '',
      extraDetails: (input.extraDetails ?? []).filter((f) => f.label && f.value),

      // ▼ derived on the server from the program's age bands — never from the
      //   request body. See programs.resolveMemberRates().
      ageGroup: rates.ageGroup,
      ageGroupRange: rates.ageGroupRange,
      age: rates.age,
      payAmount: rates.payAmount,
      joinFees: rates.joinFees,
      locactionGroupId: rates.locactionGroupId,
      locationGroup: rates.locationGroup,
      memberGroup: rates.memberGroup,
      groupType: rates.groupType,

      /**
       * Always false here, even when the operator ticked "शुल्क जमा हो गया".
       *
       * The fee is marked paid by POSTING A RECEIPT, just below — never by
       * setting this flag. Before, ticking the box set the flag and nothing
       * else: no receipt to print, no entry in the day's collection, and no
       * commission for the agent who had just enrolled the member and taken
       * their money. The trust's books showed a fee that had been collected by
       * nobody, on no date, for which no paper existed.
       *
       * Writing `false` and letting the receipt flip it also means a failure
       * leaves the honest state — fee outstanding — rather than money marked
       * collected with no record of it.
       */
      joinFeesDone: false,
      /**
       * The fee is tracked as an amount, so part payment is representable.
       * `joinFeesDone` is a mirror of `joinFeesDue === 0`, kept because
       * filters and the search index need a plain field to match on.
       */
      joinFeesPaid: 0,
      joinFeesDue: rates.joinFees ?? 0,
      joinFeesTxtId: input.joinFeesTxtId ?? '',
      joinFeesReceiptId: null,

      // जोड़ा गया
      addedBy: input.addedBy ?? 'admin',
      addedByName: agent.agentName || 'Admin',
      agentId: agent.agentId,
      agentName: agent.agentName,

      status: input.status ?? MEMBER_STATUS.ACCEPTED,
      programId,
      programName: program.name ?? '',

      closingId: null,
      closingSeq: null,
      closingDateMs: null,
      creditBalance: 0,

      role: 'member',
      active_flag: true,
      delete_flag: false,
      createdAt: serverNow(),
      createdBy: uid,
      updatedAt: serverNow(),
      updatedBy: uid,
    };

    /**
     * Initialise the ledger.
     *
     * A member who joins today owes nothing for closings that already happened
     * — the date rule handles that on its own. Running compaction here just
     * advances the watermark past all of them straight away, so their very
     * first `computeDue` is a short walk rather than a 500-item scan.
     */
    const ledger = compactLedger(
      readLedger({}),
      { ...base, id: memberRef.id },
      closings,
    );
    const due = computeDue({ ...base, ...ledger, id: memberRef.id }, closings);

    const member = {
      ...base,
      ...ledger,
      paidCount: 0,
      paidAmount: 0,
      dueCount: due.dueCount,
      dueAmount: due.dueAmount,
      lastPaymentAt: null,

      /**
       * Searchable tokens, stored on the member itself.
       *
       * Computed from the record as it is about to be SAVED, not from the
       * request — so the registration number the server issued, the rates it
       * derived and the agent name it looked up are all in there. Building
       * them from `input` would have left a member findable by everything
       * except the number printed on their receipt.
       */
      searchKeywords: memberKeywords({ ...base, ...ledger }),
    };

    tx.set(memberRef, member);

    // Only the sequential recipe advances a counter. Random numbers are not a
    // sequence, and bumping it for them would make the counter meaningless if
    // the योजना were ever switched back to sequential.
    if (!input.registrationNumber && regConfig.mode !== REGISTRATION_MODE.RANDOM) {
      tx.set(
        seqRef,
        { registration: nextNumber, updatedAt: serverNow() },
        { merge: true },
      );
    }

    tx.set(
      statsRef,
      {
        members: {
          total: inc(1),
          [member.status]: inc(1),
        },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    if (member.agentId) {
      tx.set(
        db.doc(paths.agent(trustId, member.agentId)),
        { memberCount: inc(1), updatedAt: serverNow() },
        { merge: true },
      );
    }

    return { id: memberRef.id, ...member, createdAt: null, updatedAt: null };
  });

  await patchMemberInIndex(trustId, created.id, created);

  /**
   * The joining fee, taken at the counter as the member was enrolled.
   *
   * A separate transaction on purpose. It cannot join the one above — that one
   * allocates the registration number and must not be held open across a
   * second set of reads — and the ordering is the safe one: if this fails the
   * member exists with the fee still showing as due, which is a five-second
   * fix at the desk. The other way round would be a receipt pointing at a
   * member who does not exist.
   */
  /**
   * How much of it is actually being handed over.
   *
   * `joinFeesPaidNow` when the counter typed a figure, the whole fee when they
   * only ticked the box (which is what every older caller sends), and never
   * more than the fee itself — the age band sets that, not the form.
   */
  const feeTotal = Number(created.joinFees) || 0;
  const feeNow = Math.min(
    feeTotal,
    input.joinFeesPaidNow !== undefined
      ? Number(input.joinFeesPaidNow) || 0
      : (input.joinFeesDone ? feeTotal : 0),
  );

  if (feeNow > 0) {
    const fee = await postPayment(scope, {
      memberId: created.id,
      seqs: [],
      joinFeeAmount: feeNow,
      method: input.joinFeesMethod ?? PAYMENT_METHOD.CASH,
      paidAtMs: created.joinDateMs ?? Date.now(),
      reference: input.joinFeesTxtId ?? '',
      note: feeNow < feeTotal ? 'नामांकन शुल्क (आंशिक)' : 'नामांकन शुल्क',
      // Whoever enrolled them collected it. This is the line that pays the
      // agent their enrolment commission, through exactly the same code path
      // as every other receipt.
      collectedByAgentId: created.agentId ?? null,
      idempotencyKey: `joinfee:${created.id}`,
    });

    return {
      ...created,
      joinFeesPaid: feeNow,
      joinFeesDue: Math.max(0, feeTotal - feeNow),
      joinFeesDone: feeNow >= feeTotal,
      joinFeesReceiptId: fee.receipt?.id ?? null,
      joinFeeReceipt: fee.receipt ?? null,
    };
  }

  return created;
}

/* ══════════════════════════════════════════════════════════════════════════
   Read / update one
   ══════════════════════════════════════════════════════════════════════════ */

export async function getMember(scope, memberId) {
  const snap = await db.doc(paths.member(scope.trustId, memberId)).get();
  if (!snap.exists) throw notFound('Member not found');

  const member = { id: snap.id, ...snap.data() };
  assertSameProgram(member, scope.programId);
  return member;
}

/**
 * Edit a member.
 *
 * Two fields are dangerous to change and are handled deliberately:
 *
 *   • `joinDateMs` decides which closings they owe. Moving it recomputes their
 *     whole ledger, so we re-derive dues here rather than leaving stale
 *     counters that would quietly under- or over-bill them.
 *   • `payAmount` re-prices OUTSTANDING dues only. Money already collected
 *     comes from receipts and is never retroactively re-priced.
 *
 * The ledger fields themselves are never editable through this path.
 */
export async function updateMember(scope, memberId, patch) {
  const { trustId, programId, uid } = scope;
  const [{ items: closings }, program] = await Promise.all([
    getClosingsIndex(trustId, programId),
    getProgram(scope, programId),
  ]);
  const ref = db.doc(paths.member(trustId, memberId));

  // Same rule as create: if the member is being moved to a different agent,
  // the new agent's name comes from the agent record.
  const reassigned =
    patch.agentId !== undefined || patch.addedBy !== undefined
      ? await resolveAgent(
          trustId,
          patch.addedBy === 'agent' ? patch.agentId : null,
        )
      : null;

  // Before the transaction, because a transaction cannot run a query — and
  // after `reassigned` so both pre-flight reads happen before anything locks.
  if (patch.aadhaarNo !== undefined) {
    await assertAadhaarFree(trustId, programId, patch.aadhaarNo, { exceptId: memberId });
  }

  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('Member not found');

    const member = { id: snap.id, ...snap.data() };
    assertSameProgram(member, programId);

    // Never let a caller write the ledger, the rates, or the agent's name.
    // All three are derived: the ledger only moves through a payment, the
    // rates come from the program's age bands, and the agent's name comes from
    // the agent record.
    const {
      paidUpTo, paidSeqs, exemptSeqs, partialPaid,
      paidCount, paidAmount, dueCount, dueAmount,
      payAmount, joinFees, ageGroup, ageGroupRange,
      agentName, addedByName,
      ...safe
    } = patch;

    // A changed birth date, joining date or location group can move the member
    // into a different age band, so the rates are re-derived from the program
    // exactly as they were on create.
    const ratesChanged =
      safe.bobDateMs !== undefined ||
      safe.joinDateMs !== undefined ||
      safe.locationGroupId !== undefined;

    if (ratesChanged) {
      const rates = resolveMemberRates(program, {
        bobDateMs: safe.bobDateMs ?? member.bobDateMs,
        joinDateMs: safe.joinDateMs ?? member.joinDateMs,
        locationGroupId: safe.locationGroupId ?? member.locactionGroupId,
      });
      Object.assign(safe, rates);

      /**
       * A new band means a new joining fee, so what is outstanding changes.
       *
       * Without this a member moved from an ₹1,100 band to an ₹11,000 one
       * would keep `joinFeesDue: 0` and go on showing the fee as settled,
       * while the counter screen offered nothing to collect.
       */
      const fees = joinFeesState({ ...member, joinFees: rates.joinFees });
      safe.joinFeesDue = fees.due;
      safe.joinFeesDone = fees.done;
      safe.joinFeesPaid = fees.paid;
    }

    // Moved to a different agent (or to none): take the name from the agent
    // record, the same way create does.
    if (reassigned) {
      safe.agentId = reassigned.agentId;
      safe.agentName = reassigned.agentName;
      safe.addedByName = reassigned.agentName || 'Admin';
    }

    const next = { ...member, ...safe };

    const eligibilityChanged =
      safe.joinDateMs !== undefined || safe.payAmount !== undefined;

    let ledgerPatch = {};
    if (eligibilityChanged) {
      const compacted = compactLedger(readLedger(member), next, closings);
      const due = computeDue({ ...next, ...compacted }, closings);
      ledgerPatch = {
        ...compacted,
        dueCount: due.dueCount,
        dueAmount: due.dueAmount,
      };
    }

    const finalPatch = {
      ...safe,
      ...ledgerPatch,
      // Rebuilt from the MERGED record, so a corrected phone number or a
      // renamed village is searchable immediately. Recomputing unconditionally
      // rather than only when a keyword field changed: the check would be a
      // list of field names to keep in sync with another list of field names,
      // and the cost is one pure function over a document already in memory.
      searchKeywords: memberKeywords({ ...next, ...ledgerPatch }),
      updatedAt: serverNow(),
      updatedBy: uid,
    };

    tx.update(ref, finalPatch);
    return { ...next, ...ledgerPatch };
  });

  await patchMemberInIndex(trustId, memberId, updated);
  return updated;
}

/** Soft delete — the record stays, so receipts referencing it still resolve. */
export async function deleteMember(scope, memberId) {
  const { trustId, programId, uid } = scope;
  const ref = db.doc(paths.member(trustId, memberId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('Member not found');

  const member = snap.data();
  assertSameProgram(member, programId);

  if ((member.paidCount ?? 0) > 0) {
    throw badRequest(
      'This member has payment history — block or mark them as left instead of deleting.',
    );
  }

  await ref.update({
    delete_flag: true,
    active_flag: false,
    exitDateMs: Date.now(),
    exitReason: EXIT_REASON.DELETED,
    updatedAt: serverNow(),
    updatedBy: uid,
  });

  await db.doc(paths.counterStats(trustId, programId)).set(
    { members: { total: inc(-1), [member.status]: inc(-1) }, updatedAt: serverNow() },
    { merge: true },
  );

  // The index is the list. Leaving a deleted member in it would put them back
  // on every screen, because nothing downstream reads member documents.
  await removeMemberFromIndex(trustId, memberId);

  return { id: memberId, deleted: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   Status changes
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Accept a pending member.
 *
 * The old system fired a Cloud Function here that wrote a `payment_pending`
 * document for every currently-open marriage case. Nothing needs writing now:
 * the moment `status` becomes accepted, the date rule already says what they
 * owe. We only refresh their due counters so the list screens stay accurate.
 */
export async function setMemberStatus(scope, memberId, status, { uid, reason, atMs } = {}) {
  const { trustId, programId } = scope;

  if (!Object.values(MEMBER_STATUS).includes(status)) {
    throw badRequest(`Unknown status "${status}"`);
  }

  const { items: closings } = await getClosingsIndex(trustId, programId);
  const memberRef = db.doc(paths.member(trustId, memberId));

  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) throw notFound('Member not found');

    const member = { id: snap.id, ...snap.data() };
    assertSameProgram(member, programId);

    const previous = member.status;
    if (previous === status) return { ...member, unchanged: true };

    const exiting =
      status === MEMBER_STATUS.BLOCKED ||
      status === MEMBER_STATUS.LEFT;

    const patch = {
      status,
      updatedAt: serverNow(),
      updatedBy: uid,
      ...(exiting
        ? {
            exitDateMs: atMs ?? Date.now(),
            exitReason:
              status === MEMBER_STATUS.BLOCKED
                ? EXIT_REASON.BLOCKED
                : EXIT_REASON.LEFT,
            exitNote: reason ?? '',
          }
        : {}),
      // Re-activating clears the exit, so past dues become owed again.
      ...(status === MEMBER_STATUS.ACCEPTED && previous !== MEMBER_STATUS.CLOSED
        ? { exitDateMs: null, exitReason: null }
        : {}),
    };

    const next = { ...member, ...patch };
    const due = computeDue(next, closings);
    patch.dueCount = due.dueCount;
    patch.dueAmount = due.dueAmount;

    tx.update(memberRef, patch);

    tx.set(
      db.doc(paths.counterStats(trustId, programId)),
      {
        members: { [previous]: inc(-1), [status]: inc(1) },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    return { ...next, ...patch };
  });

  if (!updated.unchanged) {
    await patchMemberInIndex(trustId, memberId, updated);
  }
  return updated;
}

/* ══════════════════════════════════════════════════════════════════════════
   List
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One page of members.
 *
 * Cost: exactly `limit` document reads (50 by default) plus a cached count.
 * Nothing here scales with the size of the trust.
 */
export async function listMembers(scope, params = {}) {
  const { items } = await getMembersIndex(scope.trustId);

  // The program comes from the caller's scope unless they explicitly ask to
  // look across all of them, which the reports and the phone lookup do.
  const programId = params.programId ?? scope.programId;

  const filtered = filterMembers(items, {
    ...params,
    programId: params.allPrograms ? 'all' : programId,
  });

  const sorted = sortMembers(filtered, params.sortBy, params.sortDir);
  const page = paginate(sorted, {
    page: params.page,
    limit: Math.min(
      Number(params.limit) || LIMITS.PAGE_SIZE,
      LIMITS.MAX_INDEX_PAGE,
    ),
  });

  return {
    members: page.rows.map(fromMemberEntry),
    page: page.page,
    pages: page.pages,
    pageSize: page.pageSize,
    total: page.total,
    // Totals span the whole filtered set, not the page on screen — "कुल बकाया"
    // that only added up the 50 visible rows would be worse than showing
    // nothing, because it looks like an answer.
    totals: summarise(filtered),
    // The dropdown options, counted, from the same load. Built from every
    // member in the program rather than the filtered set, so narrowing down
    // never removes the option you would use to widen again.
    facets: facetsFor(
      params.allPrograms ? items : items.filter((m) => m.pid === programId),
    ),
    indexed: items.length,
  };
}

/**
 * Free-text search, ranked.
 *
 * Same index, same filters — the only difference from `listMembers` is that
 * results come back ordered by how well they match rather than by
 * registration number, and the caller usually wants a short list.
 */
export async function searchMembers(scope, term, params = {}) {
  const q = String(term ?? '').trim();
  if (q.length < 2) return { members: [], term: q, total: 0 };

  const { items } = await getMembersIndex(scope.trustId);

  const filtered = filterMembers(items, {
    ...params,
    q,
    programId: params.allPrograms ? 'all' : (params.programId ?? scope.programId),
  });

  const sorted = sortMembers(filtered, params.sortBy, params.sortDir);
  const limit = Math.min(Number(params.limit) || 30, LIMITS.MAX_INDEX_PAGE);

  return {
    members: sorted.slice(0, limit).map(fromMemberEntry),
    term: q,
    total: sorted.length,
    searched: items.length,
  };
}

/**
 * Find members by phone across EVERY program in the trust.
 *
 * This powers "copy from existing member": families join more than one योजना,
 * and re-typing a name, father's name, village, address and documents for the
 * second one is both slow and a source of mismatched records for what is
 * really the same person.
 *
 * Deliberately searches other programs too — the whole point is to pull data
 * ACROSS programs. The caller filters out the program being joined.
 */
export async function findMembersByPhone(scope, phone) {
  const clean = String(phone ?? '').replace(/\D+/g, '');
  if (clean.length < 6) return { members: [] };

  const { items } = await getMembersIndex(scope.trustId);

  const matches = items.filter((m) => {
    const a = String(m.phone ?? '').replace(/\D+/g, '');
    const b = String(m.ph2 ?? '').replace(/\D+/g, '');
    return a === clean || b === clean;
  });

  return { members: matches.slice(0, 25).map(fromMemberEntry) };
}

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The whole dashboard in ONE document read.
 *
 * The old `/api/payments/fetch` read the entire payment_pending collection and
 * the entire transactions collection for this same screen — roughly 2.5 million
 * documents, about $1.50 per load.
 */
export async function getStats(scope) {
  const { trustId, programId } = scope;
  const snap = await db.doc(paths.counterStats(trustId, programId)).get();

  if (!snap.exists) return recomputeStats(scope);
  return { ...snap.data(), source: 'counters' };
}

/**
 * Recompute every counter from scratch using aggregation queries.
 *
 * Firestore bills a `count()` as a few reads regardless of how many documents
 * match, so even a full recount of a 5,000-member trust is nearly free. Run it
 * nightly to heal any drift, and after a migration.
 */
export async function recomputeStats(scope) {
  const { trustId, programId } = scope;

  const members = db
    .collection(paths.members(trustId))
    .where('programId', '==', programId)
    .where('delete_flag', '==', false);
  const closings = db.collection(paths.closings(trustId, programId));

  const [total, pending, accepted, closed, blocked, closingTotal, closingActive] =
    await Promise.all([
      countQuery(members),
      countQuery(members.where('status', '==', MEMBER_STATUS.PENDING)),
      countQuery(members.where('status', '==', MEMBER_STATUS.ACCEPTED)),
      countQuery(members.where('status', '==', MEMBER_STATUS.CLOSED)),
      countQuery(members.where('status', '==', MEMBER_STATUS.BLOCKED)),
      countQuery(closings),
      countQuery(closings.where('status', '==', 'active')),
    ]);

  // Money totals come from the closing documents' own counters — 500 reads,
  // not 2.5 million.
  const closingSnap = await closings
    .select('paidAmount', 'eligibleAmount', 'seq', 'status')
    .get();

  let collectedTotal = 0;
  let expectedTotal = 0;
  let maxSeq = 0;

  for (const doc of closingSnap.docs) {
    const c = doc.data();
    if (c.status === 'reverted') continue;
    collectedTotal += Number(c.paidAmount) || 0;
    expectedTotal += Number(c.eligibleAmount) || 0;
    maxSeq = Math.max(maxSeq, c.seq ?? 0);
  }

  const stats = {
    members: { total, pending, accepted, closed, blocked },
    closings: { total: closingTotal, active: closingActive, maxSeq },
    money: {
      collectedTotal,
      expectedTotal,
      dueTotal: Math.max(0, expectedTotal - collectedTotal),
    },
    recomputedAt: serverNow(),
    updatedAt: serverNow(),
  };

  await db
    .doc(paths.counterStats(trustId, programId))
    .set(stats, { merge: true });

  return { ...stats, source: 'recomputed' };
}

/* ══════════════════════════════════════════════════════════════════════════
   Counts
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every count the app shows, from the same index that serves the list.
 *
 * This is why the numbers can be trusted: the dashboard's "1,240 सक्रिय" and
 * the 1,240 rows you get after clicking it are the same computation over the
 * same array. Counters kept separately in a document drift — a payment that
 * updates the member but misses the counter is invisible until someone adds
 * the column up by hand.
 *
 * Cost is the index load: about ten reads for 5,000 members, none while warm,
 * regardless of how many groupings are asked for.
 */
export async function getMemberSummary(scope, params = {}) {
  const { items } = await getMembersIndex(scope.trustId);

  const programId = params.programId ?? scope.programId;
  const scoped = filterMembers(items, {
    ...params,
    programId: params.allPrograms ? 'all' : programId,
  });

  const groups = {};
  for (const by of params.groupBy ?? ['status', 'agent', 'program']) {
    groups[by] = groupMembers(scoped, by);
  }

  return {
    ...countsFor(scoped),
    groups,
    indexed: items.length,
    scope: params.allPrograms ? 'all' : programId,
  };
}

/**
 * The whole filtered set, for an export.
 *
 * Deliberately not paginated. An export of "page 1 of 47" is not an export,
 * and the cost is the same index load either way — the only real limit is how
 * big a file is reasonable, which is what MAX_EXPORT_ROWS is for.
 */
export async function listMembersForExport(scope, params = {}) {
  const { items } = await getMembersIndex(scope.trustId);

  const filtered = filterMembers(items, {
    ...params,
    programId: params.allPrograms ? 'all' : (params.programId ?? scope.programId),
  });

  const sorted = sortMembers(filtered, params.sortBy, params.sortDir);

  return {
    members: sorted.slice(0, LIMITS.MAX_EXPORT_ROWS).map(fromMemberEntry),
    total: sorted.length,
    truncated: sorted.length > LIMITS.MAX_EXPORT_ROWS,
    totals: summarise(sorted),
  };
}
