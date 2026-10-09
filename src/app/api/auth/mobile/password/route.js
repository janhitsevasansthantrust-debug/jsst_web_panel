import { z } from 'zod';

import { handler, ok, readBody, badRequest, forbidden } from '../../../../../server/http.js';
import { adminAuth } from '../../../../../server/firebase/admin.js';
import { requireSession, reissueMobileSession, verifyPassword } from '../../../../../server/auth/session.js';

const body = z.object({
  current: z.string().min(1).max(128),
  next: z.string().min(6, 'नया पासवर्ड कम से कम 6 अक्षर का हो').max(72),
});

/**
 * POST /api/auth/mobile/password — change your own password from the app
 * (agent or member). The current password is checked first; then the new one
 * is set, every other device is signed out, and this phone gets a fresh token
 * so it stays signed in.
 */
export const POST = handler(async (request) => {
  const session = await requireSession();
  const { current, next } = await readBody(request, body);
  if (current === next) throw badRequest('नया पासवर्ड पुराने से अलग होना चाहिए');

  const user = await adminAuth.getUser(session.uid);
  if (!user.email) throw forbidden('इस खाते में ईमेल नहीं है — कार्यालय से पासवर्ड बदलवाएँ');
  if (!(await verifyPassword(user.email, current))) throw badRequest('मौजूदा पासवर्ड गलत है');

  await adminAuth.updateUser(session.uid, { password: next });
  await adminAuth.revokeRefreshTokens(session.uid);
  const fresh = await reissueMobileSession(session.uid);
  return ok({ changed: true, ...fresh });
});
