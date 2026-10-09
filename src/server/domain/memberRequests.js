import 'server-only';

import { ensureMemberLogin } from './memberLogin.js';

import { db, serverNow, countQuery } from '../firebase/admin.js';
import { createMember, findMemberByAadhaar } from './members.js';
import { getProgram, resolveMemberRates } from './programs.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import {
  MEMBER_REQUEST_STATUS as RS,
  MEMBER_STATUS,
  PAYMENT_METHOD,
  ROLE,
  paths,
} from '../../config/constants.js';

/**
 * memberRequests.js — "please add this member", from an agent's phone.
 *
 * An agent in a village fills the form in the agent app; the office sees it
 * under सदस्य अनुरोध, checks it, and approves or rejects it.
 *
 * A request is deliberately NOT a member with `status: pending`. A member
 * document burns a registration number, moves the program's counters, lands
 * in the search index and starts appearing on every list and every count —
 * all for somebody the office has not yet agreed to enrol. A rejected request
 * would then leave a hole in the registration sequence and a soft-deleted
 * record on every export. So the request lives in its own collection and the
 * member is created only on approval, by the same `createMember` the counter
 * uses: same rates from the age band, same registration recipe, same joining
 * fee receipt, same commission for the agent.
 *
 * Money: an agent may record that they took the joining fee in hand. That is
 * a CLAIM until approval — no receipt exists for it yet. On approval the
 * office confirms the amount and `createMember` posts the real receipt,
 * credited to the agent, inside a transaction like every other receipt.
 */

const isStaff = (role) => [ROLE.OPERATOR, ROLE.ADMIN, ROLE.OWNER].includes(role);

function view(doc) {
  const d = doc.data();
  return { id: doc.id, ...d, createdAt: null, updatedAt: null, reviewedAt: null };
}

/** Agent submits a request. */
export async function createMemberRequest(scope, input) {
  if (scope.role !== ROLE.AGENT || !scope.agentId) {
    throw forbidden('सदस्य अनुरोध केवल एजेंट भेज सकता है');
  }

  const programId = input.programId;
  const program = await getProgram(scope, programId);

  const joinDateMs = Number(input.joinDateMs);
  const bobDateMs = Number(input.bobDateMs);
  if (!Number.isFinite(joinDateMs)) throw badRequest('जुड़ने की तारीख़ ज़रूरी है');
  if (!Number.isFinite(bobDateMs)) throw badRequest('जन्म तिथि ज़रूरी है');

  // The same age-band match the office will run on approval, shown to the
  // agent now so the family hears the right figure in the village.
  const rates = resolveMemberRates(program, {
    bobDateMs, joinDateMs, locationGroupId: input.locationGroupId,
  });

  // An आधार already on a member of this योजना is refused now, not on
  // approval — the agent is standing in front of the family and can sort it out.
  if (input.aadhaarNo) {
    const clash = await aadhaarClash(scope, programId, input.aadhaarNo);
    if (clash) throw conflict(clash.message, { field: 'aadhaarNo', ...(clash.memberId ? { memberId: clash.memberId } : {}) });
  }

  const agentSnap = await db.doc(paths.agent(scope.trustId, scope.agentId)).get();
  if (!agentSnap.exists) throw forbidden('एजेंट खाता नहीं मिला');

  const fee = Number(rates.joinFees) || 0;
  const collected = Math.min(fee, Math.max(0, Number(input.joinFeesCollected) || 0));

  const ref = db.collection(paths.memberRequests(scope.trustId)).doc();
  const now = Date.now();

  const request = {
    programId,
    programName: program.name ?? '',

    displayName: input.displayName,
    fatherName: input.fatherName ?? '',
    gender: input.gender ?? '',
    jati: input.jati ?? '',
    gotra: input.gotra ?? '',
    guardian: input.guardian ?? '',
    guardianRelation: input.guardianRelation ?? '',
    phone: input.phone ?? '',
    phoneAlt: input.phoneAlt ?? '',
    aadhaarNo: input.aadhaarNo ?? '',
    bobDate: input.bobDate ?? '',
    bobDateMs,
    joinDate: input.joinDate ?? '',
    joinDateMs,
    locationGroupId: input.locationGroupId ?? null,
    state: input.state ?? '',
    district: input.district ?? '',
    village: input.village ?? '',
    pinCode: input.pinCode ?? '',
    currentAddress: input.currentAddress ?? '',
    photoURL: input.photoURL ?? '',
    documentFrontURL: input.documentFrontURL ?? '',
    documentBackURL: input.documentBackURL ?? '',
    extraImageURL: input.extraImageURL ?? '',
    guardianDocumentURL: input.guardianDocumentURL ?? '',
    extraDetails: Array.isArray(input.extraDetails)
      ? input.extraDetails.filter((d) => d?.label || d?.value).slice(0, 20)
      : [],
    note: input.note ?? '',

    // What the age band says — a preview, re-derived on approval.
    ageGroupRange: rates.ageGroupRange ?? '',
    age: rates.age ?? null,
    payAmount: rates.payAmount ?? 0,
    joinFees: fee,

    // The agent's claim about money in hand. Not a receipt.
    joinFeesCollected: collected,
    joinFeesMethod: input.joinFeesMethod ?? PAYMENT_METHOD.CASH,
    joinFeesReference: input.joinFeesReference ?? '',

    agentId: scope.agentId,
    agentName: agentSnap.data().displayName ?? '',
    agentPhone: agentSnap.data().phone ?? '',

    status: RS.PENDING,
    memberId: null,
    registrationNumber: null,
    rejectReason: '',

    createdAtMs: now,
    createdAt: serverNow(),
    createdBy: scope.uid,
    updatedAt: serverNow(),
  };

  await ref.set(request);
  return { id: ref.id, ...request, createdAt: null, updatedAt: null };
}

