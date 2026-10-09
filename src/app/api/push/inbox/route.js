import { handler, ok } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { inboxFor } from '../../../../server/domain/push.js';

/** GET /api/push/inbox — the app's "सूचनाएँ" list for whoever is signed in. */
export const GET = handler(async () => {
  const session = await requireSession();
  return ok({ notifications: await inboxFor(session) });
});
