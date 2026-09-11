import { handler, ok, readBody, forbidden } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getAgentDetail, updateAgent } from '../../../../server/domain/agents.js';
import { agentUpdate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/agents/[id] — one agent: totals, the commission policy actually in
 * force for them (program default merged with their override), their recent
 * commission entries, and how many of their members still owe.
 *
 * An agent may read their own record; anything above that needs OPERATOR.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  if (scope.role === ROLE.AGENT && scope.agentId !== id) {
    throw forbidden('You can only view your own agent record');
  }

  const detail = await getAgentDetail(scope, id);
  return ok(detail);
});

/** PATCH /api/agents/[id] — edit details or commission override. */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const patch = await readBody(request, agentUpdate);

  const { agent, cascade } = await updateAgent(scope, id, patch);

  // The caller is told how far a rename reached, so the UI can say "412
  // members updated" rather than leaving the admin to wonder whether it did.
  return ok({ agent, cascade });
});