/**
 * List requests. An agent sees only their own; the office sees everyone's.
 *
 * Single-field equality queries only, sorted in memory — so no composite
 * index is needed, and the volume (a few dozen a month) makes that free.
 */
/**
 * Is this आधार already used in this योजना — by a member, or by a request still
 * waiting? Same rule the office form uses (one person, one membership per
 * योजना). Returns `null` when free, else `{ message, memberId? }`.
 * `exceptRequestId` skips the request being corrected.
 */
export async function aadhaarClash(scope, programId, aadhaar, { exceptRequestId } = {}) {
  const clean = String(aadhaar ?? '').replace(/\D+/g, '');
  if (clean.length !== 12) return null;

  const member = await findMemberByAadhaar({ ...scope, programId }, clean);
  if (member) {
    return {
      memberId: member.id,
      message: `यह आधार पहले से इस योजना में सदस्य ${member.displayName} (रजि. ${member.registrationNumber}) पर दर्ज है`,
    };
  }
  const dup = await db
    .collection(paths.memberRequests(scope.trustId))
    .where('aadhaarNo', '==', clean)
    .limit(10)
    .get();
  const open = dup.docs.find((x) => x.id !== exceptRequestId
    && x.data().programId === programId
    && [RS.PENDING, RS.APPROVING].includes(x.data().status));
  if (open) {
    return { message: `इस आधार का अनुरोध पहले से लंबित है — ${open.data().displayName}` };
  }
  return null;
}

export async function listMemberRequests(scope, { status, agentId, programId } = {}) {
  const col = db.collection(paths.memberRequests(scope.trustId));
  let query;

  if (scope.role === ROLE.AGENT) {
    query = col.where('agentId', '==', scope.agentId);
  } else if (!isStaff(scope.role)) {
    throw forbidden();
  } else if (status && status !== 'all') {
    query = col.where('status', '==', status);
  } else if (agentId) {
    query = col.where('agentId', '==', agentId);
  } else {
    query = col.orderBy('createdAtMs', 'desc');
  }

  const snap = await query.limit(500).get();
  let rows = snap.docs.map(view).filter((r) => r.status !== RS.REMOVED);

  if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
  if (agentId && scope.role !== ROLE.AGENT) rows = rows.filter((r) => r.agentId === agentId);
  if (programId && programId !== 'all') rows = rows.filter((r) => r.programId === programId);

  rows.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) if (counts[r.status] !== undefined) counts[r.status] += 1;

  return { requests: rows, counts };
}

