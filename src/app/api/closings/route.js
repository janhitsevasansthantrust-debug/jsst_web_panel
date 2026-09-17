import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { createClosing, listClosings } from '../../../server/domain/closings.js';
import { closingCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/closings — every closing, from the shared index.
 *
 * ONE Firestore read serves this for the whole trust. The old system read all
 * 500 closing documents on every screen that needed them.
 *
 * NOT browser-cached, though it was for a minute. That minute was the reason
 * reverting a closing appeared to do nothing: the revert succeeded, the query
 * was invalidated, the refetch went out — and the browser answered it from its
 * own cache with the pre-revert list. The closing sat there marked चालू for up
 * to sixty seconds, so the only sensible conclusion was that the revert had
 * failed. The same applied to a newly created closing.
 *
 * The cache was buying nothing anyway: the index is already memoised on the
 * server, so a repeat call is zero Firestore reads with or without it.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const includeReverted =
    new URL(request.url).searchParams.get('includeReverted') === 'true';

  const result = await listClosings(scope, { includeReverted });
  return ok(result);
});

/**
 * POST /api/closings — close a member.
 *
 * One transaction, five writes, at any scale. The old Cloud Function wrote one
 * document per member — up to 5,000 writes in un-transactional batches that
 * could fail halfway and leave the trust's books inconsistent.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, closingCreate);

  const closing = await createClosing(scope, input);
  return ok({ closing }, { status: 201 });
});
