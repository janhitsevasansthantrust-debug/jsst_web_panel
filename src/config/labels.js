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

/**
 * How a receipt was paid, and whether it still stands.
 *
 * Same reasoning as above, and it matters more here: the receipt, the register
 * on screen, the CSV a clerk opens and the PDF that gets filed must all call
 * the same ₹500 "नकद". The screen wraps these in `t()`; the file and the PDF
 * print them as they are, because both are Hindi documents.
 */
export const PAYMENT_METHOD_LABEL = {
  cash: 'नकद',
  online: 'ऑनलाइन',
  upi: 'UPI',
  cheque: 'चेक',
  bank: 'बैंक',
};

export const paymentMethodLabel = (method) =>
  PAYMENT_METHOD_LABEL[method] ?? method ?? '';

export const PAYMENT_STATUS_LABEL = {
  completed: 'जमा',
  cancelled: 'रद्द',
};

export const paymentStatusLabel = (status) =>
  PAYMENT_STATUS_LABEL[status] ?? status ?? '';
