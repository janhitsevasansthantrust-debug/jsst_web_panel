import React from 'react';

import { handler, forbidden, badRequest } from '../../../../../server/http.js';
import { requireScope } from '../../../../../server/auth/session.js';
import { getMember } from '../../../../../server/domain/members.js';
import { getProgram } from '../../../../../server/domain/programs.js';
import { getTrust } from '../../../../../server/domain/trust.js';
import { db } from '../../../../../server/firebase/admin.js';
import { paths, ROLE } from '../../../../../config/constants.js';

/**
 * GET /api/members/[id]/document?type=certificate|regform
 *
 * The two printed sheets the old system produced for a member: the सदस्यता
 * प्रमाण पत्र that goes home with them, and the सदस्यता फॉर्म that goes into
 * the file.
 *
 * One route rather than two, because everything except the last component is
 * identical — same member, same योजना, same trust branding, same permission
 * rule — and two routes would be two places to forget the agent check.
 */

const DOCS = {
  certificate: {
    module: () => import('../../../../../server/pdf/MemberCertificatePdf.js'),
    pick: (m) => m.MemberCertificatePdf,
    suffix: 'praman-patra',
  },
  regform: {
    module: () => import('../../../../../server/pdf/MemberRegFormPdf.js'),
    pick: (m) => m.MemberRegFormPdf,
    suffix: 'sadasyata-form',
  },
};

export const GET = handler(async (request, context) => {
  const scope = await requireScope(request, ROLE.AGENT);
  const { id } = await context.params;

  const type = new URL(request.url).searchParams.get('type') || 'certificate';
  const doc = DOCS[type];
  if (!doc) throw badRequest('अज्ञात दस्तावेज़ प्रकार');

  const member = await getMember(scope, id);

  // An agent may print for their own members and nobody else's. The same rule
  // as the statement route — stated here rather than inherited, because a
  // certificate carries the member's address and guardian's name.
  if (scope.role === ROLE.AGENT && member.agentId !== scope.agentId) {
    throw forbidden('यह सदस्य आपकी सूची में नहीं है');
  }

  const [trust, program, agentPhone] = await Promise.all([
    getTrust(scope),
    // The member may have been enrolled under a योजना that has since been
    // removed; the sheet should still print, just without the scheme line.
    getProgram(scope, member.programId).catch(() => null),
    agentPhoneFor(scope.trustId, member.agentId),
  ]);

  const [{ renderPdf }, mod] = await Promise.all([
    import('../../../../../server/pdf/renderer.js'),
    doc.module(),
  ]);

  const buffer = await renderPdf(
    React.createElement(doc.pick(mod), {
      trust,
      program,
      member: { ...member, agentPhone },
    }),
  );

  const name = `${member.registrationNumber || member.id}-${doc.suffix}`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

/**
 * The enrolling agent's phone, for the signature line.
 *
 * Read live rather than copied onto the member at enrolment: an agent who
 * changes their number should not have to have every one of their members
 * rewritten for the next reprint to be reachable. A missing agent is not an
 * error — plenty of members are added directly by the office.
 */
async function agentPhoneFor(trustId, agentId) {
  if (!agentId) return '';
  try {
    const snap = await db.doc(paths.agent(trustId, agentId)).get();
    return snap.exists ? (snap.data().phone ?? '') : '';
  } catch {
    return '';
  }
}
