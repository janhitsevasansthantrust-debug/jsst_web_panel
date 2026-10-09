import 'server-only';

import { adminAuth, db, serverNow } from '../firebase/admin.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { ROLE, paths } from '../../config/constants.js';

/**
 * memberLogin.js — a member's own login for the member app.
 *
 * Members sign in with their REGISTRATION NUMBER and a password. Firebase Auth
 * needs an email, so the registration number is turned into one the same way
 * the old system did and the login screen still does: `1023` → `1023@gmail.com`.
 * Keeping that convention means every login the old app ever issued keeps
 * working unchanged.
 *
 * The account carries `role: member` and `memberId`, which is what scopes the
 * member app to this person and the members sharing their mobile number.
 */

export const memberLoginEmail = (regNo) => `${String(regNo).trim().toLowerCase()}@gmail.com`;

/** Is there a login for this member, and is it switched on? */
export async function getMemberLogin(scope, memberId) {
  const member = await readMember(scope, memberId);
  const email = memberLoginEmail(member.registrationNumber);
  try {
    const user = await adminAuth.getUserByEmail(email);
    const claims = user.customClaims ?? {};
    return {
      exists: true,
      email,
      loginId: member.registrationNumber,
      disabled: Boolean(user.disabled),
      linkedToThisMember: !claims.memberId || claims.memberId === memberId,
      role: claims.role ?? null,
    };
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    return { exists: false, email, loginId: member.registrationNumber, disabled: false };
  }
}

/**
 * Create the login, or set a new password on it.
 *
 * Returns the password ONCE so the office can tell the member; it is never
 * stored. When no password is given the member's mobile number is used —
 * the one thing a member is sure to remember — and failing that six digits.
 */
export async function setMemberLogin(scope, memberId, { password, disabled } = {}) {
  const member = await readMember(scope, memberId);
  if (!member.registrationNumber) throw badRequest('इस सदस्य का रजिस्ट्रेशन नंबर नहीं है');

  const email = memberLoginEmail(member.registrationNumber);
  const digits = String(member.phone ?? '').replace(/\D+/g, '').slice(-10);
  const pass = password || (digits.length >= 6 ? digits : String(Math.floor(100000 + Math.random() * 900000)));

  let user = null;
  try {
    user = await adminAuth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }

  if (user) {
    const claims = user.customClaims ?? {};
    // Never turn a staff or agent account into a member login.
    if (claims.role && claims.role !== ROLE.MEMBER) {
      throw conflict(`यह लॉगिन (${member.registrationNumber}) किसी ${claims.role} खाते का है — बदला नहीं जा सकता`);
    }
    if (claims.memberId && claims.memberId !== memberId) {
      // The same registration number in another योजना. Re-pointing is safe
      // only when it is the same family — the app shows everyone on the same
      // mobile number anyway.
      const otherSnap = await db.doc(paths.member(scope.trustId, claims.memberId)).get();
      const samePhone = otherSnap.exists
        && phone10(otherSnap.data().phone) && phone10(otherSnap.data().phone) === phone10(member.phone);
      if (otherSnap.exists && !otherSnap.data().delete_flag && !samePhone) {
        throw conflict(
          `रजि. नंबर ${member.registrationNumber} का लॉगिन पहले से दूसरे सदस्य ` +
          `(${otherSnap.data().displayName}, ${otherSnap.data().programName ?? ''}) के लिए बना है`,
        );
      }
    }
    await adminAuth.updateUser(user.uid, {
      ...(password || disabled === undefined ? { password: pass } : {}),
      displayName: member.displayName ?? '',
      ...(disabled !== undefined ? { disabled: Boolean(disabled) } : {}),
    });
  } else {
    if (disabled) throw badRequest('लॉगिन बना ही नहीं है');
    user = await adminAuth.createUser({
      email,
      password: pass,
      displayName: member.displayName ?? '',
      emailVerified: true,
    });
  }

  await adminAuth.setCustomUserClaims(user.uid, {
    role: ROLE.MEMBER,
    trustId: scope.trustId,
    programId: member.programId ?? null,
    agentId: null,
    memberId,
    permissions: [],
  });
  // New claims or a new password: end any session holding the old ones.
  await adminAuth.revokeRefreshTokens(user.uid);

  await db.doc(paths.member(scope.trustId, memberId)).update({
    loginEnabled: !disabled,
    loginUid: user.uid,
    loginUpdatedAt: serverNow(),
  });

  const changedPassword = Boolean(password) || disabled === undefined;
  return {
    loginId: member.registrationNumber,
    email,
    disabled: Boolean(disabled),
    ...(changedPassword ? { password: pass } : {}),
  };
}

