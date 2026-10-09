import 'server-only';

import { db, adminAuth, serverNow, inc, countQuery } from '../firebase/admin.js';
import { resolvePolicy, summariseEntries, computePayout, netAmount, round2 } from './commission.js';
import { renameAgentInIndex } from './indexes.js';
import { badRequest, conflict, notFound } from '../errors.js';
import {
  COMMISSION_STATUS,
  LIMITS,
  MEMBER_STATUS,
  ROLE,
  paths,
} from '../../config/constants.js';

/**
 * agents.js — agents and their commission.
 *
 * An agent document carries running totals (`earnedTotal`, `paidTotal`,
 * `dueTotal`, `memberCount`, `collectedAmount`) that are incremented inside the
 * same transaction as the payment that changed them. So the agents list — even
 * with a hundred agents — is one page of documents, and an agent's dashboard is
 * a single read. Nothing has to scan `commission_entries` to show a total.
 */

export async function listAgents(scope, { includeInactive = false } = {}) {
  let query = db.collection(paths.agents(scope.trustId)).where('delete_flag', '==', false);
  if (!includeInactive) query = query.where('active', '==', true);

  const snap = await query.orderBy('displayName', 'asc').limit(500).get();

  /**
   * `isSelf` exists so the screen can refuse to let you reset, disable or hand
   * over your OWN login from the agents table. An agent document whose `uid` is
   * the caller's own is not a hypothetical — see the guard in `createAgent`.
   */
  const agents = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    isSelf: d.data().uid === scope.uid,
  }));

  const summary = agents.reduce(
    (acc, a) => ({
      total: acc.total + 1,
      memberCount: acc.memberCount + (a.memberCount ?? 0),
      collectedAmount: round2(acc.collectedAmount + (a.collectedAmount ?? 0)),
      earnedTotal: round2(acc.earnedTotal + (a.earnedTotal ?? 0)),
      dueTotal: round2(acc.dueTotal + (a.dueTotal ?? 0)),
      paidTotal: round2(acc.paidTotal + (a.paidTotal ?? 0)),
    }),
    { total: 0, memberCount: 0, collectedAmount: 0, earnedTotal: 0, dueTotal: 0, paidTotal: 0 },
  );

  return { agents, summary };
}

/**
 * Create an agent — including their login.
 *
 * An agent is not just a record: they sign in, collect payments and see their
 * own members. So this creates a Firebase Auth account, writes the role claims
 * that scope every later request to them, and returns the generated password
 * ONCE so the admin can pass it on.
 *
 * The agent document id IS the Auth uid. That is what lets `requireScope` turn
 * a signed-in agent into an `agentId` filter without a lookup.
 */
