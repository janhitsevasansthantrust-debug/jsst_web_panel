import { handler, ok, readBody, forbidden } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import {
  getMember, updateMember, deleteMember,
} from '../../../../server/domain/members.js';
import { memberUpdate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/members/[id] */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const member = await getMember(scope, id);

  if (scope.role === ROLE.AGENT && member.agentId !== scope.agentId) {
    throw forbidden('This member is not in your list');
  }

  return ok({ member });
});

/**
 * PATCH /api/members/[id]
 *
 * Editing `joinDateMs` or `payAmount` changes what the member owes, so the
 * ledger is re-derived inside the same transaction. The ledger fields
 * themselves are stripped from the patch — they are only ever moved by a
 * payment, a reversal or an exemption.
 */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  const patch = await readBody(request, memberUpdate);

  const member = await updateMember(scope, id, patch);
  return ok({ member });
});

/** DELETE /api/members/[id] — soft delete; refused once money has moved. */
export const DELETE = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const result = await deleteMember(scope, id);
  return ok(result);
});
