import { handler, okCached } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getMembersIndex } from '../../../../server/domain/indexes.js';
import { toSearchRow } from '../../../../lib/memberSearch.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/search-index — the searchable list, once, for the browser.
 *
 * This is what makes typing free. The server already holds every member in
 * memory for about ten Firestore reads; handing the browser a compact copy
 * means a search costs one download per session instead of a round trip per
 * keystroke — which on a phone on a village connection is the whole
 * difference between a search box that feels instant and one that does not.
 *
 * Rows are positional arrays of seven short fields. At 5,000 members that is
 * roughly 350 KB before compression, against 1.7 MB for the full index entry.
 *
 * Above `MAX_LOCAL` the trade stops paying: the download would cost more than
 * it saves, so the endpoint says so and the browser goes back to asking the
 * server per query. Better to change strategy at a stated size than to ship a
 * three-megabyte payload to a phone and call it instant.
 */
const MAX_LOCAL = 20000;

export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);
  const allPrograms = url.searchParams.get('allPrograms') === 'true';

  const { items, version } = await getMembersIndex(scope.trustId);

  let rows = allPrograms
    ? items
    : items.filter((m) => m.pid === scope.programId);

  // An agent only ever searches their own members — applied from the verified
  // session, not from the query string.
  if (scope.role === ROLE.AGENT) {
    rows = rows.filter((m) => m.agentId === scope.agentId);
  }

  if (rows.length > MAX_LOCAL) {
    return okCached({ mode: 'remote', count: rows.length, version }, 60);
  }

  return okCached(
    {
      mode: 'local',
      version,
      count: rows.length,
      rows: rows.map(toSearchRow),
    },
    // Five minutes at the edge. A member added in that window is still found:
    // the box falls back to the server whenever the local list has no answer.
    300,
  );
});
