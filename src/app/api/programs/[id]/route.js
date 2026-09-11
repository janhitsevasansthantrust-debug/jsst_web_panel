import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getProgram, updateProgram, deleteProgram, getProgramRules } from '../../../../server/domain/programs.js';
import { programUpdate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/programs/[id]
 *
 * `?rules=true` returns just the age bands and location groups — what the
 * member form needs to show a live rate as the operator types a date of birth.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id: raw } = await context.params;

  // `current` means "whatever program this session is working in", so the
  // member form does not have to know a program id to ask for its rate card.
  const id = raw === 'current' ? scope.programId : raw;

  if (new URL(request.url).searchParams.get('rules') === 'true') {
    return ok({ rules: await getProgramRules(scope, id) });
  }

  const program = await getProgram(scope, id);
  return ok({ program });
});

/**
 * PATCH /api/programs/[id]
 *
 * Editing age bands re-prices OUTSTANDING dues for members in those bands the
 * next time their record is written. Money already collected is never
 * re-priced — that comes from receipts, which are immutable.
 */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const input = await readBody(request, programUpdate);

  const program = await updateProgram(scope, id, input);
  return ok({ program });
});

/** DELETE /api/programs/[id] — delete a program (refuses if active or has data). */
export const DELETE = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const result = await deleteProgram(scope, id);
  return ok(result);
});
