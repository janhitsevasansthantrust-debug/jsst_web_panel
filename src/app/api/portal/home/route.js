import { handler, ok } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { getPortalHome } from '../../../../server/domain/memberPortal.js';

/**
 * GET /api/portal/home — the member app's first screen: the signed-in member
 * and everyone on the same mobile number, grouped by योजना, with dues.
 */
export const GET = handler(async () => {
  const session = await requireSession();
  return ok(await getPortalHome(session));
});
