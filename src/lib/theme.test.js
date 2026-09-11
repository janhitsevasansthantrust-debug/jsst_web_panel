import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHex, mix, tint, shade, alpha, luminance, readableOn, contrast,
  buildTheme, varsToCss, DEFAULT_PRIMARY, DEFAULT_ACCENT,
} from './theme.js';

test('parses long, short and unprefixed hex', () => {
  assert.deepEqual(parseHex('#8B0000'), { r: 139, g: 0, b: 0 });
  assert.deepEqual(parseHex('8b0000'), { r: 139, g: 0, b: 0 });
  assert.deepEqual(parseHex('#f00'), { r: 255, g: 0, b: 0 });
});

test('rejects anything that is not a colour', () => {
  for (const bad of ['', null, undefined, 'red', '#12345', 'javascript:x', '#ggg']) {
    assert.equal(parseHex(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

test('mix moves between two colours', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('tint goes lighter, shade goes darker, and both stay in range', () => {
  assert.ok(luminance(tint('#8B0000', 0.5)) > luminance('#8B0000'));
  assert.ok(luminance(shade('#8B0000', 0.5)) < luminance('#8B0000'));
  assert.equal(tint('#8B0000', 1), '#ffffff');
  assert.equal(shade('#8B0000', 1), '#000000');
});

test('alpha produces a usable rgba string', () => {
  assert.equal(alpha('#8B0000', 0.12), 'rgba(139, 0, 0, 0.12)');
});

test('readableOn picks white on dark and near-black on light', () => {
  assert.equal(readableOn('#8B0000'), '#ffffff');
  assert.equal(readableOn('#111111'), '#ffffff');
  assert.equal(readableOn('#ffffff'), '#1a1a1a');
  // Gold is much brighter than it looks: white text on it is unreadable, and
  // a naive lightness check gets this wrong.
  assert.equal(readableOn('#D4AF37'), '#1a1a1a');
});

test('a bad colour falls back to the default instead of painting nothing', () => {
  const t = buildTheme('not-a-colour', undefined);
  assert.equal(t.primary, DEFAULT_PRIMARY);
  assert.equal(t.accent, DEFAULT_ACCENT);
  assert.equal(t.antd.token.colorPrimary, DEFAULT_PRIMARY);
});

test('the chosen colour reaches both antd and the CSS variables', () => {
  const t = buildTheme('#0F766E', '#F59E0B');
  assert.equal(t.antd.token.colorPrimary, '#0F766E');
  assert.equal(t.vars['--brand'], '#0F766E');
  assert.equal(t.vars['--accent'], '#F59E0B');
});

test('money colours never move with the brand', () => {
  const a = buildTheme('#0F766E', '#F59E0B');
  const b = buildTheme('#8B0000', '#D4AF37');
  // Red owes and green paid in every trust — rebranding must not turn a debt
  // teal.
  assert.equal(a.vars['--due'], b.vars['--due']);
  assert.equal(a.vars['--paid'], b.vars['--paid']);
});

test('derived surfaces stay lighter than the brand they came from', () => {
  const { vars } = buildTheme('#0F766E', '#F59E0B');
  assert.ok(luminance(vars['--brand-wash']) > luminance(vars['--brand']));
  assert.ok(luminance(vars['--sider-bg']) < luminance(vars['--brand']));
});

test('every variable is a plain string, safe to put in a style attribute', () => {
  const { vars } = buildTheme('#0F766E', '#F59E0B');
  for (const [k, v] of Object.entries(vars)) {
    assert.equal(typeof v, 'string', `${k} should be a string`);
    assert.ok(!/[<>{}]/.test(v), `${k} should not contain markup characters`);
  }
});

test('varsToCss renders declarations a browser will accept', () => {
  const css = varsToCss({ '--brand': '#8B0000', '--radius': '10px' });
  assert.equal(css, '--brand:#8B0000;--radius:10px');
});

test('readableOn is decided by contrast, with no threshold to fall off', () => {
  // Gold measures luminance 0.449 — within a percent of any sensible cutoff.
  // Against the two real candidates it is not close: 2.1 vs white, 10.0 vs black.
  assert.ok(contrast('#D4AF37', '#ffffff') < 3);
  assert.ok(contrast('#D4AF37', '#1a1a1a') > 7);
  assert.equal(readableOn('#D4AF37'), '#1a1a1a');
});

test('whatever readableOn returns clears the WCAG 4.5:1 bar for body text', () => {
  for (const bg of ['#8B0000', '#D4AF37', '#0F766E', '#F59E0B', '#1e3a8a', '#facc15']) {
    assert.ok(
      contrast(bg, readableOn(bg)) >= 4.5,
      `${bg} on ${readableOn(bg)} is only ${contrast(bg, readableOn(bg)).toFixed(2)}:1`,
    );
  }
});
