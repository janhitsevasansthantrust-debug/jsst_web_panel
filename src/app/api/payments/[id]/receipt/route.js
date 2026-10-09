import React from 'react';

import { handler, notFound } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { db } from '../../../../../server/firebase/admin.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { ROLE, paths } from '../../../../../config/constants.js';

/**
 * GET /api/payments/[id]/receipt — the printed रसीद.
 *
 * Rendered from the receipt DOCUMENT, not recomputed from the ledger. A
 * receipt is a record of what happened at a moment: reprinting it must show
 * what was handed over then, even if the member has paid four more closings
 * since, and even if a rate has changed. The stored document already holds the
 * member snapshot for exactly this reason.
 */
export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const snap = await db
    .doc(paths.payment(scope.trustId, scope.programId, id))
    .get();

  if (!snap.exists) throw notFound('रसीद नहीं मिली');

  const receipt = { id: snap.id, ...snap.data() };

  const [trust, memberSnap] = await Promise.all([
    getTrust(scope),
    db.doc(paths.member(scope.trustId, receipt.memberId)).get(),
  ]);

  // An agent may reprint what they collected, and any receipt of their own
  // members — the agent app shows a member's whole payment history, including
  // what was paid at the office.
  if (
    scope.role === ROLE.AGENT &&
    receipt.collectedByAgentId !== scope.agentId &&
    memberSnap.data()?.agentId !== scope.agentId
  ) {
    throw notFound('रसीद नहीं मिली');
  }

  const [{ renderPdf }, { ReceiptPdf }] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    import('../../../../../server/pdf/ReceiptPdf.js'),
  ]);

  const buffer = await renderPdf(
    React.createElement(ReceiptPdf, {
      trust,
      receipt,
      member: memberSnap.exists ? memberSnap.data() : null,
    }),
  );

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` rather than `attachment`: a receipt is printed far more often
      // than it is filed, and a browser's print dialog is one keystroke from
      // an inline PDF.
      'Content-Disposition': `inline; filename="${receipt.receiptNo}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
