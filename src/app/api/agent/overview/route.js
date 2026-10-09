import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getAgentOverview } from '../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/agent/overview — the agent app's home screen.
 *
 * Members, dues, joining fees and commission for the signed-in agent, from the
 * shared member index plus one agent document. Scoped from the session: an
 * agent cannot ask for anyone else's figures.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  return ok(await getAgentOverview(scope));
});
