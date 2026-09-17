import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getMemberLedger } from '../../../../../server/domain/payments.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/members/[id]/ledger
 *
 * Everything one member owes and everything they have paid.
 *
 * Cost: 1 member document + 1 cached closings index + up to 20 receipts.
 *
 * The old system read that member's ~500 `payment_pending` documents to build
 * the same screen, and re-read them every time the drawer was reopened.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const url = new URL(request.url);
  /**
   * 300, not 100. This feeds the member's own account tab, and somebody
   * asking what they have paid means all of it — a list that silently stops
   * part-way is one they will dispute at the counter. A member with more
   * receipts than this has been paying weekly for six years.
   */
  const receiptLimit = Math.min(
    Number(url.searchParams.get('receipts')) || 20,
    300,
  );

  const ledger = await getMemberLedger(scope, id, { receiptLimit });
  return ok(ledger);
});
