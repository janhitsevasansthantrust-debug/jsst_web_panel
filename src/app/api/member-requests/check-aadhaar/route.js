import { handler, ok, badRequest } from '../../../../server/http.js';
import { requireRole } from '../../../../server/auth/session.js';
import { aadhaarClash } from '../../../../server/domain/memberRequests.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/member-requests/check-aadhaar?aadhaar=…&forProgram=…&except=<requestId>
 *
 * The app's new-member form asks this as soon as 12 digits are typed, so a
 * duplicate आधार in the same योजना is caught before the rest of the form is
 * filled. The request is refused on submit anyway — this only moves the
 * discovery earlier.
 */
export const GET = handler(async (request) => {
  const session = await requireRole(ROLE.AGENT);
  const url = new URL(request.url);
  const programId = url.searchParams.get('forProgram') || session.programId;
  if (!programId) throw badRequest('योजना चुनें');
  const clash = await aadhaarClash(session, programId, url.searchParams.get('aadhaar') ?? '', {
    exceptRequestId: url.searchParams.get('except') || undefined,
  });
  return ok({ duplicate: Boolean(clash), message: clash?.message ?? '' });
});
