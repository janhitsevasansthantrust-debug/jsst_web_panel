import 'server-only';

import { db } from '../firebase/admin.js';
import { getClosingsIndex, getMembersIndex, fromMemberEntry } from './indexes.js';
import {
  memberTimeline, summariseTimeline, linkedEntries, maskAadhaar,
} from './portalMath.js';
import { forbidden, notFound } from '../errors.js';
import { LIMITS, MEMBER_STATUS, ROLE, paths } from '../../config/constants.js';

/**
 * memberPortal.js — what a member sees in the member app.
 *
 * A member signs in with their registration number. They see themselves AND
 * everyone else registered on the same mobile number, in every योजना — that is
 * how a family actually thinks about it: one phone, a father in the विवाह
 * योजना and two sons in the सुरक्षा योजना.
 *
 * Every read here is scoped from the VERIFIED session, never from a URL: the
 * member id in a request is checked against the linked set before anything is
 * read, so editing a URL cannot open somebody else's account.
 */

/**
 * Who is signed in, as a member record.
 *
 * Logins made by the office carry `memberId` in their claims. Logins carried
 * over from the old app do not — they only have `1023@gmail.com` — so the
 * registration number is read back out of the email.
 */
export async function resolvePortalSelf(session) {
  if (session.role && session.role !== ROLE.MEMBER) {
    throw forbidden('यह सदस्य ऐप है — स्टाफ/एजेंट अपने ऐप से लॉगिन करें');
  }

  if (session.memberId) {
    const snap = await db.doc(paths.member(session.trustId, session.memberId)).get();
    if (snap.exists && !snap.data().delete_flag) return { id: snap.id, ...snap.data() };
  }

  const reg = String(session.email ?? '').split('@')[0].trim();
  if (reg) {
    const snap = await db
      .collection(paths.members(session.trustId))
      .where('registrationNumber', '==', reg)
      .limit(10)
      .get();
    const live = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => !m.delete_flag);
    // Prefer a current member over a closed one when the same number exists
    // in two योजनाएँ — either way the rest are listed by phone.
    const rank = (m) => (m.status === MEMBER_STATUS.ACCEPTED ? 0 : m.status === MEMBER_STATUS.CLOSED ? 1 : 2);
    live.sort((a, b) => rank(a) - rank(b));
    if (live[0]) return live[0];
  }

  throw forbidden('यह लॉगिन किसी सदस्य से जुड़ा नहीं है — कार्यालय से संपर्क करें');
}

/** The signed-in member plus everyone on their mobile number, from the index. */
export async function linkedMembers(session, self) {
  const { items } = await getMembersIndex(session.trustId);
  const entries = linkedEntries(self, items);
  // The member's own record may not be in the index yet (just enrolled); make
  // sure they are always on their own list.
  const list = entries.map(fromMemberEntry);
  if (!list.some((m) => m.id === self.id)) list.unshift(publicSummary(self));
  return list;
}

/** Refuse anything outside the signed-in member's family. */
export async function assertLinked(session, memberId) {
  const self = await resolvePortalSelf(session);
  const list = await linkedMembers(session, self);
  const hit = list.find((m) => m.id === memberId);
  if (!hit) throw notFound('यह सदस्य आपके मोबाइल नंबर से जुड़ा नहीं है');
  return { self, list };
}

/**
 * The home screen: every linked member, grouped by योजना, with their totals.
 *
 * Totals come from the counters each member already carries (kept current by
 * every receipt), so the home screen costs the index load and nothing per
 * member.
 */