/** The badge on the office's menu: how many are waiting. One aggregation read. */
export async function countPendingRequests(scope) {
  return countQuery(
    db.collection(paths.memberRequests(scope.trustId)).where('status', '==', RS.PENDING),
  );
}

export async function getMemberRequest(scope, id) {
  const snap = await db.doc(paths.memberRequest(scope.trustId, id)).get();
  if (!snap.exists) throw notFound('अनुरोध नहीं मिला');
  const req = view(snap);
  if (scope.role === ROLE.AGENT && req.agentId !== scope.agentId) throw notFound('अनुरोध नहीं मिला');
  return req;
}

/**
 * Approve: create the member, exactly as the counter would.
 *
 * Guarded by a status flip to `approving` in its own transaction first, so two
 * staff pressing स्वीकार at once cannot create the same person twice. If the
 * member cannot be created (an आधार that has since been used, say) the
 * request goes back to `pending` with the reason, and nothing else changed.
 *
 * `overrides` is what the office corrected on review — the joining date, the
 * registration number from a paper form, the fee actually handed over.
 */
export async function approveMemberRequest(scope, id, overrides = {}) {
  if (!isStaff(scope.role)) throw forbidden();
  const ref = db.doc(paths.memberRequest(scope.trustId, id));

  const req = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('अनुरोध नहीं मिला');
    const r = snap.data();
    if (r.status === RS.APPROVED) throw conflict('यह अनुरोध पहले ही स्वीकार हो चुका है', { memberId: r.memberId });
    if (r.status !== RS.PENDING) throw conflict(`यह अनुरोध अभी "${r.status}" है — स्वीकार नहीं हो सकता`);
    tx.update(ref, { status: RS.APPROVING, updatedAt: serverNow() });
    return { id: snap.id, ...r };
  });

  try {
    const feeNow = overrides.joinFeesPaidNow !== undefined
      ? Number(overrides.joinFeesPaidNow) || 0
      : Number(req.joinFeesCollected) || 0;

    const member = await createMember({ ...scope, programId: req.programId }, {
      programId: req.programId,
      displayName: overrides.displayName ?? req.displayName,
      fatherName: req.fatherName,
      gender: req.gender,
      jati: req.jati,
      gotra: req.gotra,
      guardian: req.guardian,
      guardianRelation: req.guardianRelation,
      phone: req.phone,
      phoneAlt: req.phoneAlt,
      aadhaarNo: req.aadhaarNo,
      bobDate: req.bobDate,
      bobDateMs: req.bobDateMs,
      joinDate: overrides.joinDate ?? req.joinDate,
      joinDateMs: overrides.joinDateMs ?? req.joinDateMs,
      locationGroupId: req.locationGroupId ?? undefined,
      state: req.state,
      district: req.district,
      village: req.village,
      pinCode: req.pinCode,
      currentAddress: req.currentAddress,
      photoURL: req.photoURL,
      documentFrontURL: req.documentFrontURL,
      documentBackURL: req.documentBackURL,
      extraImageURL: req.extraImageURL ?? '',
      guardianDocumentURL: req.guardianDocumentURL ?? '',
      extraDetails: req.extraDetails ?? [],
      // Enrolled UNDER the agent who brought them — that is what puts them in
      // the agent's list and pays the agent's joining-fee commission.
      addedBy: 'agent',
      agentId: req.agentId,
      joinFeesPaidNow: feeNow,
      joinFeesMethod: overrides.joinFeesMethod ?? req.joinFeesMethod ?? PAYMENT_METHOD.CASH,
      joinFeesTxtId: overrides.joinFeesReference ?? req.joinFeesReference ?? '',
      ...(overrides.registrationNumber ? { registrationNumber: String(overrides.registrationNumber) } : {}),
      status: MEMBER_STATUS.ACCEPTED,
    });

    await ref.update({
      status: RS.APPROVED,
      memberId: member.id,
      registrationNumber: member.registrationNumber,
      joinFeesReceived: member.joinFeesPaid ?? 0,
      reviewNote: overrides.note ?? '',
      reviewedBy: scope.uid,
      reviewedByName: scope.name ?? '',
      reviewedAtMs: Date.now(),
      reviewedAt: serverNow(),
      updatedAt: serverNow(),
    });

    const login = await ensureMemberLogin({ ...scope, programId: req.programId }, member);
    return { request: { ...req, status: RS.APPROVED, memberId: member.id, registrationNumber: member.registrationNumber }, member, login };
  } catch (error) {
    await ref.update({
      status: RS.PENDING,
      lastError: String(error?.message ?? error).slice(0, 300),
      updatedAt: serverNow(),
    });
    throw error;
  }
}

