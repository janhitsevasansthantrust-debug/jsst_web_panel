import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { updateTeamMember } from '../../../../../server/domain/trust.js';
import { teamMemberUpdate } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/** PATCH /api/trust/team/[uid] — edit details, change role, or switch access off. */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { uid } = await context.params;
  const patch = await readBody(request, teamMemberUpdate);
  return ok(await updateTeamMember(scope, uid, patch));
});
