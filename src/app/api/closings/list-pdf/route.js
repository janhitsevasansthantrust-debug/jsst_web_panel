import React from 'react';

import { handler, badRequest } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getClosingsIndex } from '../../../../server/domain/indexes.js';
import { getProgram } from '../../../../server/domain/programs.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { db, getAllDocs } from '../../../../server/firebase/admin.js';
import {
  filterClosingsByDate,
  summariseClosings,
  withPending,
} from '../../../../lib/closingReport.js';
import { paths, ROLE } from '../../../../config/constants.js';

/**
 * GET /api/closings/list-pdf?fromMs=…&toMs=…
 *
 * The क्लोजिंग सूची for a period — the office's register page.
 *
 * Cost: one cached index read to find WHICH closings fall in the range, then
 * one read per closing to pick up the money on it (`eligibleAmount`,
 * `paidAmount`) — figures the index deliberately does not carry, because they
 * change on every receipt and the index is read on every page load.
 *
 * That makes this report proportional to the closings in the period, which for
 * a month is tens. Printing a decade would be thousands, so it is capped and
 * says so rather than quietly truncating.
 */

const MAX_ROWS = 500;

export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);

  const range = {
    fromMs: numberOrNull(url.searchParams.get('fromMs')),
    toMs: numberOrNull(url.searchParams.get('toMs')),
  };

  if (range.fromMs && range.toMs && range.fromMs > range.toMs) {
    throw badRequest('शुरू की तारीख़ अंतिम तारीख़ के बाद नहीं हो सकती');
  }

  const { items } = await getClosingsIndex(scope.trustId, scope.programId);
  const inRange = filterClosingsByDate(items, range);

  if (inRange.length > MAX_ROWS) {
    throw badRequest(
      `इस अवधि में ${inRange.length} क्लोजिंग हैं — एक सूची में ${MAX_ROWS} तक ही छप सकती हैं। छोटी अवधि चुनें।`,
    );
  }

  // The money lives on the closing documents, not in the index.
  const docs = await getAllDocs(
    inRange.map((c) => db.doc(paths.closing(scope.trustId, scope.programId, c.id))),
  );

  const merged = inRange.map((c, i) => {
    const full = docs[i]?.exists ? docs[i].data() : {};
    return {
      ...c,
      eligibleCount: full.eligibleCount ?? null,
      eligibleAmount: full.eligibleAmount ?? 0,
      paidCount: full.paidCount ?? 0,
      paidAmount: full.paidAmount ?? 0,
    };
  });

  const [trust, program] = await Promise.all([
    getTrust(scope),
    getProgram(scope, scope.programId).catch(() => null),
  ]);

  const [{ renderPdf }, { ClosingListPdf }] = await Promise.all([
    import('../../../../server/pdf/renderer.js'),
    import('../../../../server/pdf/ClosingListPdf.js'),
  ]);

  const buffer = await renderPdf(
    React.createElement(ClosingListPdf, {
      trust,
      program,
      rows: withPending(merged),
      totals: summariseClosings(merged),
      range,
      generatedAt: Date.now(),
    }),
  );

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="closing-list.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
