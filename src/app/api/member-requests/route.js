import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import {
  createMemberRequest, listMemberRequests, countPendingRequests,
} from '../../../server/domain/memberRequests.js';
import { memberRequestCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/member-requests?status=pending|approved|rejected|all
 *
 * An agent gets their own requests; the office gets everyone's.
 * `?count=pending` returns only the waiting count — the menu badge.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);

  if (url.searchParams.get('count') === 'pending' && scope.role !== ROLE.AGENT) {
    return ok({ pending: await countPendingRequests(scope) });
  }

  return ok(await listMemberRequests(scope, {
    status: url.searchParams.get('status') || undefined,
    agentId: url.searchParams.get('agentId') || undefined,
    programId: url.searchParams.get('forProgram') || undefined,
  }));
});

/** POST /api/member-requests — an agent asks the office to add a member. */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const input = await readBody(request, memberRequestCreate);
  const created = await createMemberRequest(scope, input);
  return ok({ request: created }, { status: 201 });
});
