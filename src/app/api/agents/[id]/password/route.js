import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { resetAgentPassword } from '../../../../../server/domain/agents.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/agents/[id]/password — issue a new password for an agent.
 *
 * Comes back once, in this response, and is stored nowhere. Existing sessions
 * for that agent are revoked, so the new password is the only way in rather
 * than merely a second one.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  return ok(await resetAgentPassword(scope, id));
});