/** Reject, with a reason the agent will read. */
export async function rejectMemberRequest(scope, id, { reason } = {}) {
  if (!isStaff(scope.role)) throw forbidden();
  const text = String(reason ?? '').trim();
  if (text.length < 2) throw badRequest('अस्वीकार करने का कारण लिखें — एजेंट यही पढ़ेगा');

  const ref = db.doc(paths.memberRequest(scope.trustId, id));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('अनुरोध नहीं मिला');
    if (snap.data().status !== RS.PENDING) {
      throw conflict(`यह अनुरोध अभी "${snap.data().status}" है — अस्वीकार नहीं हो सकता`);
    }
    const patch = {
      status: RS.REJECTED,
      rejectReason: text,
      reviewedBy: scope.uid,
      reviewedByName: scope.name ?? '',
      reviewedAtMs: Date.now(),
      reviewedAt: serverNow(),
      updatedAt: serverNow(),
    };
    tx.update(ref, patch);
    return { id, ...snap.data(), ...patch, reviewedAt: null, updatedAt: null, createdAt: null };
  });
}

/**
 * Remove a request from the lists.
 *
 * The office may remove any request that has not become a member; an agent
 * may withdraw their own while it is still waiting or after it was rejected.
 * Kept as `removed` rather than deleted, so "who asked for what" still has an
 * answer later. An approved request cannot be removed — it IS a member now,
 * and that member is managed from the members screen.
 */
export async function removeMemberRequest(scope, id) {
  const ref = db.doc(paths.memberRequest(scope.trustId, id));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('अनुरोध नहीं मिला');
    const r = snap.data();
    if (scope.role === ROLE.AGENT) {
      if (r.agentId !== scope.agentId) throw notFound('अनुरोध नहीं मिला');
    } else if (!isStaff(scope.role)) {
      throw forbidden();
    }
    if (r.status === RS.APPROVED || r.status === RS.APPROVING) {
      throw conflict('स्वीकृत अनुरोध हटाया नहीं जा सकता — सदस्य अब सदस्य सूची में है');
    }
    tx.update(ref, {
      status: RS.REMOVED,
      previousStatus: r.status,
      removedBy: scope.uid,
      removedAtMs: Date.now(),
      updatedAt: serverNow(),
    });
    return { id, removed: true };
  });
}

/**
 * Agent edits a request that is still waiting, or fixes a rejected one and
 * sends it again. Re-validated the same way as a new request.
 */
export async function resubmitMemberRequest(scope, id, input) {
  const existing = await getMemberRequest(scope, id);
  if (scope.role !== ROLE.AGENT || existing.agentId !== scope.agentId) throw forbidden();
  if (![RS.PENDING, RS.REJECTED].includes(existing.status)) {
    throw conflict('यह अनुरोध अब बदला नहीं जा सकता');
  }
  // Withdraw the old one and file a fresh one, so the office sees it at the
  // top of the queue with a clean history rather than an edited rejection.
  await removeMemberRequest(scope, id);
  let created;
  try {
    created = await createMemberRequest(scope, { ...input, programId: input.programId ?? existing.programId });
  } catch (error) {
    // The new one was refused — put the old one back as it was.
    await db.doc(paths.memberRequest(scope.trustId, id)).update({ status: existing.status });
    throw error;
  }
  await db.doc(paths.memberRequest(scope.trustId, created.id)).update({ replaces: id });
  return { ...created, replaces: id };
}
