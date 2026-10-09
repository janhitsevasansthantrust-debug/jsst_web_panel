import React from 'react';
import { handler, badRequest } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { collectionReport } from '../../../../server/domain/collectionReport.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { getProgram } from '../../../../server/domain/programs.js';
import { groupBillsByAgent, summariseBills } from '../../../../lib/batchBilling.js';
import { ROLE } from '../../../../config/constants.js';

export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const filters = Object.fromEntries(new URL(request.url).searchParams);
  const [report, trust, program] = await Promise.all([
    collectionReport(scope, filters), getTrust(scope), getProgram(scope, scope.programId),
  ]);
  const bills = report.rows.filter((r) => r.dueAmount > 0).map((r) => ({
    member: { id: r.id, name: r.displayName, regNo: r.registrationNumber,
      fatherName: r.fatherName, village: r.village, district: r.district,
      phone: r.phone, agentId: r.agentId, agentName: r.agentName, totalDue: r.dueAmount },
    rate: r.payAmount,
    closings: r.items.filter((i) => i.remaining > 0),
    count: r.dueCount, total: r.dueAmount,
  }));
  if (!bills.length) throw badRequest('चुनी गई क्लोजिंग में कोई बकाया नहीं है');
  if (filters.doc !== 'summary' && bills.length > 400) {
    throw badRequest('एक बार में अधिकतम 400 वसूली पर्चियाँ — एजेंट या सदस्य चुनें');
  }
  const [{ renderPdf }, { ClosingBatchReceiptsPdf }, { ClosingBatchSummaryPdf }] = await Promise.all([
    import('../../../../server/pdf/renderer.js'),
    import('../../../../server/pdf/ClosingBatchReceiptsPdf.js'),
    import('../../../../server/pdf/ClosingBatchSummaryPdf.js'),
  ]);
  const batch = { name: 'चुनी गई क्लोजिंग — बकाया वसूली', code: 'COLLECTION' };
  const element = filters.doc === 'summary'
    ? React.createElement(ClosingBatchSummaryPdf, { trust, program, batch,
      groups: groupBillsByAgent(bills), totals: summariseBills(bills), generatedAt: Date.now() })
    : React.createElement(ClosingBatchReceiptsPdf, { trust, program, batch, bills });
  return new Response(await renderPdf(element), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="closing-collection.pdf"',
    'Cache-Control': 'no-store',
  } });
});
