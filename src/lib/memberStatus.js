'use client';

import { statusLabelFor } from '../config/labels.js';

/**
 * Member status labels and colours, in one place.
 *
 * These used to live inside the ledger drawer, which meant the members grid
 * imported a drawer just to colour a tag. They are plain lookups — they belong
 * next to the other shared client helpers.
 */

/**
 * The Hindi label — which is also the translation KEY.
 *
 * Callers wrap it in `t()`. Translating here would need a hook, and this is
 * called from AG Grid cell renderers and plain functions where there is none.
 */
export function statusLabel(status) {
  return statusLabelFor(status);
}

export function statusColor(status) {
  return (
    {
      pending: 'orange',
      accepted: 'green',
      closed: 'blue',
      blocked: 'red',
      left: 'default',
    }[status] ?? 'default'
  );
}

/** `1712345678901` → `12/04/2024`. Empty input renders as an em dash. */
export function hiDate(ms) {
  if (!ms || !Number.isFinite(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleDateString('hi-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