export async function getPortalHome(session) {
  const self = await resolvePortalSelf(session);
  const members = await linkedMembers(session, self);

  const programIds = [...new Set(members.map((m) => m.programId).filter(Boolean))];
  const programSnaps = programIds.length
    ? await db.getAll(...programIds.map((id) => db.doc(paths.program(session.trustId, id))))
    : [];
  const programs = programSnaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, name: s.data().name ?? '', hiname: s.data().hiname ?? '', category: s.data().category ?? '' }));

  const rows = members.map((m) => ({
    id: m.id,
    registrationNumber: m.registrationNumber,
    displayName: m.displayName,
    fatherName: m.fatherName,
    village: m.village,
    phone: m.phone,
    photoURL: m.photoURL,
    status: m.status,
    programId: m.programId,
    programName: m.programName,
    agentName: m.agentName,
    joinDateMs: m.joinDateMs,
    payAmount: m.payAmount,
    dueCount: m.dueCount ?? 0,
    dueAmount: m.dueAmount ?? 0,
    paidCount: m.paidCount ?? 0,
    paidAmount: m.paidAmount ?? 0,
    joinFees: m.joinFees ?? 0,
    joinFeesPaid: m.joinFeesPaid ?? 0,
    joinFeesDue: m.joinFeesDue ?? 0,
    isSelf: m.id === self.id,
  }));

  const totals = rows.reduce((t, r) => ({
    members: t.members + 1,
    dueAmount: t.dueAmount + (r.dueAmount || 0),
    paidAmount: t.paidAmount + (r.paidAmount || 0),
    feeDue: t.feeDue + (r.joinFeesDue || 0),
  }), { members: 0, dueAmount: 0, paidAmount: 0, feeDue: 0 });

  return {
    self: { id: self.id, displayName: self.displayName ?? '', registrationNumber: self.registrationNumber ?? '', phone: self.phone ?? '' },
    programs,
    members: rows,
    totals,
  };
}

/**
 * One member, in full: profile, every closing they are liable for with paid /
 * pending status and when it was paid (on time or late), the receipts, and
 * the joining fee.
 *
 * Reads: the member, the cached closings index, their receipts (up to 300),
 * the program and the closing batches' due dates. Nothing here grows with the
 * size of the trust.
 */
export async function getPortalMember(session, memberId, { nowMs = Date.now() } = {}) {
  await assertLinked(session, memberId);
  return buildMemberDetail(session.trustId, memberId, { nowMs, forMember: true });
}

/**
 * Shared by the member app and the agent app — the same picture of a member
 * for both, so the two cannot disagree.
 */
export async function buildMemberDetail(trustId, memberId, { nowMs = Date.now(), forMember = false } = {}) {
  const snap = await db.doc(paths.member(trustId, memberId)).get();
  if (!snap.exists || snap.data().delete_flag) throw notFound('सदस्य नहीं मिला');
  const member = { id: snap.id, ...snap.data() };
  const programId = member.programId;

  const [{ items: closings }, programSnap, receiptsSnap, batchesSnap, agentSnap] = await Promise.all([
    getClosingsIndex(trustId, programId),
    db.doc(paths.program(trustId, programId)).get(),
    db.collection(paths.payments(trustId, programId))
      .where('memberId', '==', memberId)
      .where('delete_flag', '==', false)
      .orderBy('paidAtMs', 'desc')
      .limit(300)
      .get(),
    db.collection(paths.closingBatches(trustId, programId)).select('dueDateMs', 'name').get(),
    member.agentId ? db.doc(paths.agent(trustId, member.agentId)).get() : Promise.resolve(null),
  ]);

  const program = programSnap.exists ? programSnap.data() : {};
  const batchDueMs = {};
  const batchNames = {};
  for (const b of batchesSnap.docs) {
    if (b.data().dueDateMs) batchDueMs[b.id] = b.data().dueDateMs;
    batchNames[b.id] = b.data().name ?? '';
  }

  const receipts = receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const graceDays = Number.isFinite(Number(program.paymentGraceDays))
    ? Number(program.paymentGraceDays)
    : LIMITS.PAYMENT_GRACE_DAYS;

  const timeline = memberTimeline(member, closings, receipts, { nowMs, batchDueMs, graceDays })
    .map((r) => ({ ...r, batchName: r.batchId ? (batchNames[r.batchId] ?? '') : '' }));
  const summary = summariseTimeline(timeline);

  const joinFees = Number(member.joinFees) || 0;
  const joinFeesPaid = member.joinFeesPaid ?? (member.joinFeesDone ? joinFees : 0);
  const joinFeesDue = member.joinFeesDue ?? Math.max(0, joinFees - joinFeesPaid);

  return {
    member: {
      id: member.id,
      registrationNumber: member.registrationNumber ?? '',
      displayName: member.displayName ?? '',
      fatherName: member.fatherName ?? '',
      guardian: member.guardian ?? '',
      guardianRelation: member.guardianRelation ?? '',
      gender: member.gender ?? '',
      jati: member.jati ?? '',
      gotra: member.gotra ?? '',
      phone: member.phone ?? '',
      phoneAlt: member.phoneAlt ?? '',
      aadhaarNo: forMember ? maskAadhaar(member.aadhaarNo) : (member.aadhaarNo ?? ''),
      bobDateMs: member.bobDateMs ?? null,
      age: member.age ?? null,
      ageGroupRange: member.ageGroupRange ?? '',
      joinDateMs: member.joinDateMs ?? null,
      village: member.village ?? '',
      district: member.district ?? '',
      state: member.state ?? '',
      pinCode: member.pinCode ?? '',
      currentAddress: member.currentAddress ?? '',
      photoURL: member.photoURL ?? '',
      status: member.status ?? '',
      closingDateMs: member.closingDateMs ?? null,
      exitDateMs: member.exitDateMs ?? null,
      programId,
      programName: member.programName ?? program.name ?? '',
      payAmount: member.payAmount ?? 0,
      agentId: member.agentId ?? null,
      agentName: member.agentName ?? '',
      agentPhone: agentSnap?.exists ? (agentSnap.data().phone ?? '') : '',
      lastPaymentAt: member.lastPaymentAt ?? null,
      creditBalance: member.creditBalance ?? 0,
    },
    joinFee: { total: joinFees, paid: joinFeesPaid, due: joinFeesDue, done: joinFeesDue <= 0 },
    summary,
    timeline,
    graceDays,
    receipts: receipts.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo ?? '',
      paidAtMs: r.paidAtMs ?? null,
      method: r.method ?? '',
      reference: r.reference ?? '',
      totalAmount: r.totalAmount ?? 0,
      closingAmount: r.closingAmount ?? 0,
      joinFeeAmount: r.joinFeeAmount ?? 0,
      itemCount: r.itemCount ?? (r.items ?? []).length,
      items: (r.items ?? []).map((i) => ({ seq: i.seq, name: i.name ?? '', amount: i.amount ?? 0, dateMs: i.closingDateMs ?? i.dateMs ?? null })),
      reversedSeqs: r.reversedSeqs ?? [],
      status: r.status ?? 'completed',
      collectedByAgentName: r.collectedByAgentName ?? '',
      note: r.note ?? '',
    })),
  };
}

