import { handler, ok } from '../../../../../server/http.js';
import { requireRole } from '../../../../../server/auth/session.js';
import { backfillMemberLogins } from '../../../../../server/domain/memberLogin.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/members/logins/backfill — member-app logins for members enrolled
 * before logins were created automatically (reg. no. + mobile number).
 * One batch per call; the settings screen calls again until `remaining` is 0.
 * Existing logins are never changed (their passwords stay as they are).
 */
export const POST = handler(async () => {
  const scope = await requireRole(ROLE.ADMIN);
  return ok(await backfillMemberLogins(scope));
});
