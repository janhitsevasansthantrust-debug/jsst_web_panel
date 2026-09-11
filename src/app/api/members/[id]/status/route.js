import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { setMemberStatus } from '../../../../../server/domain/members.js';
import { memberStatusChange } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/members/[id]/status — accept, block, mark left, re-activate.
 *
 * Accepting a member used to trigger a Cloud Function that wrote one
 * `payment_pending` document for every open marriage case. Nothing is written
 * now: the date rule already decides what an accepted member owes. This only
 * refreshes their due counters so the list screens stay accurate.
 *
 * Blocking or marking someone as left sets `exitDateMs`, which stops future
 * closings from applying to them while leaving past dues intact.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  const { status, reason, atMs } = await readBody(request, memberStatusChange);

  const member = await setMemberStatus(scope, id, status, {
    uid: scope.uid,
    reason,
    atMs,
  });

  return ok({
    member: {
      id,
      status: member.status,
      dueCount: member.dueCount,
      dueAmount: member.dueAmount,
    },
  });
});
