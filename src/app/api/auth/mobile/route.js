import { z } from 'zod';

import { handler, ok, readBody } from '../../../../server/http.js';
import { createMobileSession, destroySession } from '../../../../server/auth/session.js';

const body = z.object({
  /** Registration number (members) or email (agents, staff). */
  identifier: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/auth/mobile — sign in from the phone app (trust-app).
 *
 * A registration number becomes `1023@gmail.com`, the same convention the web
 * login and every member login since the old app use. The answer carries a
 * bearer token (a Firebase session cookie, valid 14 days, revocable) and the
 * role, which decides whether the app opens the agent or the member screens.
 */
export const POST = handler(async (request) => {
  const { identifier, password } = await readBody(request, body);
  const email = identifier.includes('@') ? identifier : `${identifier.toLowerCase()}@gmail.com`;
  const { token, decoded, expiresAtMs } = await createMobileSession(email, password);

  return ok({
    token,
    expiresAtMs,
    user: {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: decoded.name ?? '',
      // No role claim = a member login carried over from the old app.
      role: decoded.role ?? 'member',
      agentId: decoded.agentId ?? null,
      memberId: decoded.memberId ?? null,
      programId: decoded.programId ?? null,
    },
  });
});

/** DELETE /api/auth/mobile — sign out: revokes the token everywhere. */
export const DELETE = handler(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
