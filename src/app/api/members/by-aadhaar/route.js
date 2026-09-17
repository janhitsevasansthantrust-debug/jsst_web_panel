import { handler, ok } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { findMemberByAadhaar } from '../../../../server/domain/members.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/by-aadhaar?aadhaar=…&except=<memberId>
 *
 * Is this आधार already on somebody in THIS योजना?
 *
 * Scoped to the program, unlike `by-phone` above it: the same person joining a
 * second योजना is normal and their details should be copied, but joining the
 * same one twice is the mistake this exists to catch.
 *
 * The server refuses the duplicate on save regardless — this endpoint only
 * moves the discovery to the moment the operator finishes typing the number,
 * rather than after they have filled in the rest of the form.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.OPERATOR);
  const url = new URL(request.url);

  const member = await findMemberByAadhaar(
    scope,
    url.searchParams.get('aadhaar') ?? '',
    { exceptId: url.searchParams.get('except') || null },
  );

  return ok({ member });
});
