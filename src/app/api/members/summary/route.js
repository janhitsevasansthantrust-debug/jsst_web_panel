import { handler, okCached, readQuery } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getMemberSummary } from '../../../../server/domain/members.js';
import { memberSummaryQuery } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/summary — counts, grouped however you ask.
 *
 * `?groupBy=agent,village,status` returns one block per dimension, each with
 * counts split by status plus the outstanding and collected totals for that
 * bucket. Every one of them comes from the same in-memory index the members
 * list is served from, so a count here and the rows behind it can never
 * disagree.
 *
 * An agent is silently scoped to their own members, from their verified
 * session rather than the query string.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const params = readQuery(request, memberSummaryQuery);

  const filters =
    scope.role === ROLE.AGENT ? { ...params, agentId: [scope.agentId] } : params;

  return okCached(await getMemberSummary(scope, filters), 30);
});
