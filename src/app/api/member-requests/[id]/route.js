import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import {
  getMemberRequest, approveMemberRequest, rejectMemberRequest,
  removeMemberRequest, resubmitMemberRequest,
} from '../../../../server/domain/memberRequests.js';
import { memberRequestCreate, memberRequestReview } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/member-requests/[id] */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok({ request: await getMemberRequest(scope, id) });
});

/**
 * PATCH /api/member-requests/[id] — the office's decision.
 *   { action: 'approve', registrationNumber?, joinDateMs?, joinFeesPaidNow?, … }
 *   { action: 'reject', reason }
 *
 * Approving creates the member through the same `createMember` the counter
 * uses, under the agent who sent the request.
 */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  const body = await readBody(request, memberRequestReview);

  if (body.action === 'approve') {
    const { action, ...overrides } = body;
    const result = await approveMemberRequest(scope, id, overrides);
    return ok(result);
  }
  return ok({ request: await rejectMemberRequest(scope, id, { reason: body.reason }) });
});

/** PUT /api/member-requests/[id] — the agent corrects and re-sends their request. */
export const PUT = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const input = await readBody(request, memberRequestCreate);
  return ok({ request: await resubmitMemberRequest(scope, id, input) });
});

/** DELETE /api/member-requests/[id] — remove (office) or withdraw (agent). */
export const DELETE = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok(await removeMemberRequest(scope, id));
});
