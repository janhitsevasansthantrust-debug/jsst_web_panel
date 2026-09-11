import { handler, ok, readBody, readQuery, badRequest } from '../../../server/http.js';
import { db } from '../../../server/firebase/admin.js';
import { requireScope } from '../../../server/auth/session.js';
import { createMember, listMembers } from '../../../server/domain/members.js';
import { memberCreate, memberListQuery } from '../../../config/schemas.js';
import { ROLE, paths } from '../../../config/constants.js';

/**
 * GET /api/members — one page of members.
 *
 * Reads exactly `limit` documents (50 by default). The due figures come from
 * counters already stored on each member, so this endpoint never touches the
 * payments collection at all.
 *
 * An agent is silently scoped to their own members — they cannot widen the
 * query by editing the URL, because the filter is applied from their verified
 * session, not from the query string.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const params = readQuery(request, memberListQuery);

  const filters =
    scope.role === ROLE.AGENT
      ? { ...params, agentId: scope.agentId }
      : params;

  const result = await listMembers(scope, filters);
  return ok(result);
});

/**
 * POST /api/members — create a member.
 *
 * The योजना comes from the BODY, not the session: a trust runs several
 * programs and the operator picks one per member, exactly as the old form did.
 * It is verified to belong to this trust before anything is written — the id
 * arrives from a browser, so it is a request, not a fact.
 */
export const POST = handler(async (request) => {
  const session = await requireScope(request, ROLE.OPERATOR);
  const input = await readBody(request, memberCreate);

  const programSnap = await db
    .doc(paths.program(session.trustId, input.programId))
    .get();
  if (!programSnap.exists) throw badRequest('यह योजना मौजूद नहीं है');

  const scope = { ...session, programId: input.programId };

  const member = await createMember(scope, {
    ...input,
    // An agent can only ever add members under themselves.
    ...(scope.role === ROLE.AGENT
      ? { addedBy: 'agent', agentId: scope.agentId, agentName: scope.name }
      : {}),
  });

  return ok({ member }, { status: 201 });
});