export async function createAgent(scope, input) {
  const { trustId, programId, uid } = scope;
  const agentsRef = db.collection(paths.agents(trustId));

  if (!input.email) {
    throw badRequest('ईमेल ज़रूरी है — एजेंट इसी से लॉगिन करेगा');
  }

  if (input.phone) {
    const clash = await agentsRef
      .where('phone', '==', input.phone)
      .where('delete_flag', '==', false)
      .limit(1)
      .get();
    if (!clash.empty) {
      throw conflict(`इस मोबाइल नंबर का एजेंट पहले से है: ${input.phone}`, {
        agentId: clash.docs[0].id,
      });
    }
  }

  const password = input.password || generatePassword();

  // Create or adopt the Auth account.
  let authUser;
  try {
    authUser = await adminAuth.getUserByEmail(input.email);
    // An existing account that already belongs to another trust must not be
    // silently re-pointed at this one.
    const claims = authUser.customClaims ?? {};
    if (claims.trustId && claims.trustId !== trustId) {
      throw conflict('यह ईमेल किसी दूसरे ट्रस्ट में पहले से उपयोग हो रहा है');
    }

    /**
     * Adopting an account is only safe when that account is nobody yet, or is
     * already an agent.
     *
     * Everything below this point rewrites the account: it sets the password,
     * overwrites the custom claims with `role: AGENT`, and writes an agent
     * document whose id IS this uid. Run that against your own admin login and
     * you demote yourself — the agents list then 403s for you, and the key icon
     * on that row resets your own password and revokes your own session, which
     * looks exactly like the agent vanishing.
     *
     * The trust check above does not catch it, because your admin account is in
     * THIS trust. So the account's role has to be checked as well as its trust.
     */
    if (authUser.uid === uid) {
      throw conflict(
        'यह आपका ही लॉगिन ईमेल है। अपने ईमेल से एजेंट नहीं बन सकता — ' +
          'एजेंट के लिए अलग ईमेल डालें।',
      );
    }

    if (claims.role && claims.role !== ROLE.AGENT) {
      throw conflict(
        `यह ईमेल पहले से इस सिस्टम के ${claims.role} खाते का है — एजेंट के लिए अलग ईमेल डालें।`,
      );
    }
    await adminAuth.updateUser(authUser.uid, {
      password,
      displayName: input.displayName,
      emailVerified: true,
    });
  } catch (error) {
    if (error?.status === 409) throw error;
    if (error.code !== 'auth/user-not-found') throw error;
    authUser = await adminAuth.createUser({
      email: input.email,
      password,
      displayName: input.displayName,
      emailVerified: true,
    });
  }

  await adminAuth.setCustomUserClaims(authUser.uid, {
    role: ROLE.AGENT,
    trustId,
    programId,
    agentId: authUser.uid,
    memberId: null,
    permissions: [],
  });

  const ref = agentsRef.doc(authUser.uid);
  const agent = {
    uid: authUser.uid,
    displayName: input.displayName,
    email: input.email,
    phone: input.phone ?? '',

    dateJoin: input.dateJoin ?? '',
    dateJoinMs: input.dateJoinMs ?? Date.now(),

    address: input.address ?? '',
    city: input.city ?? '',
    village: input.village ?? '',
    state: input.state ?? '',
    district: input.district ?? '',
    pinCode: input.pinCode ?? '',

    photoURL: input.photoURL ?? '',
    signatureURL: input.signatureURL ?? '',
    documentURLs: input.documentURLs ?? [],

    // Null means "inherit the program's policy". Only set what differs.
    commissionOverride: input.commissionOverride ?? null,

    memberCount: 0,
    collectionCount: 0,
    collectedAmount: 0,
    earnedTotal: 0,
    paidTotal: 0,
    dueTotal: 0,

    role: ROLE.AGENT,
    status: 'active',
    active: input.active ?? true,
    delete_flag: false,
    createdAt: serverNow(),
    createdBy: uid,
    updatedAt: serverNow(),
  };

  await ref.set(agent);

  await db.doc(paths.counterStats(trustId, programId)).set(
    { agents: { total: inc(1), active: inc(agent.active ? 1 : 0) }, updatedAt: serverNow() },
    { merge: true },
  );

  return {
    agent: { id: ref.id, ...agent, createdAt: null, updatedAt: null },
    // Shown to the admin exactly once — it is not stored anywhere in plain text.
    password,
  };
}

