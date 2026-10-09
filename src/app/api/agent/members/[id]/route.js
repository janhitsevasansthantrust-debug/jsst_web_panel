import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getAgentMember } from '../../../../../server/domain/agentApp.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/agent/members/[id] — one of the agent's members, in full: closing
 * by closing paid / pending, receipts, joining fee. Refused for anyone else's.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok(await getAgentMember({ ...scope }, id));
});
