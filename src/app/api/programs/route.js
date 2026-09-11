import { handler, ok, readBody } from '../../../server/http.js';
import { requireScope } from '../../../server/auth/session.js';
import { listPrograms, createProgram } from '../../../server/domain/programs.js';
import { programCreate } from '../../../config/schemas.js';
import { ROLE } from '../../../config/constants.js';

/**
 * GET /api/programs — every योजना, with its age bands, location groups and
 * headline numbers.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const result = await listPrograms(scope);
  return ok(result);
});

/**
 * POST /api/programs — create a योजना.
 *
 * A program is both a self-contained book (its own members, closings,
 * receipts, counters and indexes — all created here in one batch) and the
 * rulebook that decides what members pay, through its age bands.
 *
 * Overlapping or inverted age bands are rejected by the schema, because a gap
 * would make some ages unaddable and an overlap would make a member's rate
 * ambiguous.
 */
export const POST = handler(async (request) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const input = await readBody(request, programCreate);
  const program = await createProgram(scope, input);
  return ok({ program }, { status: 201 });
});
