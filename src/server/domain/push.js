import 'server-only';

import crypto from 'node:crypto';
import { getMessaging } from 'firebase-admin/messaging';

import { adminApp, db, serverNow } from '../firebase/admin.js';
import { badRequest } from '../errors.js';
import { ROLE, paths } from '../../config/constants.js';
import { getMembersIndex } from './indexes.js';
import { linkedMembers, resolvePortalSelf } from './memberPortal.js';

/**
 * push.js — Firebase Cloud Messaging for the phone app (agents + members).
 *
 *   trusts/{t}/push_tokens/{sha1(token)}   one per phone:
 *     { token, uid, role, agentId, memberIds[], programIds[], lang, appVersion }
 *   trusts/{t}/notifications/{id}          every message sent (the app's inbox)
 *
 * A member's phone is registered for the whole family on that mobile number
 * (memberIds / programIds of everyone linked), so "यह योजना" or "यह सदस्य"
 * notifications reach the family phone.
 *
 * Sending never throws into the caller: a notification is a courtesy, a
 * receipt or a closing must never fail because FCM is down.
 */

const tokensCol = (t) => db.collection(`${paths.trust(t)}/push_tokens`);
const inboxCol = (t) => db.collection(`${paths.trust(t)}/notifications`);
/** The योजनाएँ an agent has members in (from the cached member index — no extra reads). */
async function agentProgramIds(trustId, agentId) {
  const { items } = await getMembersIndex(trustId);
  return [...new Set(items.filter((e) => e.agentId === agentId).map((e) => e.pid).filter(Boolean))];
}

const idOf = (token) => crypto.createHash('sha1').update(token).digest('hex');

/* ── register / unregister ─────────────────────────────────────────────── */

export async function registerToken(session, { token, platform, appVersion, lang }) {
  if (!token || token.length < 20) throw badRequest('टोकन नहीं मिला');
  const doc = {
    token,
    uid: session.uid,
    role: session.role === ROLE.AGENT ? 'agent' : 'member',
    agentId: session.agentId ?? null,
    memberIds: [],
    programIds: [],
    platform: platform ?? 'android',
    appVersion: appVersion ?? '',
    lang: lang === 'en' ? 'en' : 'hi',
    updatedAt: serverNow(),
    updatedAtMs: Date.now(),
  };

  if (doc.role === 'member') {
    const self = await resolvePortalSelf(session);
    const family = await linkedMembers(session, self);
    doc.memberIds = [...new Set(family.map((m) => m.id))];
    doc.programIds = [...new Set(family.map((m) => m.programId).filter(Boolean))];
  } else if (session.agentId) {
    const ids = await agentProgramIds(session.trustId, session.agentId);
    doc.programIds = ids.length ? ids : (session.programId ? [session.programId] : []);
  }

  await tokensCol(session.trustId).doc(idOf(token)).set(doc, { merge: true });
  return { registered: true, role: doc.role, members: doc.memberIds.length, programs: doc.programIds.length };
}

export async function unregisterToken(session, token) {
  if (!token) return { removed: false };
  await tokensCol(session.trustId).doc(idOf(token)).delete().catch(() => {});
  return { removed: true };
}

/* ── sending ───────────────────────────────────────────────────────────── */

/**
 * audience:
 *   { all: true }                       every registered phone
 *   { role: 'member' | 'agent' }        one side only
 *   { programId, role? }                one योजना (members' families / its agents)
 *   { memberId }                        one member's family phone(s)
 *   { agentId }                         one agent's phone(s)
 */
async function findTokens(trustId, audience) {
  let q = tokensCol(trustId);
  if (audience.memberId) q = q.where('memberIds', 'array-contains', audience.memberId);
  else if (audience.agentId) q = q.where('agentId', '==', audience.agentId);
  else if (audience.programId) q = q.where('programIds', 'array-contains', audience.programId);
  else if (audience.role) q = q.where('role', '==', audience.role);

  const snap = await q.select('token', 'role', 'uid').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !audience.role || t.role === audience.role);
}

/**
 * Send and record. `message` = { title, body, url?, kind? }.
 * Returns counts; never throws (logs instead) unless `strict`.
 */
