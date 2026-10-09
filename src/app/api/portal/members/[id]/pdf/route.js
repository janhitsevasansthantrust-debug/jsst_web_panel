import React from 'react';

import { handler, badRequest } from '../../../../../../server/http.js';
import { requireSession } from '../../../../../../server/auth/session.js';
import { getPortalMember } from '../../../../../../server/domain/memberPortal.js';
import { getMember } from '../../../../../../server/domain/members.js';
import { getProgram } from '../../../../../../server/domain/programs.js';
import { getTrust } from '../../../../../../server/domain/trust.js';
import { memberStatementPdf } from '../../../../../../server/pdf/memberStatement.js';
import { pdfResponse } from '../../../../../../server/pdf/respond.js';

/**
 * GET /api/portal/members/[id]/pdf?doc=certificate | statement&mode=all|pending|paid|late
 *
 * The member app's downloads: the सदस्यता प्रमाण पत्र, and the account
 * statement — the same closing-by-closing list the app shows, on paper.
 */
export const GET = handler(async (request, context) => {
  const session = await requireSession();
  const { id } = await context.params;
  const url = new URL(request.url);
  const doc = url.searchParams.get('doc') || 'statement';

  // Linked-member check happens here, before anything is rendered.
  const detail = await getPortalMember(session, id);
  const scope = { ...session, programId: detail.member.programId };
  const trust = await getTrust(scope);

  if (doc === 'statement') {
    return memberStatementPdf({ trust, detail, mode: url.searchParams.get('mode') });
  }
  if (doc !== 'certificate') throw badRequest('अज्ञात दस्तावेज़');

  const member = await getMember(scope, id);
  const program = await getProgram(scope, member.programId).catch(() => null);
  const [{ renderPdf }, { MemberCertificatePdf }] = await Promise.all([
    import('../../../../../../server/pdf/renderer.js'),
    import('../../../../../../server/pdf/MemberCertificatePdf.js'),
  ]);
  const buffer = await renderPdf(React.createElement(MemberCertificatePdf, {
    trust, program, member: { ...member, agentPhone: detail.member.agentPhone },
  }));
  return pdfResponse(buffer, `${member.registrationNumber || id}-praman-patra.pdf`);
});
