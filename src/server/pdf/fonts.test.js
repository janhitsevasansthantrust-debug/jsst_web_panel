import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as fontkit from 'fontkit';

/**
 * The bundled Devanagari font has to be able to lay out ordinary Hindi.
 *
 * That sounds too obvious to test. It is not. The build of Noto Sans
 * Devanagari that was originally committed here (954 glyphs, an older
 * release) has a GPOS mark-attachment lookup with a null anchor for
 * ह + ै, and fontkit dereferences it without a guard:
 *
 *     TypeError: Cannot read properties of null (reading 'xCoordinate')
 *
 * So "है" — the most common word in the language — threw while shaping, and
 * the throw happened inside the PDF render, which meant every receipt,
 * statement, certificate and form whose text contained it came back as a 500
 * rather than as a document. Nothing about the failure pointed at a font.
 *
 * These strings are therefore not a style check. They are the shapes that
 * actually broke, plus a sample of the conjuncts these documents are full of,
 * asserted directly against the font file so that swapping the file back —
 * or "optimising" it with a subsetter that drops the fixed lookups — fails
 * here instead of at a counter.
 */

const FONT_DIR = path.join(process.cwd(), 'src', 'server', 'pdf', 'fonts');

const FACES = ['NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf'];

const PHRASES = [
  // The one that crashed, alone and in context.
  'है',
  'यह प्रमाण पत्र संस्था की सम्पत्ति है।',
  'सदस्य की मृत्यु होने पर सहयोग राशि ली जाएगी।',

  // Conjuncts and matras these documents are built out of.
  'श्रीमती कुसुमलता देवी घांची',
  'स्व. रामेश्वरलाल घांची',
  'सदस्यता प्रमाण पत्र',
  'वारिसदार से संबंध',
  'रद्द',
  'क्लोजिंग',

  // Nukta, chandrabindu, and the currency sign, which is not Devanagari at all
  // and so comes from a different part of the font.
  'ज़िला, गाँव',
  '₹101/- रुपये',
];

for (const face of FACES) {
  test(`${face} lays out Hindi without throwing`, () => {
    const file = path.join(FONT_DIR, face);
    assert.ok(fs.existsSync(file), `फ़ॉन्ट नहीं मिला: ${file}`);

    const font = fontkit.openSync(file);

    for (const phrase of PHRASES) {
      // The assertion is that this does not throw. A shaping failure is not a
      // degraded result — @react-pdf propagates it and no document is produced.
      const run = font.layout(phrase);

      assert.ok(
        run.glyphs.length > 0,
        `"${phrase}" ने कोई glyph नहीं दिया`,
      );

      // .notdef means the character is missing from the font: it prints as an
      // empty box, silently. Worth catching for the same reason.
      const missing = run.glyphs.filter((g) => g.id === 0);
      assert.equal(
        missing.length,
        0,
        `"${phrase}" में ${missing.length} अक्षर फ़ॉन्ट में नहीं हैं (खाली डिब्बे छपेंगे)`,
      );
    }
  });
}
