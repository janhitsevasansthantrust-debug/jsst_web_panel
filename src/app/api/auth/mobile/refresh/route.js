import { handler, ok } from '../../../../../server/http.js';
import { requireSession, reissueMobileSession } from '../../../../../server/auth/session.js';

/**
 * POST /api/auth/mobile/refresh — swap a still-valid phone token for a new
 * 14-day one. The app calls it when its token is a few days old, so someone
 * who uses the app at least once a fortnight never has to log in again.
 * A revoked or expired token gets a 401 like everywhere else.
 */
export const POST = handler(async () => {
  const session = await requireSession();
  return ok(await reissueMobileSession(session.uid));
});
