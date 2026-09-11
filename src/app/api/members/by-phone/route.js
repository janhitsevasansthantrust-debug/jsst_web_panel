import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { findMembersByPhone } from '../../../../server/domain/members.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/by-phone?phone=…
 *
 * Looks across EVERY program in the trust, because that is the point: a family
 * that already belongs to one योजना is joining another, and their details
 * should be copied rather than re-typed. Re-typing is how the same person ends
 * up with a different spelling and a different village in each program.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const phone = new URL(request.url).searchParams.get('phone') ?? '';

  const result = await findMembersByPhone(scope, phone);
  return ok(result);
});
