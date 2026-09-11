import { handler, ok, readBody, unauthorized } from '../../../../server/http.js';
import { createSession, destroySession, getSession } from '../../../../server/auth/session.js';
import { sessionCreate } from '../../../../config/schemas.js';

/**
 * POST /api/auth/session — exchange a Firebase ID token for a session cookie.
 *
 * The browser signs in with the Firebase client SDK, calls this once, and then
 * never touches a token again: every later request carries an httpOnly cookie
 * that JavaScript cannot read. The old app attached a bearer token to every
 * single fetch, which meant the token lived in JS memory all day.
 */
export const POST = handler(async (request) => {
  const { idToken } = await readBody(request, sessionCreate);
  const decoded = await createSession(idToken);

  return ok({
    user: {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: decoded.name ?? '',
      role: decoded.role ?? 'member',
      trustId: decoded.trustId ?? null,
      programId: decoded.programId ?? null,
    },
  });
});

/** GET /api/auth/session — who am I? */
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();
  return ok({ user: session });
});

/** DELETE /api/auth/session — sign out everywhere. */
export const DELETE = handler(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
