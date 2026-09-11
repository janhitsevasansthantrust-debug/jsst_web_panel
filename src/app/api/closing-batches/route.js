import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { listBatches, createBatch } from '../../../server/domain/closingBatches.js';
import { closingBatchCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/closing-batches — the क्लोजिंग समूह list.
 *
 * Readable by an agent: they need to know which notice is current when a
 * member asks what this month's sheet says.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const includeClosed =
    new URL(request.url).searchParams.get('includeClosed') !== 'false';

  return ok(await listBatches(scope, { includeClosed }));
});

/** POST /api/closing-batches — start a new notice. */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, closingBatchCreate);
  return ok({ batch: await createBatch(scope, input) });
});
