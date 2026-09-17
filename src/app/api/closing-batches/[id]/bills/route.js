import React from 'react';

import { handler, badRequest } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getBatchSheet } from '../../../../../server/domain/closingBatches.js';
import { getMembersIndex } from '../../../../../server/domain/indexes.js';
import { getProgram } from '../../../../../server/domain/programs.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import {
  billBatch,
  groupBillsByAgent,
  summariseBills,
} from '../../../../../lib/batchBilling.js';
import { ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/closing-batches/[id]/bills?doc=receipts|summary&agentId=…
 *
 * The two documents a batch is collected with:
 *
 *   receipts — one सहयोग राशि रसीद per member, listing the closings THAT
 *              member owes and what they add up to
 *   summary  — the agent-wise sheet that goes on top of the stack
 *
 * One route because they are one calculation. Two routes would be two places
 * for the eligibility rule to live, and the day they disagreed the stack would
 * not add up to the sheet on top of it.
 *
 * Cost: the batch (one cached index read) plus the member index (cached, ~10
 * reads cold for 5,000 members). No per-member reads at all.
 */

/**
 * Receipts are one PAGE each, so the whole trust in one file is a book.
 * An agent's round is tens of pages; the office printing everybody is
 * hundreds. Past this it is a printer jam and a lost afternoon, so it is
 * refused with a way out rather than attempted.
 */
const MAX_RECEIPT_PAGES = 400;

export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;
  const url = new URL(request.url);

  const doc = url.searchParams.get('doc') === 'summary' ? 'summary' : 'receipts';

  /**
   * An agent may only ever print their own round. Not a filter for them — a
   * boundary: the sheet carries every member's phone number and what they owe.
   */
  const agentId =
    scope.role === ROLE.AGENT
      ? scope.agentId
      : (url.searchParams.get('agentId') || null);

  const [sheet, index, trust, program] = await Promise.all([
    getBatchSheet(scope, id),
    getMembersIndex(scope.trustId),
    getTrust(scope),
    getProgram(scope, scope.programId).catch(() => null),
  ]);

  if (!sheet.rows.length) {
    throw badRequest('इस समूह में कोई क्लोजिंग नहीं है — पहले क्लोजिंग जोड़ें');
  }

  const bills = billBatch(index.items, sheet.rows, {
    programId: scope.programId,
    agentId,
  });

  if (!bills.length) {
    throw badRequest(
      agentId
        ? 'इस एजेंट का कोई सदस्य इस समूह के लिए पात्र नहीं है'
        : 'इस समूह के लिए कोई पात्र सदस्य नहीं मिला',
    );
  }

  const [{ renderPdf }, mod] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    doc === 'summary'
      ? import('../../../../../server/pdf/ClosingBatchSummaryPdf.js')
      : import('../../../../../server/pdf/ClosingBatchReceiptsPdf.js'),
  ]);

  let element;

  if (doc === 'summary') {
    element = React.createElement(mod.ClosingBatchSummaryPdf, {
      trust,
      program,
      batch: sheet.batch,
      groups: groupBillsByAgent(bills),
      totals: summariseBills(bills),
      generatedAt: Date.now(),
    });
  } else {
    if (bills.length > MAX_RECEIPT_PAGES) {
      throw badRequest(
        `${bills.length} रसीदें एक साथ नहीं छप सकतीं (अधिकतम ${MAX_RECEIPT_PAGES})। ` +
        'एजेंट चुनकर छापें।',
      );
    }

    element = React.createElement(mod.ClosingBatchReceiptsPdf, {
      trust,
      program,
      batch: sheet.batch,
      bills,
      // The receipt serial continues across the run, so a stack of four
      // hundred can be checked against the summary without opening each one.
      startSerial: 1,
    });
  }

  const buffer = await renderPdf(element);
  const name = `${sheet.batch.code || 'batch'}-${doc}`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