/**
 * The login every new member gets automatically — called right after a member
 * is created (office form, or an agent's request being approved).
 *
 *   login ID = registration number, password = their 10-digit mobile number
 *
 * It must never stop an enrolment: any problem (no mobile number, the number
 * already used by a staff/agent account, Firebase hiccup) is returned as
 * `{ created: false, reason }` and the office can create it later from the
 * member's "सदस्य ऐप लॉगिन" tab. An existing member login for the same family
 * (same mobile number) is left exactly as it is — its password is NOT reset.
 */
export async function ensureMemberLogin(scope, member) {
  try {
    const regNo = String(member.registrationNumber ?? '').trim();
    if (!regNo) return { created: false, reason: 'रजिस्ट्रेशन नंबर नहीं है' };
    const digits = phone10(member.phone);
    if (!digits) return { created: false, loginId: regNo, reason: 'मोबाइल नंबर नहीं है — लॉगिन बाद में बनाएँ' };

    const email = memberLoginEmail(regNo);
    let user = null;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }

    if (user) {
      const claims = user.customClaims ?? {};
      if (claims.role && claims.role !== ROLE.MEMBER) {
        return { created: false, loginId: regNo, reason: `${regNo}@ लॉगिन किसी ${claims.role} खाते का है` };
      }
      if (claims.memberId && claims.memberId !== member.id) {
        // Same reg. no. already logs in another member — fine if same family.
        const other = await db.doc(paths.member(scope.trustId, claims.memberId)).get();
        const sameFamily = other.exists && phone10(other.data().phone) === digits;
        if (other.exists && !other.data().delete_flag && !sameFamily) {
          return { created: false, loginId: regNo, reason: 'यह रजि. नंबर दूसरे सदस्य का लॉगिन है' };
        }
        await db.doc(paths.member(scope.trustId, member.id)).update({ loginEnabled: !user.disabled, loginUid: user.uid, loginUpdatedAt: serverNow() });
        return { created: false, existed: true, loginId: regNo };
      }
      // A login with no member attached (old app): attach it, keep its password.
      await adminAuth.setCustomUserClaims(user.uid, {
        role: ROLE.MEMBER, trustId: scope.trustId, programId: member.programId ?? null,
        agentId: null, memberId: member.id, permissions: [],
      });
      await db.doc(paths.member(scope.trustId, member.id)).update({ loginEnabled: !user.disabled, loginUid: user.uid, loginUpdatedAt: serverNow() });
      return { created: false, existed: true, loginId: regNo };
    }

    user = await adminAuth.createUser({
      email,
      password: digits,
      displayName: member.displayName ?? '',
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(user.uid, {
      role: ROLE.MEMBER, trustId: scope.trustId, programId: member.programId ?? null,
      agentId: null, memberId: member.id, permissions: [],
    });
    await db.doc(paths.member(scope.trustId, member.id)).update({
      loginEnabled: true, loginUid: user.uid, loginAuto: true, loginUpdatedAt: serverNow(),
    });
    return { created: true, loginId: regNo, password: digits, passwordHint: 'मोबाइल नंबर' };
  } catch (error) {
    console.error('[memberLogin] auto-create failed', member?.id, error?.message);
    return { created: false, loginId: member?.registrationNumber ?? '', reason: 'लॉगिन अपने-आप नहीं बन सका — सदस्य के "सदस्य ऐप लॉगिन" टैब से बनाएँ' };
  }
}

/**
 * Logins for members enrolled before auto-create existed. One batch per call
 * (so a request never runs long); the caller repeats until `remaining` is 0.
 * Members without a mobile number are counted and skipped.
 */
export async function backfillMemberLogins(scope, { limit = 60 } = {}) {
  const snap = await db.collection(paths.members(scope.trustId))
    .select('registrationNumber', 'phone', 'displayName', 'programId', 'loginUid', 'delete_flag', 'loginBackfillSkip')
    .get();
  const todo = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !m.delete_flag && !m.loginUid && !m.loginBackfillSkip && m.registrationNumber);

  const batch = todo.slice(0, limit);
  let created = 0; let linked = 0; let skipped = 0;
  for (const m of batch) {
    const r = await ensureMemberLogin(scope, m);
    if (r.created) created += 1;
    else if (r.existed) linked += 1;
    else {
      skipped += 1;
      // Do not retry the same member forever; the office handles these by hand.
      await db.doc(paths.member(scope.trustId, m.id)).update({ loginBackfillSkip: r.reason ?? true });
    }
  }
  return { processed: batch.length, created, linked, skipped, remaining: Math.max(0, todo.length - batch.length) };
}

async function readMember(scope, memberId) {
  const snap = await db.doc(paths.member(scope.trustId, memberId)).get();
  if (!snap.exists || snap.data().delete_flag) throw notFound('सदस्य नहीं मिला');
  return { id: snap.id, ...snap.data() };
}

function phone10(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
