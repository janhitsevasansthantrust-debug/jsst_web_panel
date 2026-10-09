import { handler, ok } from '../../../../server/http.js';
import { requireSession } from '../../../../server/auth/session.js';
import { getPortalFamily } from '../../../../server/domain/memberPortal.js';

/**
 * GET /api/portal/family — the member app's all-in-one screen: every member on
 * this mobile number with their closings (batch-wise), receipts and fees.
 */
export const GET = handler(async () => {
  const session = await requireSession();
  return ok(await getPortalFamily(session));
});
