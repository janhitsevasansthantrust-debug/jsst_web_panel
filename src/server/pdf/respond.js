import 'server-only';

import React from 'react';

/**
 * Render a branded table list and wrap it as a PDF response.
 *
 * Lazy-imports the renderer, like every other PDF route: @react-pdf pulls in a
 * layout engine and font parsing that the JSON routes should never pay for.
 */
export async function tablePdfResponse(props, filename) {
  const [{ renderPdf }, { TableListPdf }] = await Promise.all([
    import('./renderer.js'),
    import('./TableListPdf.js'),
  ]);
  const buffer = await renderPdf(React.createElement(TableListPdf, {
    generatedAt: new Date().toLocaleString('hi-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }),
    ...props,
  }));
  return pdfResponse(buffer, filename);
}

export function pdfResponse(buffer, filename) {
  // ASCII fallback plus the real (possibly Hindi) name for browsers that read it.
  const ascii = String(filename).replace(/[^\w.-]+/g, '_');
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export const rupees = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const dmy = (ms) => (ms
  ? new Date(Number(ms)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' })
  : '');
