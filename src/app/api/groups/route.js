import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { listGroups, createGroup } from '../../../server/domain/agents.js';
import { groupCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * Groups (यूनिट) — each with its own contribution rate and joining fee.
 *
 * The old system kept a group's members as an ARRAY inside the group document:
 * capped at 1 MB, prone to lost updates when two people edited at once, and
 * with a `memberCount` that drifted out of sync. Membership lives on the
 * member document here, and the count is a counter.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const result = await listGroups(scope);
  return ok(result);
});

export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, groupCreate);
  const group = await createGroup(scope, input);
  return ok({ group }, { status: 201 });
});
