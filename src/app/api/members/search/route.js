import { handler, okCached } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { searchMembers } from '../../../../server/domain/members.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/search?q=...
 *
 * Searches 5,000 members for FIVE Firestore reads — and zero on a warm
 * instance, because the shards are held in memory for a minute.
 *
 * The old system kept a `search_keywords` array on every member: 200+ prefix
 * tokens written on every save, and a Firestore query per keystroke. This
 * pulls five small index documents once and then filters in memory, which is
 * both instant and effectively free.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);

  const term = url.searchParams.get('q') ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);

  // `allPrograms=true` widens the search to every योजना in the trust — the one
  // thing the old per-program collections made impossible.
  const allPrograms = url.searchParams.get('allPrograms') === 'true';

  const result = await searchMembers(scope, term, { limit, allPrograms });

  // An agent only ever sees their own members.
  const members =
    scope.role === ROLE.AGENT
      ? result.members.filter((m) => m.agentId === scope.agentId)
      : result.members;

  return okCached({ ...result, members }, 30);
});
