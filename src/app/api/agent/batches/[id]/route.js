import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getAgentBatch } from '../../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/agent/batches/[id] — one क्लोजिंग समूह for the signed-in agent:
 * its closings and each of the agent's members' dues across the batch.
 * `_none` = closings that are on no batch.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok(await getAgentBatch(scope, id));
});
