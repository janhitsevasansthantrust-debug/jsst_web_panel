import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { revertClosing } from '../../../../../server/domain/closings.js';
import { closingRevert } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/closings/[id]/revert
 *
 * The old `revertClosingMember` deleted every `payment_pending` document for
 * the closing — including the paid ones. The record of who had already
 * contributed was destroyed, and there was no way to get it back.
 *
 * This version:
 *   • touches only members who ACTUALLY PAID (found from the receipts —
 *     a few hundred, not five thousand)
 *   • reverses rather than deletes; receipts are annotated, never removed
 *   • keeps the closing document, marked `reverted`, so its seq stays retired
 *     and no future closing can reuse it
 *   • leaves collected money as credit against the payer's future closings,
 *     unless the operator explicitly chooses to cancel those lines
 *   • writes an audit log entry with the reason and the author
 *
 * Requires ADMIN and a written reason.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const { reason, refundMode } = await readBody(request, closingRevert);

  const result = await revertClosing(scope, id, {
    reason,
    refundMode,
    uid: scope.uid,
  });

  return ok(result);
});
