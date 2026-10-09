import React from 'react';

import { handler, notFound, badRequest } from '../../../../../server/http.js';
import { requireSession } from '../../../../../server/auth/session.js';
import { assertLinked } from '../../../../../server/domain/memberPortal.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { db } from '../../../../../server/firebase/admin.js';
import { pdfResponse } from '../../../../../server/pdf/respond.js';
import { paths } from '../../../../../config/constants.js';

/**
 * GET /api/portal/receipts/[id]?memberId=… — reprint one of the family's रसीद.
 *
 * The receipt lives in its member's योजना, so the member id says where to
 * look — and is checked against the signed-in family first.
 */
export const GET = handler(async (request, context) => {
  const session = await requireSession();
  const { id } = await context.params;
  const memberId = new URL(request.url).searchParams.get('memberId');
  if (!memberId) throw badRequest('memberId ज़रूरी है');

  const { list } = await assertLinked(session, memberId);
  const member = list.find((m) => m.id === memberId);

  const snap = await db.doc(paths.payment(session.trustId, member.programId, id)).get();
  if (!snap.exists || snap.data().memberId !== memberId) throw notFound('रसीद नहीं मिली');
  const receipt = { id: snap.id, ...snap.data() };

  const [trust, memberSnap, { renderPdf }, { ReceiptPdf }] = await Promise.all([
    getTrust(session),
    db.doc(paths.member(session.trustId, memberId)).get(),
    import('../../../../../server/pdf/renderer.js'),
    import('../../../../../server/pdf/ReceiptPdf.js'),
  ]);
  const buffer = await renderPdf(React.createElement(ReceiptPdf, {
    trust, receipt, member: memberSnap.exists ? memberSnap.data() : null,
  }));
  return pdfResponse(buffer, `${receipt.receiptNo || id}.pdf`);
});
