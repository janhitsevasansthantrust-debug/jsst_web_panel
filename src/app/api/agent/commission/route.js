import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getAgentCommission } from '../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/agent/commission — the agent's commission entries and payouts. */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  return ok(await getAgentCommission(scope));
});
