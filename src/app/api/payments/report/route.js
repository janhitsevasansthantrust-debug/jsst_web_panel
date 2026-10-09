import React from 'react';

import {
  handler,
  ok,
  readQuery,
  forbidden,
} from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { paymentReportQuery } from '../../../../config/schemas.js';
import { db } from '../../../../server/firebase/admin.js';
import { paths, ROLE } from '../../../../config/constants.js';
import { scanPayments, MAX_PDF_ROWS } from '../../../../server/domain/paymentQuery.js';
import { summarisePayments, describePaymentFilters } from '../../../../lib/paymentReport.js';
import { toCsv } from '../../../../server/domain/exportPayments.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { getProgram } from '../../../../server/domain/programs.js';

/**
 * GET /api/payments/report?format=json|csv|pdf
 *
 * The receipt register, as a whole rather than as a page.
 *
 * Three answers from one scan, because that is the only way they can agree: the
 * totals on screen, the file that gets downloaded and the sheet that gets filed
 * are all produced from the same array of receipts in this request. Totals
 * computed from whatever happens to be loaded in the browser would change as
 * the operator scrolls, and a collection figure that moves is not a figure.
 *
 * Cost is one read per receipt in the filtered set, not per receipt in the
 * trust — the date range and the agent are pushed into the query, so a week
 * costs a week. It is bounded by a read guard in `paymentQuery.js` that
 * refuses rather than returning part of an answer.
 *
 * Same filters as `GET /api/payments`, through the same schema and the same
 * predicate, so whatever is on screen is what comes out of the file. That
 * matters more than it sounds: an export that quietly ignores the filters
 * produces a file someone then reconciles by hand.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  if (scope.role === ROLE.AGENT && !scope.agentId) throw forbidden();

  const { format, ...parsed } = readQuery(request, paymentReportQuery);

  const filters = {
    ...parsed,
    // An agent sees only what they collected — the same wall the list has.
    agentId: scope.role === ROLE.AGENT ? scope.agentId : parsed.agentId,
  };
  if (filters.agentId) filters.agentName = await agentName(scope, filters.agentId);

  const { rows } = await scanPayments(scope, filters);
  const totals = summarisePayments(rows);
  const stamp = fileStamp();

  if (format === 'csv') {
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="receipts-${stamp}.csv"`,
        'X-Total-Rows': String(rows.length),
        'Cache-Control': 'no-store',
      },
    });
  }

  if (format === 'pdf') {
    // The PDF is imported lazily. @react-pdf pulls in font parsing and a
    // layout engine; loading that on every report call — 99% of which are the
    // totals, not a download — would slow the common case to speed the rare
    // one.
    const [{ renderPdf }, { ReceiptRegisterPdf }] = await Promise.all([
      import('../../../../server/pdf/renderer.js'),
      import('../../../../server/pdf/ReceiptRegisterPdf.js'),
    ]);

    const [trust, program] = await Promise.all([
      getTrust(scope),
      getProgram(scope, scope.programId).catch(() => null),
    ]);

    const buffer = await renderPdf(
      React.createElement(ReceiptRegisterPdf, {
        trust,
        program,
        rows: rows.slice(0, MAX_PDF_ROWS),
        truncated: rows.length > MAX_PDF_ROWS,
        filters: describePaymentFilters(filters),
        totals,
        generatedAt: Date.now(),
      }),
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="receipt-register-${stamp}.pdf"`,
        'X-Total-Rows': String(rows.length),
        'X-Truncated': String(rows.length > MAX_PDF_ROWS),
        'Cache-Control': 'no-store',
      },
    });
  }

  // The three answers share one `Cache-Control`. A collection figure that an
  // intermediary serves from a thirty-second-old cache is still the wrong
  // figure at a meeting.
  return ok(
    { totals, count: rows.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/**
 * The agent's name, for the line on the printed sheet that says whose
 * register this is.
 *
 * An id on a printed document is a thing nobody can check; a name is. Read
 * best-effort — a missing agent must not stop a report from printing.
 */
async function agentName(scope, agentId) {
  try {
    const snap = await db.doc(paths.agent(scope.trustId, agentId)).get();
    return snap.exists ? snap.data()?.displayName ?? '' : '';
  } catch {
    return '';
  }
}

/** `2026-09-08_1432` — sorts correctly in a folder and needs no explanation. */
function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