export async function notify(trustId, audience, message, { strict = false, sentBy = null, record = true } = {}) {
  try {
    const title = String(message.title ?? '').slice(0, 120);
    const body = String(message.body ?? '').slice(0, 1000);
    if (!title) throw badRequest('शीर्षक ज़रूरी है');

    let inboxId = null;
    if (record) {
      const ref = inboxCol(trustId).doc();
      inboxId = ref.id;
      await ref.set({
        title, body, url: message.url ?? '', kind: message.kind ?? 'broadcast',
        audience: {
          all: Boolean(audience.all), role: audience.role ?? null, programId: audience.programId ?? null,
          memberId: audience.memberId ?? null, agentId: audience.agentId ?? null,
        },
        sentBy, createdAt: serverNow(), createdAtMs: Date.now(), sent: 0, failed: 0,
      });
    }

    const tokens = await findTokens(trustId, audience);
    let sent = 0;
    let failed = 0;
    const dead = [];
    const messaging = getMessaging(adminApp);

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map((t) => t.token),
        notification: { title, body },
        data: { url: message.url ?? '', kind: message.kind ?? 'broadcast', id: inboxId ?? '' },
        android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
      });
      sent += res.successCount;
      failed += res.failureCount;
      res.responses.forEach((r, j) => {
        const code = r.error?.code ?? '';
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead.push(chunk[j].id);
      });
    }

    // Uninstalled apps / expired tokens: forget them so the next send is clean.
    await Promise.all(dead.map((id) => tokensCol(trustId).doc(id).delete().catch(() => {})));
    if (inboxId) await inboxCol(trustId).doc(inboxId).update({ sent, failed, devices: tokens.length });

    return { id: inboxId, devices: tokens.length, sent, failed, removed: dead.length };
  } catch (error) {
    console.error('[push] notify failed', error?.message);
    if (strict) throw error;
    return { devices: 0, sent: 0, failed: 0, error: error?.message };
  }
}

/** Fire-and-forget for hooks (receipt, closing, request decision). */
export function notifyLater(trustId, audience, message) {
  notify(trustId, audience, message).catch(() => {});
}

/* ── inbox ─────────────────────────────────────────────────────────────── */

/**
 * The signed-in person's notifications, newest first: broadcasts to everyone,
 * to their side (member/agent), to their योजनाएँ, and to them personally.
 */
export async function inboxFor(session, { limit = 60 } = {}) {
  const role = session.role === ROLE.AGENT ? 'agent' : 'member';
  let memberIds = [];
  let programIds = [];
  if (role === 'member') {
    const self = await resolvePortalSelf(session);
    const family = await linkedMembers(session, self);
    memberIds = family.map((m) => m.id);
    programIds = [...new Set(family.map((m) => m.programId).filter(Boolean))];
  } else if (session.agentId) {
    programIds = await agentProgramIds(session.trustId, session.agentId);
  }

  const snap = await inboxCol(session.trustId).orderBy('createdAtMs', 'desc').limit(300).get();
  const mine = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => {
    const a = n.audience ?? {};
    if (a.memberId) return memberIds.includes(a.memberId);
    if (a.agentId) return role === 'agent' && a.agentId === session.agentId;
    if (a.role && a.role !== role) return false;
    if (a.programId) return programIds.includes(a.programId);
    return true;
  });

  return mine.slice(0, limit).map((n) => ({
    id: n.id, title: n.title, body: n.body, url: n.url ?? '', kind: n.kind ?? 'broadcast', createdAtMs: n.createdAtMs,
  }));
}

/** For the office: what was sent, newest first. */
export async function sentList(trustId, { limit = 50 } = {}) {
  const snap = await inboxCol(trustId).orderBy('createdAtMs', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: null }));
}

/** How many phones are registered — shown on the send screen. */
export async function deviceCounts(trustId) {
  const snap = await tokensCol(trustId).select('role').get();
  let members = 0; let agents = 0;
  snap.docs.forEach((d) => { if (d.data().role === 'agent') agents += 1; else members += 1; });
  return { members, agents, total: members + agents };
}
