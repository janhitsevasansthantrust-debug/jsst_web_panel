import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import {
  assignableClosings,
  setClosingBatch,
} from '../../../../../server/domain/closingBatches.js';
import { batchClosingsPatch } from '../../../../../config/schemas.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET  /api/closing-batches/[id]/closings — what can still be added
 * POST /api/closing-batches/[id]/closings — add them, or take them off
 *
 * The batch used to be choosable only while creating a closing, which stranded
 * the ordinary case: the month's closings get entered as they happen, and the
 * समूह for that month is made afterwards. Everything already entered then sat
 * on no notice at all.
 */

export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  return ok(await assignableClosings(scope, { batchId: id }));
});

export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const input = await readBody(request, batchClosingsPatch);

  /**
   * `remove` sends them to no batch at all rather than to this one.
   *
   * A closing off every notice is a perfectly valid state — it is simply not
   * being billed on paper yet — so this needs no special "unassigned" batch.
   */
  const result = await setClosingBatch(
    scope,
    input.remove ? null : id,
    input.closingIds,
  );

  return ok(result);
});
