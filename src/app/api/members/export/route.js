import React from 'react';

import { handler, readQuery } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { listMembersForExport } from '../../../../server/domain/members.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { toCsv } from '../../../../server/domain/exportMembers.js';
import { memberExportQuery } from '../../../../config/schemas.js';
import { statusLabelFor } from '../../../../config/labels.js';
import { ROLE } from '../../../../config/constants.js';

/**
 * GET /api/members/export?format=csv|pdf
 *
 * The WHOLE filtered set, not the page on screen. An export of "page 1 of 47"
 * is not an export, and it costs the same either way — the rows are already in
 * memory in the search index.
 *
 * Same filter parameters as the list, so whatever is on screen is what comes
 * out of the file. That matters more than it sounds: an export that quietly
 * ignores the filters produces a file someone then reconciles by hand.
 */
export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const params = readQuery(request, memberExportQuery);

  const filters =
    scope.role === ROLE.AGENT ? { ...params, agentId: [scope.agentId] } : params;

  const { members, total, truncated, totals } = await listMembersForExport(scope, filters);
  const stamp = fileStamp();

  if (params.format === 'csv') {
    return new Response(toCsv(members), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="members-${stamp}.csv"`,
        'X-Total-Rows': String(total),
        'X-Truncated': String(truncated),
        'Cache-Control': 'no-store',
      },
    });
  }

  // The PDF path is imported lazily. @react-pdf pulls in font parsing and a
  // layout engine; loading that on every members request — 99% of which are
  // the list, not an export — would slow down the common case to speed up the
  // rare one.
  const [{ renderPdf }, { MemberListPdf }] = await Promise.all([
    import('../../../../server/pdf/renderer.js'),
    import('../../../../server/pdf/MemberListPdf.js'),
  ]);

  const trust = await getTrust(scope);

  const buffer = await renderPdf(
    React.createElement(MemberListPdf, {
      trust,
      members,
      totals,
      filters: describe(filters),
      generatedAt: new Date().toLocaleString('hi-IN', {
        dateStyle: 'long',
        timeStyle: 'short',
      }),
    }),
  );

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="members-${stamp}.pdf"`,
      'X-Total-Rows': String(total),
      'Cache-Control': 'no-store',
    },
  });
});

/** `2026-09-08_1432` — sorts correctly in a folder and needs no explanation. */
function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Say on the document which filters produced it.
 *
 * A printed list that does not state what it was filtered by is a list nobody
 * can check three months later — and someone always tries.
 */
function describe(f) {
  const out = [];
  const many = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);

  if (f.q) out.push(`खोज "${f.q}"`);
  if (f.status?.length) {
    out.push(`स्थिति: ${many(f.status).map(statusLabelFor).join(', ')}`);
  }
  if (f.gender?.length) out.push(`लिंग: ${many(f.gender).join(', ')}`);
  if (f.ageBand?.length) out.push(`आयु समूह: ${many(f.ageBand).join(', ')}`);
  if (f.village?.length) out.push(`गाँव: ${many(f.village).join(', ')}`);
  if (f.district?.length) out.push(`ज़िला: ${many(f.district).join(', ')}`);
  if (f.ageMin != null || f.ageMax != null) {
    out.push(`उम्र ${f.ageMin ?? 0}–${f.ageMax ?? '∞'}`);
  }
  if (f.joinFrom || f.joinTo) {
    out.push(`जुड़ने की तिथि ${d(f.joinFrom)} – ${d(f.joinTo)}`);
  }
  if (f.hasDue === true) out.push('सिर्फ़ बकायादार');
  if (f.hasDue === false) out.push('कोई बकाया नहीं');
  if (f.feeDone === false) out.push('जॉइनिंग फीस बाकी');
  if (f.allPrograms) out.push('सभी योजनाएँ');

  return out;
}

function d(ms) {
  return ms ? new Date(Number(ms)).toLocaleDateString('hi-IN') : '…';
}
