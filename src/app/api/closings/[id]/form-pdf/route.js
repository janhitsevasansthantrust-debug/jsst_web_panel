import React from 'react';

import { handler, notFound } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getMember } from '../../../../../server/domain/members.js';
import { getProgram } from '../../../../../server/domain/programs.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { db } from '../../../../../server/firebase/admin.js';
import { paths, ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/closings/[id]/form-pdf — the सदस्यता समापन पत्र.
 *
 * The sheet the family signs when the trust hands the money over. Every other
 * document here records money coming IN; this is the one that records it going
 * out, which is why it carries three signatures rather than one.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const snap = await db
    .doc(paths.closing(scope.trustId, scope.programId, id))
    .get();

  if (!snap.exists) throw notFound('क्लोजिंग नहीं मिली');
  const closing = { id: snap.id, ...snap.data() };

  const [member, trust, program] = await Promise.all([
    // The closing carries a copy of the member's details as they were when it
    // was made; the live record fills in the fields it does not copy (गोत्र,
    // वारिसदार, आधार). A member since deleted must not stop the sheet
    // printing — it is a record of something that already happened.
    getMember(scope, closing.memberId).catch(() => null),
    getTrust(scope),
    getProgram(scope, scope.programId).catch(() => null),
  ]);

  const [{ renderPdf }, { ClosingCertificatePdf }] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    import('../../../../../server/pdf/ClosingCertificatePdf.js'),
  ]);

  const buffer = await renderPdf(
    React.createElement(ClosingCertificatePdf, { trust, program, closing, member }),
  );

  const name = `${closing.registrationNumber || closing.id}-samapan-patra`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
