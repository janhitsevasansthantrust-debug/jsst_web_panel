import { handler, ok } from '../../../../../../server/http.js';
import { requireScope } from '../../../../../../server/auth/session.js';
import { resetTeamPassword } from '../../../../../../server/domain/trust.js';
import { ROLE } from '../../../../../../config/constants.js';

/**
 * POST /api/trust/team/[uid]/password — issue a new password.
 *
 * Returns it once. Existing sessions for that account are revoked, so the new
 * password is not merely the new way in — it is the only way in.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { uid } = await context.params;
  return ok(await resetTeamPassword(scope, uid));
});
