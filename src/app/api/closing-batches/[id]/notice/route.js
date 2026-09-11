import React from 'react';

import { handler, badRequest } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getBatchSheet } from '../../../../../server/domain/closingBatches.js';
import { getProgram } from '../../../../../server/domain/programs.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/closing-batches/[id]/notice
 *
 * The month's क्लोजिंग सूचना पत्र as a PDF — the sheet that goes to every
 * member listing the closings they are being billed for.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const [sheet, trust, program] = await Promise.all([
    getBatchSheet(scope, id),
    getTrust(scope),
    getProgram(scope, scope.programId).catch(() => null),
  ]);

  // An empty notice is not a document, it is a sheet of letterhead — and one
  // that says "pay ₹0 for 0 closings" is worse, because somebody will file it.
  if (!sheet.rows.length) {
    throw badRequest('इस समूह में कोई क्लोजिंग नहीं है — पहले क्लोजिंग जोड़ें');
  }

  const [{ renderPdf }, { ClosingNoticePdf }] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    import('../../../../../server/pdf/ClosingNoticePdf.js'),
  ]);

  const buffer = await renderPdf(
    React.createElement(ClosingNoticePdf, {
      trust,
      program,
      batch: sheet.batch,
      rows: sheet.rows,
      perMemberAmount: sheet.perMemberAmount,
    }),
  );

  const name = `${sheet.batch.code || 'closing'}-suchna`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
