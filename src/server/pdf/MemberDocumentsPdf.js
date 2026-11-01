import 'server-only';

import React from 'react';
import { Document } from '@react-pdf/renderer';


/**
 * Many members' sheets in ONE PDF — one page per member.
 *
 * Used by the members screen to print प्रमाण पत्र (or सदस्यता फॉर्म) for a
 * whole selection at once. `Sheet` is the same component the single-member
 * route renders (`MemberCertificatePdf` / `MemberRegFormPdf`) with `pageOnly`,
 * so a certificate printed in a batch is identical to one printed on its own.
 *
 * @param {{Sheet:Function, trust:object, items:{member:object, program:object|null}[], title:string}} props
 */
export function MemberDocumentsPdf({ Sheet, trust, items, title }) {
  const b = trust?.branding ?? {};
  return (
    <Document title={title} author={b.nameHi || trust?.name || ''}>
      {items.map(({ member, program }) => (
        <Sheet key={member.id} trust={trust} program={program} member={member} pageOnly />
      ))}
    </Document>
  );
}
