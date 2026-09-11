/**
 * Labels shared by the browser and the server.
 *
 * `lib/memberStatus.js` is a client module — importing it from a route handler
 * would drag `'use client'` into the server bundle. These live here, with no
 * imports of their own, so both sides can use the same words. A status that
 * reads "स्वीकृत" on screen and "accepted" in the exported file is the kind of
 * mismatch nobody reports and everybody works around.
 */

export const MEMBER_STATUS_LABEL = {
  pending: 'लंबित',
  accepted: 'स्वीकृत',
  closed: 'क्लोज़',
  blocked: 'ब्लॉक',
  left: 'छोड़ा',
};

export const statusLabelFor = (status) =>
  MEMBER_STATUS_LABEL[status] ?? status ?? '';
