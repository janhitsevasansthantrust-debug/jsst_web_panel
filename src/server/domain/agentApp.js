import 'server-only';

import { db } from '../firebase/admin.js';
import { getClosingsIndex, getMembersIndex, fromMemberEntry } from './indexes.js';
import { collectionReport } from './collectionReport.js';
import { buildMemberDetail } from './memberPortal.js';
import { closingsForMembers, totalClosings } from './portalMath.js';
import { listMemberRequests } from './memberRequests.js';
import { forbidden, notFound } from '../errors.js';
import { ROLE, paths } from '../../config/constants.js';

/**
 * agentApp.js — the agent's own phone app.
 *
 * Everything is cut down to `scope.agentId`, taken from the verified session.
 * Nearly all of it is answered from the shared member index (which already
 * carries every member's ledger) and the cached closings index — so the
 * agent's home screen and closing list cost a handful of cached reads no
 * matter how many members the agent has.
 */

function requireAgent(scope) {
  if (scope.role !== ROLE.AGENT || !scope.agentId) {
    throw forbidden('यह एजेंट ऐप है — एजेंट खाते से लॉगिन करें');
  }
}

const sum = (rows, f) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);

/** The agent's home screen. */
export async function getAgentOverview(scope) {
  requireAgent(scope);
  const { trustId, agentId, programId } = scope;

  const [agentSnap, index, programsSnap, requests] = await Promise.all([
    db.doc(paths.agent(trustId, agentId)).get(),
    getMembersIndex(trustId),
    db.collection(paths.programs(trustId)).get(),
    listMemberRequests(scope, {}),
  ]);
  if (!agentSnap.exists) throw notFound('एजेंट खाता नहीं मिला');
  const agent = agentSnap.data();

  const mine = index.items.filter((e) => e.agentId === agentId);

  const programs = programsSnap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => {
      const rows = mine.filter((e) => e.pid === d.id);
      return {
        id: d.id,
        name: d.data().name ?? '',
        hiname: d.data().hiname ?? '',
        members: rows.length,
        dueAmount: sum(rows, (r) => r.due),
      };
    });

  const inProgram = mine.filter((e) => e.pid === programId);
  const count = (rows, status) => rows.filter((r) => r.status === status).length;

  const block = (rows) => ({
    members: rows.length,
    accepted: count(rows, 'accepted'),
    closed: count(rows, 'closed'),
    blocked: count(rows, 'blocked'),
    withDue: rows.filter((r) => (r.dueC ?? 0) > 0).length,
    dueAmount: sum(rows, (r) => r.due),
    dueCount: sum(rows, (r) => r.dueC),
    paidAmount: sum(rows, (r) => r.paid),
    feeTotal: sum(rows, (r) => r.fee),
    feePaid: sum(rows, (r) => r.feePaid ?? (r.feeDone ? r.fee : 0)),
    feeDue: sum(rows, (r) => r.feeDue ?? (r.feeDone ? 0 : r.fee)),
    feePendingMembers: rows.filter((r) => (r.feeDue ?? (r.feeDone ? 0 : r.fee)) > 0).length,
  });

  return {
    agent: {
      id: agentId,
      displayName: agent.displayName ?? '',
      phone: agent.phone ?? '',
      email: agent.email ?? '',
      photoURL: agent.photoURL ?? '',
      village: agent.village ?? '',
      memberCount: agent.memberCount ?? mine.length,
      collectedAmount: agent.collectedAmount ?? 0,
      earnedTotal: agent.earnedTotal ?? 0,
      paidTotal: agent.paidTotal ?? 0,
      dueTotal: agent.dueTotal ?? 0,
    },
    programId,
    programs,
    current: block(inProgram),
    all: block(mine),
    requests: requests.counts,
  };
}

/**
 * The योजना's क्लोजिंग समूह (batches) — name, notice date, status.
 * A handful of small documents; read once per screen.
 */
async function loadBatches(scope) {
  const snap = await db
    .collection(paths.closingBatches(scope.trustId, scope.programId))
    .select('name', 'code', 'dueDate', 'dueDateMs', 'status', 'description')
    .get();
  return new Map(snap.docs.map((d) => [d.id, {
    id: d.id,
    name: d.get('name') ?? '',
    code: d.get('code') ?? '',
    dueDate: d.get('dueDate') ?? '',
    dueDateMs: d.get('dueDateMs') ?? null,
    status: d.get('status') ?? 'open',
  }]));
}

/**
 * Every closing, with how many of THIS agent's members have paid it — plus the
 * same figures rolled up per क्लोजिंग समूह, so the agent can work a whole
 * month's notice at once.
 */
