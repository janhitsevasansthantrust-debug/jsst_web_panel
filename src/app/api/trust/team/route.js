import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { listTeam, addTeamMember } from '../../../../server/domain/trust.js';
import { teamMemberCreate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/trust/team — everyone who can sign in to the office side. */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  return ok(await listTeam(scope));
});

/**
 * POST /api/trust/team — add someone who can sign in.
 *
 * `password` comes back in this response and NOWHERE else. Show it once, then
 * it only exists as a hash inside Firebase Auth.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, teamMemberCreate);
  const { user, password } = await addTeamMember(scope, input);
  return ok({ user, password }, { status: 201 });
});
