import { handler, okCached } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { getAllMasters } from '../../../server/domain/masters.js';
import { ROLE, MASTER_TYPES } from '../../../config/constants.js';

/**
 * GET /api/masters — every reference list, in one response.
 *
 * Readable by anyone signed in: these are the dropdowns on the forms, not
 * privileged data. Editing them is admin-only (see the [type] route).
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { masters } = await getAllMasters(scope.trustId);

  return okCached({ masters, types: MASTER_TYPES }, 300);
});
