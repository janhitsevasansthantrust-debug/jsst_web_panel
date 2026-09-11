import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { listAgents, createAgent } from '../../../server/domain/agents.js';
import { agentCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/agents — every agent with their running totals.
 *
 * The earned/paid/due figures are counters kept on the agent document and
 * updated inside the same transaction as each payment, so this never has to
 * scan `commission_entries` to produce a total.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const includeInactive =
    new URL(request.url).searchParams.get('includeInactive') === 'true';

  const result = await listAgents(scope, { includeInactive });
  return ok(result);
});

/**
 * POST /api/agents — add an agent.
 *
 * Creates a Firebase Auth account with role claims, so the agent can sign in,
 * collect payments and see only their own members.
 *
 * `password` comes back in this response and NOWHERE else — it is hashed by
 * Firebase and never written to Firestore. The UI shows it once; after that the
 * only route is a reset, which is correct rather than inconvenient.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, agentCreate);
  const { agent, password } = await createAgent(scope, input);
  return ok({ agent, password }, { status: 201 });
});
