import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { searchClosableMembers } from '../../../../server/domain/agents.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/closings/closable?q=…
 *
 * Members who can still be closed — accepted, not deleted, not already closed.
 * Feeds the picker on the closing form so an operator cannot accidentally
 * close someone twice or close a pending member.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const result = await searchClosableMembers(scope, q);
  return ok(result);
});
