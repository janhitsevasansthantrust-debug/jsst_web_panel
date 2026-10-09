/** Small formatters shared by the agent and member apps. */

export const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const num = (n) => Number(n || 0).toLocaleString('en-IN');

/** 08/10/2026 — India time, whatever the phone's own clock zone is. */
export const dmy = (ms) => (ms
  ? new Date(Number(ms)).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata',
  })
  : '—');

export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Open a server PDF in a new tab — the phone's viewer has share / print / save. */
export function openPdf(url) {
  if (typeof window === 'undefined') return;
  const w = window.open(url, '_blank', 'noopener');
  if (!w) window.location.href = url;
}

export const STATUS_PILL = {
  accepted: { cls: 'm-pill--paid', label: 'सक्रिय' },
  pending: { cls: 'm-pill--warn', label: 'लंबित' },
  closed: { cls: 'm-pill--brand', label: 'बंद (क्लोजिंग)' },
  blocked: { cls: 'm-pill--due', label: 'ब्लॉक' },
  left: { cls: 'm-pill--muted', label: 'छोड़ दिया' },
};

export const REQUEST_PILL = {
  pending: { cls: 'm-pill--warn', label: 'लंबित' },
  approving: { cls: 'm-pill--warn', label: 'स्वीकार हो रहा' },
  approved: { cls: 'm-pill--paid', label: 'स्वीकार हुए' },
  rejected: { cls: 'm-pill--due', label: 'अस्वीकृत' },
};