function publicSummary(m) {
  return {
    id: m.id,
    registrationNumber: m.registrationNumber,
    displayName: m.displayName,
    fatherName: m.fatherName,
    village: m.village,
    phone: m.phone,
    photoURL: m.photoURL,
    status: m.status,
    programId: m.programId,
    programName: m.programName,
    agentName: m.agentName,
    joinDateMs: m.joinDateMs,
    payAmount: m.payAmount,
    dueCount: m.dueCount,
    dueAmount: m.dueAmount,
    paidCount: m.paidCount,
    paidAmount: m.paidAmount,
    joinFees: m.joinFees,
    joinFeesPaid: m.joinFeesPaid,
    joinFeesDue: m.joinFeesDue,
  };
}

/**
 * Everything for the member app's one-screen view: every linked member's
 * closings (with batch), receipts and joining fee, in one answer — so the app
 * can show family-wide batch lists, payment history and a "what to pay"
 * builder without a request per member.
 *
 * Cost: per linked member one member read + their receipts (≤300) + the
 * programme's cached closings index and batches. A family is a handful of
 * people, so this stays small.
 */
export async function getPortalFamily(session, { nowMs = Date.now() } = {}) {
  const home = await getPortalHome(session);
  const details = await Promise.all(home.members.map((m) =>
    buildMemberDetail(session.trustId, m.id, { nowMs, forMember: true }).catch(() => null)));

  const programName = Object.fromEntries(home.programs.map((p) => [p.id, p.hiname || p.name]));
  const members = home.members.map((m, i) => {
    const d = details[i];
    if (!d) return { ...m, timeline: [], receipts: [], summary: null, joinFee: null };
    return {
      ...m,
      programName: programName[m.programId] || m.programName || '',
      summary: d.summary,
      joinFee: d.joinFee,
      graceDays: d.graceDays,
      // Only what the lists need — a long-standing member has hundreds of rows.
      timeline: d.timeline.map((r) => ({
        seq: r.seq, name: r.name, regNo: r.regNo, village: r.village, dateMs: r.dateMs,
        batchId: r.batchId, batchName: r.batchName, dueByMs: r.dueByMs,
        amount: r.amount, paid: r.paid, remaining: r.remaining, status: r.status,
        timing: r.timing, lateByDays: r.lateByDays, overdue: r.overdue, overdueDays: r.overdueDays,
        paidAtMs: r.paidAtMs, receiptNo: r.receiptNo,
      })),
      receipts: d.receipts,
    };
  });

  return { ...home, members };
}
