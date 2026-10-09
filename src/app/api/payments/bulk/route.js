import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { bulkCollect } from '../../../../server/domain/payments.js';
import { bulkCollectInput } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * POST /api/payments/bulk — bank one deposit against many members.
 *
 * With `preview: true` it writes nothing and returns the proposed split, so
 * the operator approves real numbers rather than a promise. Without it, the
 * split is recomputed from freshly read ledgers and each member gets their own
 * receipt.
 *
 * `OPERATOR`, the same as taking a single payment: this is the counter's job,
 * not an administrative one. An agent cannot post for other people's members —
 * `postPayment` scopes every write to the member it names, and the member list
 * an agent can see is already filtered to their own.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const input = await readBody(request, bulkCollectInput);
  input.idempotencyKey ??= request.headers.get('Idempotency-Key') ?? undefined;
  if (scope.role === ROLE.AGENT) input.collectedByAgentId = scope.agentId;

  return ok(await bulkCollect(scope, input));
});
