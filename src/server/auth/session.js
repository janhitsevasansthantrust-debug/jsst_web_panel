import 'server-only';

import { cookies, headers } from 'next/headers';

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
  const existing = store.get(SESSION_COOKIE)?.value ?? (await bearerToken());

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

/**
 * The phone app (trust-app, Expo) cannot rely on an httpOnly cookie, so it
 * sends the very same Firebase session cookie as `Authorization: Bearer …`.
 * It is verified exactly like the cookie — revocation included — so a token
 * is worth no more than a cookie, and signing out or disabling the user ends
 * it the same way.
 */
async function bearerToken() {
  try {
    const h = await headers();
    const auth = h.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Sign in from the phone app: email + password straight to Firebase Auth's
 * REST endpoint, then a session cookie minted from the fresh ID token and
 * handed back as a bearer token. The app never holds a password or a
 * long-lived Firebase refresh token, and needs no Firebase SDK at all.
 */
export const MOBILE_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // Firebase maximum

export async function createMobileSession(email, password) {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) {
    const code = String(body?.error?.message ?? '');
    if (code.includes('TOO_MANY_ATTEMPTS')) throw unauthorized('बहुत बार कोशिश की गई — कुछ देर बाद प्रयास करें');
    if (code.includes('USER_DISABLED')) throw unauthorized('यह लॉगिन बंद है — कार्यालय से संपर्क करें');
    throw unauthorized('लॉगिन ID या पासवर्ड गलत है');
  }

  const decoded = await adminAuth.verifyIdToken(body.idToken, true);
  const token = await adminAuth.createSessionCookie(body.idToken, {
    expiresIn: MOBILE_SESSION_MAX_AGE_MS,
  });
  return { token, decoded, expiresAtMs: Date.now() + MOBILE_SESSION_MAX_AGE_MS };
}

/**
 * A fresh 14-day phone token for someone already signed in — without their
 * password. Used to keep the app signed in for as long as it is used (the app
 * renews a few days before expiry) and after a password change (which revokes
 * the old token).
 *
 * Custom token → ID token (Firebase Auth REST) → session cookie: the same
 * kind of token a password sign-in produces, revocable the same way.
 */
export async function reissueMobileSession(uid) {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');

  const custom = await adminAuth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) throw unauthorized('सत्र नवीनीकरण नहीं हुआ — दोबारा लॉगिन करें');

  const token = await adminAuth.createSessionCookie(body.idToken, { expiresIn: MOBILE_SESSION_MAX_AGE_MS });
  return { token, expiresAtMs: Date.now() + MOBILE_SESSION_MAX_AGE_MS };
}

/**
 * Check a password for an email without creating a session — the "current
 * password" step of a password change.
 */
export async function verifyPassword(email, password) {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(body?.error?.message ?? '');
    if (code.includes('TOO_MANY_ATTEMPTS')) throw unauthorized('बहुत बार कोशिश की गई — कुछ देर बाद प्रयास करें');
    return false;
  }
  return true;
}

export async function getSession() {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value ?? (await bearerToken());
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
    /**
     * The role exactly as the account carries it, or null. `role` defaults to
     * member for an account with no claims at all — which is both a login
     * carried over from the old app AND a brand-new owner before setup — so
     * anything that must tell those apart reads this instead.
     */
    roleClaim: claims.role ?? null,
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
