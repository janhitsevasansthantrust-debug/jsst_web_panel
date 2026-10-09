import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getMemberLogin, setMemberLogin } from '../../../../../server/domain/memberLogin.js';
import { memberLoginSet } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/** GET /api/members/[id]/login — does this member have a member-app login? */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  return ok({ login: await getMemberLogin(scope, id) });
});

/**
 * POST /api/members/[id]/login — create the login / set a new password /
 * switch it on or off. The password comes back once and is not stored.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  const body = await readBody(request, memberLoginSet);
  return ok({ login: await setMemberLogin(scope, id, body) });
});
