import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { createPayout } from '../../../../server/domain/agents.js';
import { payoutCreate } from '../../../../config/schemas.js';
import { db } from '../../../../server/firebase/admin.js';
import { paths, ROLE } from '../../../../config/constants.js';

/** GET /api/commission/payouts — settlement history. */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');

  let query = db
    .collection(paths.commissionPayouts(scope.trustId, scope.programId))
    .orderBy('paidAtMs', 'desc')
    .limit(100);

  // An agent only ever sees their own payouts.
  const scopedAgent = scope.role === ROLE.AGENT ? scope.agentId : agentId;
  if (scopedAgent) query = query.where('agentId', '==', scopedAgent);

  const snap = await query.get();
  return ok({ payouts: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

/**
 * POST /api/commission/payouts — settle a set of commission entries.
 *
 * Entries are re-read inside the transaction, and anything already paid or
 * cancelled is refused and reported back in `skipped`. Same principle as
 * payments: the browser proposes a selection, the server decides what is
 * actually payable.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, payoutCreate);
  const payout = await createPayout(scope, input);
  return ok({ payout }, { status: 201 });
});