export async function getAgentClosings(scope) {
  requireAgent(scope);
  const [index, { items: closings }, batchMap] = await Promise.all([
    getMembersIndex(scope.trustId),
    getClosingsIndex(scope.trustId, scope.programId),
    loadBatches(scope),
  ]);
  const members = index.items
    .filter((e) => e.agentId === scope.agentId && e.pid === scope.programId)
    .map(fromMemberEntry);
  const rows = closingsForMembers(members, closings).map((c) => {
    const b = c.batchId ? batchMap.get(c.batchId) : null;
    return { ...c, batchName: b?.name ?? '', batchDueMs: b?.dueDateMs ?? null };
  });

  // Roll the closings up per batch; closings on no notice share one bucket.
  const byBatch = new Map();
  for (const c of rows) {
    const key = c.batchId && batchMap.has(c.batchId) ? c.batchId : '_none';
    if (!byBatch.has(key)) {
      const b = batchMap.get(key);
      byBatch.set(key, {
        id: key,
        name: b?.name ?? 'बिना समूह',
        code: b?.code ?? '',
        dueDate: b?.dueDate ?? '',
        dueDateMs: b?.dueDateMs ?? null,
        status: b?.status ?? null,
        closings: 0, firstDateMs: null, lastDateMs: null,
        eligibleAmount: 0, paidAmount: 0, pendingAmount: 0, paidCount: 0, pendingCount: 0,
      });
    }
    const agg = byBatch.get(key);
    agg.closings += 1;
    agg.eligibleAmount += c.eligibleAmount;
    agg.paidAmount += c.paidAmount;
    agg.pendingAmount += c.pendingAmount;
    agg.paidCount += c.paidCount;
    agg.pendingCount += c.pendingCount;
    agg.firstDateMs = agg.firstDateMs == null ? c.dateMs : Math.min(agg.firstDateMs, c.dateMs ?? agg.firstDateMs);
    agg.lastDateMs = agg.lastDateMs == null ? c.dateMs : Math.max(agg.lastDateMs, c.dateMs ?? agg.lastDateMs);
  }
  const batches = [...byBatch.values()].sort((a, b) =>
    (a.id === '_none') - (b.id === '_none') || (b.lastDateMs ?? 0) - (a.lastDateMs ?? 0));

  return { closings: rows, batches, totals: totalClosings(rows), members: members.length };
}

/**
 * One क्लोजिंग समूह for this agent: its closings and, per member, what they
 * owe across the whole batch — the list an agent carries for a month's notice.
 * Built by `collectionReport`, the same calculation the office uses.
 */
export async function getAgentBatch(scope, batchId) {
  requireAgent(scope);
  const [{ closings, batches }, batchMap] = await Promise.all([
    getAgentClosings(scope),
    loadBatches(scope),
  ]);
  const none = batchId === '_none';
  if (!none && !batchMap.has(batchId)) throw notFound('क्लोजिंग समूह नहीं मिला');

  const inBatch = closings.filter((c) => (none ? !c.batchId || !batchMap.has(c.batchId) : c.batchId === batchId));
  const ids = new Set(inBatch.map((c) => c.closingId));

  // collectionReport filters by batchId itself; for "no batch" it is given
  // every closing and narrowed here.
  const report = await collectionReport(scope, none ? {} : { batchId });
  const rows = report.rows.map((m) => {
    const items = m.items.filter((i) => ids.has(i.id));
    const amount = sum(items, (i) => i.amount);
    const paid = sum(items, (i) => i.paid);
    const remaining = sum(items, (i) => i.remaining);
    return {
      id: m.id,
      registrationNumber: m.registrationNumber,
      displayName: m.displayName,
      fatherName: m.fatherName,
      village: m.village,
      phone: m.phone,
      photoURL: m.photoURL,
      amount, paid, remaining,
      closings: items.length,
      pendingClosings: items.filter((i) => i.remaining > 0).length,
      totalDueAmount: m.dueAmount ?? 0,
    };
  }).filter((r) => r.closings > 0)
    .sort((a, b) => (b.remaining - a.remaining) || String(a.registrationNumber).localeCompare(String(b.registrationNumber), 'en', { numeric: true }));

  const head = batches.find((b) => b.id === batchId) ?? {
    id: batchId, ...(batchMap.get(batchId) ?? { name: 'बिना समूह' }),
  };

  return {
    batch: head,
    closings: inBatch,
    rows,
    totals: {
      members: rows.length,
      amount: sum(rows, (r) => r.amount),
      paidAmount: sum(rows, (r) => r.paid),
      pendingAmount: sum(rows, (r) => r.remaining),
      paidMembers: rows.filter((r) => r.remaining <= 0).length,
      pendingMembers: rows.filter((r) => r.remaining > 0).length,
    },
  };
}

