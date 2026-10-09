import { handler } from '../../../../../../server/http.js';
import { requireScope } from '../../../../../../server/auth/session.js';
import { getAgentMember } from '../../../../../../server/domain/agentApp.js';
import { getTrust } from '../../../../../../server/domain/trust.js';
import { memberStatementPdf } from '../../../../../../server/pdf/memberStatement.js';
import { ROLE } from '../../../../../../config/constants.js';

/**
 * GET /api/agent/members/[id]/pdf?mode=all|pending|paid|late — the closing-by-
 * closing statement for one of the agent's members. (The certificate is the
 * existing /api/members/[id]/document route, which is already agent-scoped.)
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const [detail, trust] = await Promise.all([getAgentMember(scope, id), getTrust(scope)]);
  return memberStatementPdf({ trust, detail, mode: new URL(request.url).searchParams.get('mode') });
});
