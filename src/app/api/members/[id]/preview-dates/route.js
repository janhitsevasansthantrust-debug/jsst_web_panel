import { handler, ok, readBody } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { previewMemberDates } from '../../../../../server/domain/members.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * POST /api/members/[id]/preview-dates
 *   { joinDateMs?, bobDateMs?, locationGroupId? }
 *
 * What the member would owe with these dates — which closings become payable,
 * which stop, and any paid closing that would block the change. Nothing is
 * saved; PATCH /api/members/[id] does the same computation for real.
 */
export const POST = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const { id } = await context.params;
  const body = (await readBody(request)) ?? {};
  return ok(await previewMemberDates(scope, id, {
    joinDateMs: body.joinDateMs,
    bobDateMs: body.bobDateMs,
    locationGroupId: body.locationGroupId,
  }));
});
