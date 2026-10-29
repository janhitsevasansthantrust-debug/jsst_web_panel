import { handler, ok } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { applyJoinFeeSplitToMembers } from '../../../../../server/domain/programs.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET  /api/programs/[id]/apply-join-fee-split — how many existing members
 *      would get this योजना's किश्त split (a dry run, writes nothing).
 * POST /api/programs/[id]/apply-join-fee-split — apply it.
 *
 * Only `joinFeeAtJoin` is written; no member's fee, payments or dues change.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  return ok(await applyJoinFeeSplitToMembers(scope, id, { dryRun: true }));
});

export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  return ok(await applyJoinFeeSplitToMembers(scope, id));
});
