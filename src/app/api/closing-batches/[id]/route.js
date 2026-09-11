import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import {
  getBatchSheet,
  updateBatch,
  issueBatch,
} from '../../../../server/domain/closingBatches.js';
import { closingBatchUpdate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/closing-batches/[id] — one batch with its closings and totals.
 *
 * The same payload the notice is printed from, so what the screen shows and
 * what comes out of the printer cannot disagree.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  return ok(await getBatchSheet(scope, id));
});

/**
 * PATCH /api/closing-batches/[id]
 *
 * `status: 'issued'` goes through `issueBatch` rather than a plain field
 * update: issuing is the moment the batch stops accepting closings, and it
 * freezes the count and the per-member total that were printed. A bare
 * `update` would set the flag and leave those two figures stale.
 */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const input = await readBody(request, closingBatchUpdate);

  if (input.status === 'issued') {
    return ok({ batch: await issueBatch(scope, id) });
  }

  return ok({ batch: await updateBatch(scope, id, input) });
});
