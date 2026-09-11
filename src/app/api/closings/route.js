import { handler, ok, okCached, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { createClosing, listClosings } from '../../../server/domain/closings.js';
import { closingCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/closings — every closing, from the shared index.
 *
 * ONE Firestore read serves this for the whole trust, and the response is
 * cached in the browser for a minute on top of that. The old system read all
 * 500 closing documents on every screen that needed them.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const includeReverted =
    new URL(request.url).searchParams.get('includeReverted') === 'true';

  const result = await listClosings(scope, { includeReverted });
  return okCached(result, 60);
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
