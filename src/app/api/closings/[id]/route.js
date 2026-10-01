import { handler, ok, readBody } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { updateClosing } from '../../../../server/domain/closings.js';
import { closingUpdate } from '../../../../config/schemas.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * PATCH /api/closings/[id] — correct a closing after the fact.
 *
 * The system could create a closing and revert one, and nothing in between. A
 * date typed as 08 instead of 03, or an invitation card scanned upside down,
 * meant reverting the whole case — unwinding every payment made against it —
 * and closing the member again.
 */
export const PATCH = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.ADMIN);
  const { id } = await context.params;
  const input = await readBody(request, closingUpdate);

  const closing = await updateClosing(scope, id, input);
  return ok({ closing });
});