/**
 * The agent's members for one closing — who has paid and who has not.
 *
 * Built by the same `collectionReport` the office uses, which is already
 * agent-scoped, so this list and the office's list cannot disagree.
 */
export async function getAgentClosingMembers(scope, closingId) {
  requireAgent(scope);
  const { items: closings } = await getClosingsIndex(scope.trustId, scope.programId);
  const closing = closings.find((c) => c.id === closingId);
  if (!closing) throw notFound('क्लोजिंग नहीं मिली');

  const [report, batchMap] = await Promise.all([
    collectionReport(scope, { closingId }),
    loadBatches(scope),
  ]);
  const batch = closing.batchId ? batchMap.get(closing.batchId) : null;
  const rows = report.rows.map((m) => {
    const item = m.items[0];
    return {
      id: m.id,
      registrationNumber: m.registrationNumber,
      displayName: m.displayName,
      fatherName: m.fatherName,
      village: m.village,
      phone: m.phone,
      photoURL: m.photoURL,
      amount: item?.amount ?? 0,
      paid: item?.paid ?? 0,
      remaining: item?.remaining ?? 0,
      status: item?.status ?? 'pending',
      totalDueAmount: m.dueAmount ?? 0,
      totalDueCount: m.dueCount ?? 0,
    };
  }).sort((a, b) => (b.remaining - a.remaining) || String(a.registrationNumber).localeCompare(String(b.registrationNumber), 'en', { numeric: true }));

  const paid = rows.filter((r) => r.remaining <= 0 && r.status !== 'exempt');
  const pending = rows.filter((r) => r.remaining > 0);

  return {
    closing: {
      id: closing.id,
      seq: closing.seq,
      name: closing.name,
      regNo: closing.regNo,
      fatherName: closing.fatherName,
      village: closing.village,
      dateMs: closing.dateMs,
      status: closing.status,
      batchId: closing.batchId ?? null,
      batchName: batch?.name ?? '',
      batchDueMs: batch?.dueDateMs ?? null,
    },
    rows,
    totals: {
      members: rows.length,
      amount: sum(rows, (r) => r.amount),
      paidCount: paid.length,
      paidAmount: sum(rows, (r) => r.paid),
      pendingCount: pending.length,
      pendingAmount: sum(pending, (r) => r.remaining),
    },
  };
}

/** One of the agent's members — the same detail the member app shows. */
export async function getAgentMember(scope, memberId) {
  requireAgent(scope);
  const snap = await db.doc(paths.member(scope.trustId, memberId)).get();
  if (!snap.exists || snap.data().delete_flag || snap.data().agentId !== scope.agentId) {
    throw notFound('यह सदस्य आपकी सूची में नहीं है');
  }
  return buildMemberDetail(scope.trustId, memberId);
}

/** The agent's commission: entries for this योजना and payouts received. */
export async function getAgentCommission(scope) {
  requireAgent(scope);
  const { trustId, programId, agentId } = scope;
  const [entriesSnap, payoutsSnap] = await Promise.all([
    db.collection(paths.commissionEntries(trustId, programId))
      .where('agentId', '==', agentId)
      .orderBy('earnedAtMs', 'desc')
      .limit(300)
      .get(),
    db.collection(paths.commissionPayouts(trustId, programId))
      .where('agentId', '==', agentId)
      .limit(100)
      .get(),
  ]);
  const payouts = payoutsSnap.docs
    .map((d) => ({ id: d.id, ...d.data(), createdAt: null }))
    .sort((a, b) => (b.paidAtMs ?? 0) - (a.paidAtMs ?? 0));
  return {
    entries: entriesSnap.docs.map((d) => {
      const e = d.data();
      return {
        id: d.id,
        type: e.type,
        status: e.status,
        amount: e.amount ?? 0,
        reversedAmount: e.reversedAmount ?? 0,
        baseAmount: e.baseAmount ?? 0,
        rateMode: e.rateMode ?? '',
        rateValue: e.rateValue ?? 0,
        memberName: e.memberName ?? '',
        memberRegNo: e.memberRegNo ?? '',
        sourceId: e.sourceId ?? null,
        receiptNo: e.receiptNo ?? '',
        earnedAtMs: e.earnedAtMs ?? null,
        payoutNo: e.payoutNo ?? '',
      };
    }),
    payouts,
  };
}
