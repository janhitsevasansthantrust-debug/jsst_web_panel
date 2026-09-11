import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { cancelPayment } from '../../../../../server/domain/payments.js';
import { paymentCancel } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/payments/[id]/cancel
 *
 * Money records are immutable. Cancelling writes a reversal: the receipt stays,
 * marked cancelled with a reason and an author, while the ledger, the closing
 * counters, the program stats and the agent's commission entry are all un-done
 * in one transaction.
 *
 * Requires ADMIN — an agent may collect money but may not un-collect it.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const { reason } = await readBody(request, paymentCancel);

  const result = await cancelPayment(scope, id, { reason, uid: scope.uid });
  return ok(result);
});
