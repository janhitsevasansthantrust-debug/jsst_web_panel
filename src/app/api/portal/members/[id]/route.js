import { handler, ok } from '../../../../../server/http.js';
import { requireSession } from '../../../../../server/auth/session.js';
import { getPortalMember } from '../../../../../server/domain/memberPortal.js';

/**
 * GET /api/portal/members/[id] — one linked member in full: every closing with
 * paid / pending, on-time / late, the receipts and the joining fee.
 *
 * Refused unless the member shares the signed-in member's mobile number.
 */
export const GET = handler(async (request, context) => {
  const session = await requireSession();
  const { id } = await context.params;
  return ok(await getPortalMember(session, id));
});
