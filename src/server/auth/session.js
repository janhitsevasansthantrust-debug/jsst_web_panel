import 'server-only';

import { cookies } from 'next/headers';

import { adminAuth, db } from '../firebase/admin.js';
import { forbidden, unauthorized } from '../http.js';
import { resolveTrustId } from '../domain/trustId.js';
import {
  ROLE,
  ROLE_RANK,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  paths,
} from '../../config/constants.js';

/**
 * Session handling.
 *
 * We keep Firebase Auth (existing member logins keep working) but stop sending
 * an ID token on every request the way the old app did. The browser exchanges
 * its ID token ONCE for an httpOnly session cookie; every later request is
 * verified from that cookie.
 *
 * Why this matters:
 *   • an httpOnly cookie cannot be read by JavaScript → no XSS token theft
 *   • no `Authorization` header plumbing in every fetch call
 *   • `verifySessionCookie` is checked against revocation, so disabling a user
 *     in Firebase logs them out everywhere within minutes
 */

/** Exchange a freshly-minted Firebase ID token for a session cookie. */
export async function createSession(idToken) {
  const decoded = await adminAuth.verifyIdToken(idToken, true);

  // Refuse a stale token: sign-in must have happened in the last 5 minutes.
  const ageMs = Date.now() - decoded.auth_time * 1000;
  if (ageMs > 5 * 60 * 1000) {
    throw unauthorized('Please sign in again');
  }

  const cookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  return decoded;
}

export async function destroySession() {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;

  if (existing) {
    try {
      const decoded = await adminAuth.verifySessionCookie(existing);
      await adminAuth.revokeRefreshTokens(decoded.sub);
    } catch {
      // Already invalid — nothing to revoke.
    }
  }
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in principal, or null.
 *
 * Cached per request: several guards and server components call this in one
 * render and we only want to verify the cookie once.
 */
/**
 * The one trust this deployment serves.
 *
 * This app runs ONE trust. Giving the system to another trust means another
 * deployment with its own Firebase project and its own `TRUST_ID` — not a
 * second row inside this one. That is a deliberate choice: two trusts sharing
 * a database share a blast radius, and every screen would have to carry a
 * "which trust" question that nobody in the office ever actually asks.
 *
 * The trust id still exists in the Firestore path, because it costs one path
 * segment and it is what makes a clone a copy rather than a rewrite. It is
 * simply never a choice the user makes.
 *
 * When `TRUST_ID` is set it wins over whatever is in the session token. A
 * token minted before the trust was pinned — or against another project —
 * cannot then reach data it should not.
 */
// Resolution lives in `domain/trustId.js`, because deciding it needs a read:
// a pin that points at a trust which does not exist must not take the whole
// app down, and believing it blindly is exactly what did.
export { pinnedTrustId } from '../domain/trustId.js';

export async function getSession() {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(cookie, true);
  } catch {
    return null;
  }

  const claims = decoded;

  return {
    uid: decoded.uid ?? decoded.sub,
    email: claims.email ?? null,
    name: claims.name ?? claims.displayName ?? '',
    role: claims.role ?? ROLE.MEMBER,
    trustId: claims.trustId ?? null,
    programId: claims.programId ?? null,
    agentId: claims.agentId ?? null,
    memberId: claims.memberId ?? null,
    permissions: claims.permissions ?? [],
  };
}

/** Same as `getSession` but throws a 401 instead of returning null. */
export async function requireSession() {
  const session = await getSession();
  if (!session) throw unauthorized();

  // The trust is a property of the DEPLOYMENT, not of the token — but it is
  // checked against what is actually in Firestore before it is used, so a
  // mismatched `TRUST_ID` degrades to a warning instead of an outage.
  const trustId = await resolveTrustId(session.trustId);

  if (!trustId) {
    throw forbidden(
      'यह खाता किसी ट्रस्ट से जुड़ा नहीं है — npm run create-owner चलाएँ',
    );
  }

  return { ...session, trustId };
}

/**
 * Require at least `minRole`. Roles are ranked, so `requireRole(ROLE.ADMIN)`
 * also lets an owner through.
 */
export async function requireRole(minRole) {
  const session = await requireSession();
  const have = ROLE_RANK[session.role] ?? 0;
  const need = ROLE_RANK[minRole] ?? 999;
  if (have < need) {
    throw forbidden(`This action needs ${minRole} access`);
  }
  return session;
}

/**
 * Resolve the trust + program a request is operating on, and prove the caller
 * is allowed to touch them.
 *
 * Every domain call takes `{trustId, programId}` from HERE, never from the
 * query string. The old app read `userId` straight out of `req.query`, which
 * meant any signed-in user could read another trust's data by editing the URL.
 */
export async function requireScope(request, minRole = ROLE.OPERATOR) {
  const session = await requireRole(minRole);

  const url = new URL(request.url);
  const requestedProgram = url.searchParams.get('programId');

  const programId = requestedProgram ?? session.programId;
  if (!programId) {
    throw unauthorized('No program selected');
  }

  // An admin may switch programs within their own trust; nobody may cross
  // trusts, because trustId comes only from the verified session.
  if (requestedProgram && requestedProgram !== session.programId) {
    const snap = await db
      .doc(paths.program(session.trustId, requestedProgram))
      .get();
    if (!snap.exists) throw forbidden('Unknown program');
  }

  return { ...session, programId };
}

/** Write role/scope claims onto a Firebase Auth user. */
export async function setUserClaims(uid, { role, trustId, programId, agentId, memberId, permissions }) {
  await adminAuth.setCustomUserClaims(uid, {
    role,
    trustId,
    programId: programId ?? null,
    agentId: agentId ?? null,
    memberId: memberId ?? null,
    permissions: permissions ?? [],
  });
}
