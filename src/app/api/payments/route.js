import { handler, ok, readBody, readQuery, forbidden } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { postPayment } from '../../../server/domain/payments.js';
import { listPaymentsPage } from '../../../server/domain/paymentQuery.js';
import { paymentCreate, paymentQuery } from '../../../config/schemas.js';
import { ROLE, LIMITS } from '../../../config/constants.js';

/**
 * GET /api/payments — the receipt register (लेन-देन).
 *
 * Paginated over receipts, which is a few thousand documents at most, not the
 * millions of obligation rows the old system kept.
 *
 * The reading itself lives in `server/domain/paymentQuery.js` because the
 * report on the same screen reads the identical set through the identical
 * predicate — see that file for why the date range goes into Firestore while
 * the method, the status and the search do not.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  if (scope.role === ROLE.AGENT && !scope.agentId) throw forbidden();

  const parsed = readQuery(request, paymentQuery);

  const { payments, nextCursor } = await listPaymentsPage(
    scope,
    {
      ...parsed,
      // An agent sees only what they collected.
      agentId: scope.role === ROLE.AGENT ? scope.agentId : parsed.agentId,
    },
    parsed.limit ?? LIMITS.PAGE_SIZE,
  );

  return ok({ payments, nextCursor });
});

/**
 * POST /api/payments — record a payment (रसीद).
 *
 * This is the endpoint that fixes the pending/paid bug. Everything below the
 * validation happens inside ONE Firestore transaction:
 *
 *   • the member's ledger is re-read inside the transaction
 *   • the server, not the browser, decides which closings are genuinely due
 *   • anything already paid / exempt / ineligible is REJECTED and reported
 *   • receipt, ledger, closing counters, program stats and the agent's
 *     commission entry are written together, or not at all
 *
 * The response always includes `rejected`, so the UI can tell the operator
 * exactly why a line did not go through instead of silently dropping it.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const input = await readBody(request, paymentCreate);

  // An agent always collects as themselves — they cannot credit another agent.
  const collectedByAgentId =
    scope.role === ROLE.AGENT ? scope.agentId : input.collectedByAgentId;

  // Fall back to a request-scoped idempotency key from the header if the body
  // did not carry one. A retried request then returns the ORIGINAL receipt.
  const idempotencyKey =
    input.idempotencyKey ?? request.headers.get('Idempotency-Key') ?? undefined;

  const result = await postPayment(scope, {
    ...input,
    collectedByAgentId,
    idempotencyKey,
  });

  return ok(
    {
      receipt: result.receipt,
      receipts: result.receipts,
      totalAmount: result.totalAmount,
      rejected: result.rejected,
      // A partial success is still a success — the UI shows what went through.
      partial: result.rejected.length > 0,
    },
    { status: 201 },
  );
});
