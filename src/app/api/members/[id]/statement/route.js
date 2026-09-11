import React from 'react';

import { handler, forbidden } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getMember } from '../../../../../server/domain/members.js';
import { getMemberLedger } from '../../../../../server/domain/payments.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/members/[id]/statement?mode=pending|paid
 *
 * One member's position as a printable sheet — the document the old system
 * called the pending-payment PDF.
 *
 * The due list is DERIVED at print time rather than read from a stored
 * snapshot, because that is the whole point of this document: it is handed to
 * someone who is about to pay, and it has to be right now, not right last
 * Tuesday.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const mode = new URL(request.url).searchParams.get('mode') === 'paid' ? 'paid' : 'pending';

  const [member, ledger, trust] = await Promise.all([
    getMember(scope, id),
    getMemberLedger(scope, id, { receiptLimit: 200 }),
    getTrust(scope),
  ]);

  if (scope.role === ROLE.AGENT && member.agentId !== scope.agentId) {
    throw forbidden('यह सदस्य आपकी सूची में नहीं है');
  }

  const [{ renderPdf }, { MemberStatementPdf }] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    import('../../../../../server/pdf/MemberStatementPdf.js'),
  ]);

  const buffer = await renderPdf(
    React.createElement(MemberStatementPdf, { trust, member, ledger, mode }),
  );

  const name = `${member.registrationNumber || member.id}-${mode}`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
