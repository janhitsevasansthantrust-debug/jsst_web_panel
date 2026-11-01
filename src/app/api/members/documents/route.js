import React from 'react';

import { handler, badRequest } from '../../../../server/http.js';
import { requireScope } from '../../../../server/auth/session.js';
import { getProgram } from '../../../../server/domain/programs.js';
import { getTrust } from '../../../../server/domain/trust.js';
import { db } from '../../../../server/firebase/admin.js';
import { paths, ROLE } from '../../../../config/constants.js';
import { pdfResponse } from '../../../../server/pdf/respond.js';

/**
 * GET /api/members/documents?ids=a,b,c&type=certificate|regform
 *
 * The same sheets as /api/members/[id]/document, for many members at once:
 * one PDF, one page per member, in the order the ids were given.
 *
 * Reads: one `getAll` for the members, one for their agents' phones, the trust
 * and each योजना involved once — not one round trip per member.
 *
 * Members the caller may not print are left out rather than failing the whole
 * batch — another योजना's member when one is chosen in the header, or (for an
 * agent) somebody else's member. How many were left out goes back in
 * `X-Skipped`, so the screen can say so.
 */

const MAX_MEMBERS = 100;

const DOCS = {
  certificate: {
    module: () => import('../../../../server/pdf/MemberCertificatePdf.js'),
    pick: (m) => m.MemberCertificatePdf,
    title: 'सदस्यता प्रमाण पत्र',
    suffix: 'praman-patra',
  },
  regform: {
    module: () => import('../../../../server/pdf/MemberRegFormPdf.js'),
    pick: (m) => m.MemberRegFormPdf,
    title: 'सदस्यता फॉर्म',
    suffix: 'sadasyata-form',
  },
};

export const GET = handler(async (request) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const url = new URL(request.url);

  const type = url.searchParams.get('type') || 'certificate';
  const doc = DOCS[type];
  if (!doc) throw badRequest('अज्ञात दस्तावेज़ प्रकार');

  const ids = [...new Set(
    String(url.searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )];
  if (!ids.length) throw badRequest('कोई सदस्य नहीं चुना');
  if (ids.length > MAX_MEMBERS) {
    throw badRequest(`एक बार में ज़्यादा से ज़्यादा ${MAX_MEMBERS} सदस्य`);
  }

  const snaps = await db.getAll(...ids.map((id) => db.doc(paths.member(scope.trustId, id))));

  const members = snaps
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .filter((m) => !m.delete_flag)
    // Same rules as the single-member route.
    .filter((m) => !scope.programId || !m.programId || m.programId === scope.programId)
    .filter((m) => scope.role !== ROLE.AGENT || m.agentId === scope.agentId);

  if (!members.length) throw badRequest('चुने गए सदस्यों में से कोई भी छापा नहीं जा सकता');

  const programIds = [...new Set(members.map((m) => m.programId).filter(Boolean))];
  const agentIds = [...new Set(members.map((m) => m.agentId).filter(Boolean))];

  const [trust, programs, agentPhones, [{ renderPdf }, mod, { MemberDocumentsPdf }]] = await Promise.all([
    getTrust(scope),
    // A योजना that has since been removed still prints, without its line.
    Promise.all(programIds.map((pid) => getProgram(scope, pid).catch(() => null)))
      .then((list) => new Map(programIds.map((pid, i) => [pid, list[i]]))),
    agentPhonesFor(scope.trustId, agentIds),
    Promise.all([
      import('../../../../server/pdf/renderer.js'),
      doc.module(),
      import('../../../../server/pdf/MemberDocumentsPdf.js'),
    ]),
  ]);

  const items = members.map((m) => ({
    member: { ...m, agentPhone: agentPhones.get(m.agentId) ?? '' },
    program: programs.get(m.programId) ?? null,
  }));

  const buffer = await renderPdf(
    React.createElement(MemberDocumentsPdf, {
      Sheet: doc.pick(mod),
      trust,
      items,
      title: `${doc.title} — ${items.length}`,
    }),
  );

  const response = pdfResponse(buffer, `${doc.suffix}-${items.length}.pdf`);
  response.headers.set('X-Total-Rows', String(items.length));
  response.headers.set('X-Skipped', String(ids.length - items.length));
  return response;
});

/** Agents' phones for the signature line, in one read. */
async function agentPhonesFor(trustId, agentIds) {
  const map = new Map();
  if (!agentIds.length) return map;
  try {
    const snaps = await db.getAll(...agentIds.map((id) => db.doc(paths.agent(trustId, id))));
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, snap.data().phone ?? '');
    }
  } catch {
    // A missing phone is not worth failing a print run over.
  }
  return map;
}
