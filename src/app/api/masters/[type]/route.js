import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getMaster, saveMaster } from '../../../../server/domain/masters.js';
import { masterSave } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/** GET /api/masters/[type] — one list. */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { type } = await context.params;
  return ok(await getMaster(scope.trustId, type));
});

/**
 * PUT /api/masters/[type] — replace one list.
 *
 * ADMIN and above. These lists decide what every form offers and what gets
 * stored on member records, so editing them is a structural change, not a
 * day-to-day one.
 */
export const PUT = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { type } = await context.params;
  const { items } = await readBody(request, masterSave);

  return ok(await saveMaster(scope, type, items));
});
