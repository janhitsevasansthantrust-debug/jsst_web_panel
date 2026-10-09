import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getAgentClosingMembers } from '../../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../../config/constants.js';

/** GET /api/agent/closings/[id] — the agent's members for one closing. */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok(await getAgentClosingMembers(scope, id));
});
