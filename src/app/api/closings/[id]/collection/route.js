import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getClosingCollection } from '../../../../../server/domain/closings.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/closings/[id]/collection
 *
 * Who has paid for this closing and who still owes.
 *
 * The headline numbers (collected / pending / percentage) come from counters
 * kept on the closing document itself — a single read, no matter how many
 * members the trust has. The per-member list underneath is paginated over
 * MEMBERS, so it costs one page of documents rather than one document per
 * obligation.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const result = await getClosingCollection(scope, id, {
    cursor: cursor ? Number(cursor) : undefined,
    limit,
  });

  return ok(result);
});
