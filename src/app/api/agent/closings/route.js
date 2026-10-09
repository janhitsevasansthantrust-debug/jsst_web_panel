import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getAgentClosings } from '../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/agent/closings — every closing with the agent's paid / pending counts. */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  return ok(await getAgentClosings(scope));
});