/** Readable but not guessable: two words, digits, a symbol. */
function generatePassword() {
  const words = ['Surya', 'Chandra', 'Ganga', 'Kamal', 'Megha', 'Tara', 'Vayu', 'Amrit'];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${word}@${digits}`;
}

/**
 * Edit an agent — everything about them, including how they sign in.
 *
 * Three things here are not simple field writes:
 *
 *  • **Email** is the login. Changing it means changing the Firebase Auth
 *    account, not just the document, or the agent keeps signing in with the
 *    old address and the screen quietly lies about it.
 *
 *  • **Name** is copied onto every member the agent enrolled — `agentName` on
 *    the member document and `agent` in the search index — because that is what
 *    makes filtering and grouping by agent free. Renaming therefore has to
 *    correct the copies, or the members list keeps showing a name that no
 *    longer exists anywhere else.
 *
 *  • **Deactivating** must reach Auth too. A `active: false` document with a
 *    working login is not a deactivated agent.
 */
/**
 * Refuse to operate on the caller's own login through the agents screen.
 *
 * Three things here reach into Firebase Auth with `agent.uid`: a password reset,
 * switching an agent off (`disabled: true`), and a handover. All three are
 * correct against an agent and catastrophic against yourself, because
 * `verifySessionCookie` is checked for revocation — so revoking or disabling
 * your own account ends your session on the very next request, with no error
 * anybody can read. The screen goes blank and the row is gone.
 *
 * Normally no agent document carries your uid at all. It can happen when an
 * agent was created with an email that already had an account, which is now
 * refused in `createAgent` — this is the second lock on the same door, for rows
 * that already exist.
 */
function assertNotSelf(scope, agent, action) {
  if (agent.uid && agent.uid === scope.uid) {
    throw conflict(
      `यह एजेंट आपका ही लॉगिन खाता है, इसलिए ${action} यहाँ से नहीं हो सकता — ` +
        'वरना आप खुद तुरंत लॉग आउट हो जाएँगे। अपना पासवर्ड सेटिंग से बदलें।',
    );
  }
}

/**
 * Write to an agent's Firebase Auth account — creating it when it is missing.
 *
 * An agent document can point at a uid that has no Auth account in THIS
 * Firebase project: agents carried over from the old system by the migration
 * keep their old uid, and the account may never have existed here (or was
 * deleted by hand in the console). Every write to Auth then failed with
 * `auth/user-not-found` and the screen answered a bare 500 — a handover,
 * password reset or email change for that agent was simply impossible.
 *
 * Now the account is created with the SAME uid, because the agent id is the
 * uid: members, receipts and commission all point at it, and a new uid would
 * orphan them. The role claims are written at the same time so the new login
 * actually opens the agent's own data.
 *
 * `create` must carry an email when the account may need creating; without
 * one there is nothing to sign in with, and the caller is told so plainly.
 */
async function writeAgentAuth(scope, agentId, agent, update, { create } = {}) {
  const uid = agent.uid || agentId;
  try {
    await adminAuth.updateUser(uid, update);
    return { uid, created: false };
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }

  const email = (update.email ?? create?.email ?? agent.email ?? '').trim().toLowerCase();
  if (!email) {
    throw badRequest(
      'इस एजेंट का लॉगिन खाता मौजूद नहीं है और कोई ईमेल भी नहीं है — ' +
        'संपादित करके ईमेल डालें, फिर पासवर्ड बनाएँ।',
    );
  }

  const clash = await adminAuth.getUserByEmail(email).catch(() => null);
  if (clash && clash.uid !== uid) {
    throw conflict(
      `ईमेल ${email} किसी और लॉगिन खाते में है — इस एजेंट के लिए दूसरा ईमेल डालें`,
      { email },
    );
  }

  await adminAuth.createUser({
    uid,
    email,
    password: update.password ?? create?.password ?? generatePassword(),
    displayName: update.displayName ?? agent.displayName ?? '',
    emailVerified: true,
    disabled: update.disabled ?? false,
  });

  await adminAuth.setCustomUserClaims(uid, {
    role: ROLE.AGENT,
    trustId: scope.trustId,
    programId: agent.programId ?? scope.programId ?? null,
    agentId,
    memberId: null,
    permissions: [],
  });

  // Keep the document pointing at the account that now exists.
  if (agent.uid !== uid) {
    await db.doc(paths.agent(scope.trustId, agentId)).update({ uid });
  }

  return { uid, created: true };
}

/** Revoke sessions, ignoring an account that does not exist (nothing to revoke). */
async function revokeAgent(uid) {
  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
}

export async function updateAgent(scope, agentId, patch) {
  const ref = db.doc(paths.agent(scope.trustId, agentId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('एजेंट नहीं मिला');

  const before = snap.data();
  const changes = { ...patch };

  /* ── email: the login itself ─────────────────────────────────────────── */
  const nextEmail = patch.email?.trim().toLowerCase();
  if (nextEmail && nextEmail !== String(before.email ?? '').toLowerCase()) {
    const clash = await adminAuth.getUserByEmail(nextEmail).catch(() => null);
    if (clash && clash.uid !== (before.uid || agentId)) {
      throw conflict('यह ईमेल किसी और खाते में पहले से है', { email: nextEmail });
    }

    await writeAgentAuth(scope, agentId, before, { email: nextEmail, emailVerified: true });
    changes.email = nextEmail;
  } else {
    delete changes.email;
  }

  /* ── phone must stay unique among live agents ────────────────────────── */
  if (patch.phone && patch.phone !== before.phone) {
    const clash = await db
      .collection(paths.agents(scope.trustId))
      .where('phone', '==', patch.phone)
      .where('delete_flag', '==', false)
      .limit(2)
      .get();

    const other = clash.docs.find((d) => d.id !== agentId);
    if (other) {
      throw conflict(`इस मोबाइल नंबर का एजेंट पहले से है: ${patch.phone}`, {
        agentId: other.id,
      });
    }
  }

  /* ── name: also change display name on the Auth account ──────────────── */
  const renamed =
    patch.displayName && patch.displayName.trim() !== String(before.displayName ?? '').trim();

  if (renamed) {
    // A missing login is not this edit's business — the name is still saved.
    await adminAuth.updateUser(before.uid || agentId, { displayName: patch.displayName.trim() })
      .catch((error) => { if (error?.code !== 'auth/user-not-found') throw error; });
    changes.displayName = patch.displayName.trim();
  }

  /* ── active: the document flag alone stops nothing ───────────────────── */
  if (patch.active !== undefined && patch.active !== before.active) {
    if (patch.active === false) assertNotSelf(scope, before, 'बंद करना');
    await adminAuth.updateUser(before.uid || agentId, { disabled: patch.active === false })
      .catch((error) => { if (error?.code !== 'auth/user-not-found') throw error; });
    if (patch.active === false) await revokeAgent(before.uid || agentId);
  }

  await ref.update({
    ...changes,
    updatedAt: serverNow(),
    updatedBy: scope.uid,
  });

  // The cascade runs AFTER the agent is saved. If it fails halfway the agent
  // is still correct and re-saving the same name finishes the job — the
  // reverse order would leave members renamed to an agent that was never
  // written.
  const cascade = renamed
    ? await renameAgentOnMembers(scope.trustId, agentId, changes.displayName)
    : { members: 0, indexEntries: 0 };

  const after = await ref.get();
  return { agent: { id: after.id, ...after.data() }, cascade };
}

/**
 * Rewrite an agent's name on every member they enrolled.
 *
 * Members carry the agent's NAME, not just their id. That denormalisation is
 * deliberate — it is why the members grid can show an agent column and why
 * filtering by agent costs nothing — but it means a rename has copies to
 * correct, and this is where that debt is paid.
 *
 * Batched at 400 writes; Firestore's ceiling is 500 and leaving headroom costs
 * nothing. The search index is corrected separately, in shard-sized chunks.
 */
export async function renameAgentOnMembers(trustId, agentId, displayName) {
  const snap = await db
    .collection(paths.members(trustId))
    .where('agentId', '==', agentId)
    .select('addedBy')
    .get();

  let written = 0;

  for (let i = 0; i < snap.docs.length; i += 400) {
    const slice = snap.docs.slice(i, i + 400);
    const batch = db.batch();

    for (const doc of slice) {
      const patch = { agentName: displayName, updatedAt: serverNow() };
      // `addedByName` records WHO added the member. It only holds the agent's
      // name when the agent added them; when an admin did, it says "Admin" and
      // must be left alone.
      if (doc.get('addedBy') === 'agent') patch.addedByName = displayName;

      batch.update(doc.ref, patch);
      written += 1;
    }

    await batch.commit();
  }

  const index = await renameAgentInIndex(trustId, agentId, displayName);

  return { members: written, indexEntries: index.entries };
}

/**
 * Issue a new password for an agent.
 *
 * Returned once and never stored. Existing sessions are revoked, so the new
 * password is not merely the new way in — it is the only way in. The old
 * system kept agent passwords in plain text in Firestore, which meant every
 * read of that collection was a read of every password.
 */
export async function resetAgentPassword(scope, agentId) {
  const snap = await db.doc(paths.agent(scope.trustId, agentId)).get();
  if (!snap.exists) throw notFound('एजेंट नहीं मिला');

  const agent = snap.data();
  assertNotSelf(scope, agent, 'पासवर्ड बदलना');

  const password = generatePassword();
  // Creates the login when the agent has none yet (e.g. carried over from the
  // old system) — "reset password" is then simply "give them a password".
  const { uid } = await writeAgentAuth(scope, agentId, agent, { password, disabled: false });

  // Revocation is the point: without it the old password stays usable
  // alongside the new one. `verifySessionCookie(cookie, true)` honours it, so
  // this agent is signed out of every device within the same request.
  await revokeAgent(uid);

  return { password, email: agent.email };
}

/**
 * Hand an agent's position to a different person.
 *
 * This is for when the person leaves but the POSITION stays: their 400 members
 * keep collecting, their receipts stay valid, their commission history stays
 * intact, and someone else takes over the round.
 *
 * The alternative — deactivate this agent and create a new one — is the wrong
 * tool for that, and it is worth being explicit about why: it would leave 400
 * members pointing at an agent nobody is, and every commission report would
 * split one round across two names for no reason anyone could reconstruct
 * later.
 *
 * So the agent record survives and its id never changes. What changes is the
 * PERSON: the login email, the password, the name, the phone, and the
 * signature. Because the agent id is the Firebase Auth uid, keeping the same
 * Auth account is what keeps the id stable — the account is re-pointed at a
 * new person rather than replaced.
 *
 * Three things this must not get wrong:
 *
 *  1. The outgoing person is logged out everywhere, immediately. A handover
 *     where the previous holder can still sign in is not a handover.
 *  2. The previous holder's signature and photo are cleared. Leaving them
 *     would print one person's signature on another person's receipts.
 *  3. Who held it before is recorded on the agent. Six months later, "who was
 *     collecting in Malpura in March" has to have an answer.
 */
export async function handoverAgent(scope, agentId, input) {
  const ref = db.doc(paths.agent(scope.trustId, agentId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound('एजेंट नहीं मिला');

  const before = snap.data();
  assertNotSelf(scope, before, 'पद किसी और को देना');

  const email = String(input.email).trim().toLowerCase();

  if (email === String(before.email ?? '').toLowerCase()) {
    throw badRequest(
      'यह वही ईमेल है जो पहले से लगा है — नए व्यक्ति का ईमेल डालें, ' +
      'या सिर्फ़ नाम बदलना हो तो “संपादित करें” का उपयोग करें',
    );
  }

  // An email already in use elsewhere cannot be moved here: Firebase would
  // refuse, and silently adopting that other account would hand this agent's
  // members to whoever owns it.
  const clash = await adminAuth.getUserByEmail(email).catch(() => null);
  if (clash && clash.uid !== (before.uid || agentId)) {
    throw conflict(
      'यह ईमेल किसी और खाते में पहले से है — दूसरा ईमेल इस्तेमाल करें',
      { email },
    );
  }

  const password = input.password || generatePassword();

  // Re-points the existing login at the new person — or, when the agent has
  // no login in this project at all (carried over from the old system), gives
  // the new person one under the same uid, so the agent id does not change.
  const { uid } = await writeAgentAuth(scope, agentId, before, {
    email,
    password,
    displayName: input.displayName,
    emailVerified: true,
    disabled: false,
  });

  // The outgoing person's session cookie would otherwise keep working for up
  // to two weeks — long after they have handed over the round.
  await revokeAgent(uid);

  const entry = {
    fromName: before.displayName ?? '',
    fromEmail: before.email ?? '',
    fromPhone: before.phone ?? '',
    toName: input.displayName,
    toEmail: email,
    atMs: Date.now(),
    byUid: scope.uid,
    note: input.note ?? '',
  };

  // Newest first, capped. An unbounded array on a hot document is a document
  // that eventually fails to write; twenty handovers is more history than any
  // agent position will see.
  const handovers = [entry, ...(before.handovers ?? [])].slice(0, 20);

  await ref.update({
    displayName: input.displayName,
    email,
    phone: input.phone ?? '',
    // The previous holder's likeness and signature belong to them, not to the
    // position. Cleared so the new person uploads their own.
    photoURL: input.photoURL ?? '',
    signatureURL: input.signatureURL ?? '',
    active: true,
    status: 'active',
    handovers,
    handoverAtMs: entry.atMs,
    updatedAt: serverNow(),
    updatedBy: scope.uid,
  });

  const cascade = await renameAgentOnMembers(
    scope.trustId,
    agentId,
    input.displayName,
  );

  const after = await ref.get();

  return {
    agent: { id: after.id, ...after.data() },
    cascade,
    previous: { name: entry.fromName, email: entry.fromEmail },
    // Shown once. Never stored.
    password,
    email,
  };
}

/**
 * One agent's full picture: their totals, the policy actually in force for
 * them, their members' outstanding dues, and their commission entries.
 */
export async function getAgentDetail(scope, agentId, { entryLimit = 100 } = {}) {
  const { trustId, programId } = scope;

  const [agentSnap, programSnap] = await Promise.all([
    db.doc(paths.agent(trustId, agentId)).get(),
    db.doc(paths.program(trustId, programId)).get(),
  ]);

  if (!agentSnap.exists) throw notFound('Agent not found');
  const agent = { id: agentSnap.id, ...agentSnap.data() };

  const policy = resolvePolicy(
    programSnap.data()?.commissionPolicy,
    agent.commissionOverride,
  );

  const [entriesSnap, memberCount, membersWithDue] = await Promise.all([
    db
      .collection(paths.commissionEntries(trustId, programId))
      .where('agentId', '==', agentId)
      .orderBy('earnedAtMs', 'desc')
      .limit(entryLimit)
      .get(),
    countQuery(
      db
        .collection(paths.members(trustId))
        .where('programId', '==', programId)
        .where('agentId', '==', agentId)
        .where('delete_flag', '==', false),
    ),
    countQuery(
      db
        .collection(paths.members(trustId))
        .where('programId', '==', programId)
        .where('agentId', '==', agentId)
        .where('delete_flag', '==', false)
        .where('dueCount', '>', 0),
    ),
  ]);

  const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    agent,
    policy,
    entries,
    summary: summariseEntries(entries),
    members: { total: memberCount, withDue: membersWithDue },
  };
}

/**
 * Settle a set of commission entries into one payout.
 *
 * Entries are re-read inside the transaction and anything already paid or
 * cancelled is refused — the same rule as payments: the browser proposes, the
 * server decides.
 */
export async function createPayout(scope, input) {
  const { trustId, programId, uid } = scope;

  if (input.entryIds.length > LIMITS.MAX_TX_WRITES - 10) {
    throw badRequest(
      `Too many entries for one payout (max ${LIMITS.MAX_TX_WRITES - 10}). Split it.`,
    );
  }

  const agentRef = db.doc(paths.agent(trustId, input.agentId));
  const payoutRef = db.collection(paths.commissionPayouts(trustId, programId)).doc();
  const seqRef = db.doc(paths.counterSeq(trustId, programId));

  return db.runTransaction(async (tx) => {
    const entryRefs = input.entryIds.map((id) =>
      db.doc(`${paths.commissionEntries(trustId, programId)}/${id}`),
    );

    const [agentSnap, seqSnap, ...entrySnaps] = await Promise.all([
      tx.get(agentRef),
      tx.get(seqRef),
      ...entryRefs.map((r) => tx.get(r)),
    ]);

    if (!agentSnap.exists) throw notFound('Agent not found');

    const payable = [];
    const skipped = [];

    entrySnaps.forEach((snap, i) => {
      if (!snap.exists) {
        skipped.push({ id: input.entryIds[i], reason: 'not_found' });
        return;
      }
      const e = snap.data();
      if (e.agentId !== input.agentId) {
        skipped.push({ id: snap.id, reason: 'belongs_to_another_agent' });
        return;
      }
      if (e.status === COMMISSION_STATUS.PAID) {
        skipped.push({ id: snap.id, reason: 'already_paid' });
        return;
      }
      if (e.status === COMMISSION_STATUS.CANCELLED) {
        skipped.push({ id: snap.id, reason: 'cancelled' });
        return;
      }
      // A closing was reverted after this was earned, so what is left of the
      // entry is smaller than the figure printed on the screen. Paying the
      // gross would hand the agent money for a collection that went back.
      if (netAmount(e) <= 0) {
        skipped.push({ id: snap.id, reason: 'fully_reversed' });
        return;
      }
      payable.push({ ref: entryRefs[i], id: snap.id, ...e });
    });

    if (!payable.length) {
      throw conflict('No payable commission entries in this selection', { skipped });
    }

    const totals = computePayout({
      entries: payable,
      deductions: input.deductions ?? [],
    });

    const payoutNo = `PAY-${new Date().getFullYear()}-${String(
      (seqSnap.data()?.payout ?? 0) + 1,
    ).padStart(4, '0')}`;

    const payout = {
      payoutNo,
      agentId: input.agentId,
      agentName: agentSnap.data().displayName ?? '',
      periodFromMs: input.periodFromMs ?? null,
      periodToMs: input.periodToMs ?? null,
      entryIds: payable.map((e) => e.id),
      entryCount: payable.length,
      joinFeeTotal: totals.joinFeeTotal,
      collectionTotal: totals.collectionTotal,
      grossTotal: totals.payableTotal,
      deductions: input.deductions ?? [],
      deductionTotal: totals.deductionTotal,
      netTotal: totals.netTotal,
      method: input.method ?? 'cash',
      reference: input.reference ?? '',
      note: input.note ?? '',
      paidAtMs: Date.now(),
      status: 'paid',
      createdAt: serverNow(),
      createdBy: uid,
    };

    tx.set(payoutRef, payout);

    for (const entry of payable) {
      tx.update(entry.ref, {
        status: COMMISSION_STATUS.PAID,
        payoutId: payoutRef.id,
        payoutNo,
        paidAt: serverNow(),
      });
    }

    tx.update(agentRef, {
      paidTotal: inc(totals.payableTotal),
      dueTotal: inc(-totals.payableTotal),
      lastPayoutAt: serverNow(),
      updatedAt: serverNow(),
    });

    tx.set(
      seqRef,
      { payout: (seqSnap.data()?.payout ?? 0) + 1, updatedAt: serverNow() },
      { merge: true },
    );

    tx.set(
      db.doc(paths.counterStats(trustId, programId)),
      {
        commission: {
          paidTotal: inc(totals.payableTotal),
          dueTotal: inc(-totals.payableTotal),
        },
        updatedAt: serverNow(),
      },
      { merge: true },
    );

    return { id: payoutRef.id, ...payout, createdAt: null, skipped };
  });
}

/** Members belonging to one agent, with their outstanding dues. */
export async function getAgentMembers(scope, agentId, { limit = LIMITS.PAGE_SIZE } = {}) {
  const snap = await db
    .collection(paths.members(scope.trustId))
    .where('programId', '==', scope.programId)
    .where('agentId', '==', agentId)
    .where('delete_flag', '==', false)
    .orderBy('dueAmount', 'desc')
    .select(
      'registrationNumber', 'displayName', 'fatherName', 'phone', 'village',
      'status', 'dueCount', 'dueAmount', 'paidCount', 'paidAmount', 'joinFeesDone',
    )
    .limit(limit)
    .get();

  return { members: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

/** Groups (यूनिट) — a flat collection, never an array inside one document. */
export async function listGroups(scope) {
  const snap = await db
    .collection(paths.groups(scope.trustId, scope.programId))
    .orderBy('name', 'asc')
    .get();
  return { groups: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

export async function createGroup(scope, input) {
  const ref = db.collection(paths.groups(scope.trustId, scope.programId)).doc();
  const group = {
    name: input.name,
    /**
     * A short code for receipt numbers — `MLP-2026-000123`.
     *
     * Derived from the name once and then fixed, because it is printed on
     * receipts: changing it later would leave two receipt series that look
     * unrelated for the same group. Latin letters where the name has them,
     * otherwise a number, because a receipt number gets read out over a phone.
     */
    code: groupCode(input.code || input.name),
    description: input.description ?? '',
    payAmount: Number(input.payAmount) || LIMITS.DEFAULT_PAY_AMOUNT,
    joinFees: Number(input.joinFees) || 0,
    memberCount: 0,
    active: true,
    createdAt: serverNow(),
    createdBy: scope.uid,
  };
  await ref.set(group);
  return { id: ref.id, ...group, createdAt: null };
}

/** Members eligible to be closed, for the closing form's picker. */
export async function searchClosableMembers(scope, term) {
  const snap = await db
    .collection(paths.members(scope.trustId))
    .where('programId', '==', scope.programId)
    .where('delete_flag', '==', false)
    .where('status', '==', MEMBER_STATUS.ACCEPTED)
    .select('registrationNumber', 'displayName', 'fatherName', 'village', 'phone', 'payAmount', 'joinDateMs')
    .limit(500)
    .get();

  const q = String(term ?? '').trim().toLowerCase();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!q) return { members: rows.slice(0, 30) };

  return {
    members: rows
      .filter(
        (m) =>
          (m.registrationNumber ?? '').toLowerCase().includes(q) ||
          (m.displayName ?? '').toLowerCase().includes(q) ||
          (m.phone ?? '').includes(q),
      )
      .slice(0, 30),
  };
}

/**
 * A short, speakable code from a group's name.
 *
 * Devanagari has no ASCII form, so a Hindi-only name yields no letters — and a
 * receipt number nobody can read out over a phone is worse than a generic one.
 * In that case the code falls back to `G` plus digits.
 */
function groupCode(name) {
  const ascii = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 4);

  return ascii || `G${String(Date.now()).slice(-4)}`;
}
