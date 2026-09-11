import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { handoverAgent } from '../../../../../server/domain/agents.js';
import { agentHandover } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/agents/[id]/handover — give this agent's position to someone else.
 *
 * The agent record, its id, its members and its whole commission history stay
 * exactly where they are; the PERSON behind it changes. The outgoing holder is
 * signed out everywhere the moment this returns.
 *
 * ADMIN and above: this hands one person control of another's collection round
 * and their members' money.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const input = await readBody(request, agentHandover);

  const result = await handoverAgent(scope, id, input);
  return ok(result);
});
