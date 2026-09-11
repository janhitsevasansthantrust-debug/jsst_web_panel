import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { postPayment } from '../../../server/domain/payments.js';
import { db } from '../../../server/firebase/admin.js';
import { paymentCreate } from '../../../config/schemas.js';
import { paths, ROLE, LIMITS } from '../../../config/constants.js';

/**
 * GET /api/payments — the receipt register (लेन-देन).
 *
 * Paginated over receipts, which is a few thousand documents at most, not the
 * millions of obligation rows the old system kept.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);
  const limit = Math.min(
    Number(url.searchParams.get('limit')) || LIMITS.PAGE_SIZE,
    LIMITS.MAX_PAGE_SIZE,
  );

  let query = db
    .collection(paths.payments(scope.trustId, scope.programId))
    .where('delete_flag', '==', false);

  const memberId = url.searchParams.get('memberId');
  if (memberId) query = query.where('memberId', '==', memberId);

  // An agent sees only what they collected.
  const agentId =
    scope.role === ROLE.AGENT
      ? scope.agentId
      : url.searchParams.get('agentId');
  if (agentId) query = query.where('collectedByAgentId', '==', agentId);

  query = query.orderBy('paidAtMs', 'desc');

  const cursor = url.searchParams.get('cursor');
  if (cursor) query = query.startAfter(Number(cursor));

  const snap = await query.limit(limit).get();
  const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const last = payments[payments.length - 1];

  return ok({
    payments,
    nextCursor: snap.size === limit && last ? last.paidAtMs : null,
  });
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
