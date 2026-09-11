import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { getTrust, updateTrust } from '../../../server/domain/trust.js';
import { trustUpdate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/trust — the one trust this deployment serves.
 *
 * Readable by anyone signed in, because the branding on it is what every
 * receipt, list and certificate is headed with.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const trust = await getTrust(scope);
  return ok({ trust });
});

/** PATCH /api/trust — edit the trust's details and branding. */
export const PATCH = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const patch = await readBody(request, trustUpdate);
  const trust = await updateTrust(scope, patch);
  return ok({ trust });
});
