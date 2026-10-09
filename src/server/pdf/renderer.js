import 'server-only';

import path from 'node:path';
import { Font, renderToBuffer } from '@react-pdf/renderer';

/**
 * PDF plumbing — fonts and the render call.
 *
 * The whole reason this file exists separately is the font. @react-pdf ships
 * Helvetica, which has no Devanagari glyphs at all, so every Hindi character
 * renders as an empty box. Since essentially every name in this system is in
 * Hindi, a PDF without a registered Devanagari face is not a degraded PDF —
 * it is a blank one.
 *
 * The TTFs are committed under `fonts/` rather than fetched at render time:
 * a receipt that depends on a network call to a third party is a receipt that
 * fails to print when that call does.
 */

import fs from 'node:fs';

/**
 * Where the fonts live.
 *
 * `process.cwd()` is the project root under `next dev` and under `next start`,
 * but a standalone build copies only what the tracer finds — and it does not
 * trace a path built at runtime. Both candidates are checked so the failure,
 * if it comes, comes with an explanation rather than as a PDF full of empty
 * boxes.
 */
const FONT_CANDIDATES = [
  path.join(process.cwd(), 'src', 'server', 'pdf', 'fonts'),
  path.join(process.cwd(), '.next', 'server', 'fonts'),
  path.join(process.cwd(), 'public', 'fonts'),
];

const FONT_DIR =
  FONT_CANDIDATES.find((dir) =>
    fs.existsSync(path.join(dir, 'NotoSansDevanagari-Regular.ttf')),
  ) ?? FONT_CANDIDATES[0];

export const FONT_FAMILY = 'NotoDevanagari';

let registered = false;

/**
 * Registering twice throws, and route handlers run repeatedly on a warm
 * instance — so this is guarded rather than run at import time.
 */
export function registerFonts() {
  if (registered) return;

  const regular = path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf');
  if (!fs.existsSync(regular)) {
    // Without this the PDF renders every Hindi character as an empty box and
    // reports no error at all — which is far harder to diagnose than a
    // refusal that names the missing file.
    throw new Error(
      `Devanagari फ़ॉन्ट नहीं मिला: ${regular}\n` +
      'PDF बिना इस फ़ॉन्ट के हिन्दी नहीं छाप सकता (खाली डिब्बे आएँगे)। ' +
      'फ़ाइल src/server/pdf/fonts/ में होनी चाहिए।',
    );
  }

  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf'), fontWeight: 'normal' },
      { src: path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf'), fontWeight: 'bold' },
      // Devanagari has no italic. Without these two entries any `fontStyle:
      // 'italic'` (the amount-in-words line on the रसीद uses one) makes
      // @react-pdf throw "Could not resolve font … italic" and the whole PDF
      // fails — every receipt print returned a 500.
      { src: path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf'), fontWeight: 'normal', fontStyle: 'italic' },
      { src: path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf'), fontWeight: 'bold', fontStyle: 'italic' },
    ],
  });

  // Devanagari words are long and have few break opportunities. Left alone,
  // @react-pdf hyphenates them mid-conjunct, which produces text that is not
  // merely ugly but wrong — a broken conjunct is a different letter.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

/** Render a document element to a Buffer. */
export async function renderPdf(element) {
  registerFonts();
  return renderToBuffer(element);
}
