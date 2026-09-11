/**
 * The whole look of the app, derived from two colours.
 *
 * The trust picks a primary and an accent on the settings screen; everything
 * else — hover states, the sidebar gradient, the table header wash, the focus
 * ring, the AG Grid palette — is computed from them here. Nothing downstream
 * hardcodes a colour.
 *
 * That is not decoration. This system is meant to be handed to another trust
 * as a fresh deployment, and a trust whose colours are maroon-and-gold in the
 * PDF but maroon-and-gold-except-these-nine-places on screen has not really
 * been rebranded. One source, or it drifts.
 *
 * No imports, no framework: pure functions on strings, so the same file is
 * used by the browser, and could be used by the PDF renderer.
 */

/* ── colour maths ────────────────────────────────────────────────────────── */

/** `#8B0000` / `8b0000` / `#f00` → `{r,g,b}`, or null if it is not a colour. */
export function parseHex(hex) {
  const s = String(hex ?? '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`;

/** Blend two colours. `t` of 0 gives `a`, 1 gives `b`. */
export function mix(a, b, t) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return a;

  return toHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t,
  });
}

/** Towards white. */
export const tint = (hex, amount) => mix(hex, '#ffffff', amount);
/** Towards black. */
export const shade = (hex, amount) => mix(hex, '#000000', amount);

/** `#8B0000` + 0.12 → `rgba(139, 0, 0, 0.12)`, for shadows and washes. */
export function alpha(hex, a) {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/**
 * Relative luminance, per WCAG.
 *
 * Used to decide whether text on this colour should be black or white. Doing
 * it by eye is how you end up with a gold button whose white label is
 * unreadable — gold is far brighter than maroon at the same "darkness" to a
 * naive check, because green contributes most of the perceived brightness.
 */
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;

  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const NEAR_BLACK = '#1a1a1a';

/**
 * Black or white text, whichever is actually more readable on this background.
 *
 * Compared by contrast ratio rather than against a luminance threshold. A
 * threshold has to sit somewhere, and gold (#D4AF37) lands within a percent of
 * any sensible one — the first version of this used 0.45 and gold measures
 * 0.449, so it picked white, which is unreadable on gold. Comparing the two
 * candidates has no edge to fall off: gold scores 2.1 against white and 10.0
 * against black, and the answer is never in doubt.
 */
export function readableOn(hex) {
  return contrast(hex, NEAR_BLACK) >= contrast(hex, '#ffffff')
    ? NEAR_BLACK
    : '#ffffff';
}

/* ── the theme ───────────────────────────────────────────────────────────── */

export const DEFAULT_PRIMARY = '#8B0000';
export const DEFAULT_ACCENT = '#D4AF37';

/** Neutrals stay fixed — only the brand colours move. */
const INK = '#18181b';
const MUTED = '#6b7280';
const LINE = '#e8e8ec';
const CANVAS = '#f4f5f7';
const SURFACE = '#ffffff';

/** Money reads the same in every trust: red owes, green paid. */
export const DUE = '#b91c1c';
export const PAID = '#15803d';
export const WARN = '#b45309';

/**
 * Everything the app needs to paint itself, from one pair of colours.
 *
 * Returned as two halves: `antd` goes into `ConfigProvider`, `vars` becomes
 * CSS custom properties on `:root` so plain CSS and AG Grid can use the same
 * values without a second definition of them.
 */
export function buildTheme(primaryIn, accentIn) {
  const primary = parseHex(primaryIn) ? String(primaryIn) : DEFAULT_PRIMARY;
  const accent = parseHex(accentIn) ? String(accentIn) : DEFAULT_ACCENT;

  const hover = tint(primary, 0.16);
  const active = shade(primary, 0.18);
  const wash = tint(primary, 0.94);
  const washStrong = tint(primary, 0.86);

  // The sidebar is a very dark version of the brand rather than a neutral
  // charcoal — enough to read as "this trust", not so much that a saturated
  // brand colour makes a full-height panel tiring to sit next to.
  const siderBg = shade(mix(primary, '#151521', 0.72), 0.1);
  const siderBgEnd = shade(mix(primary, '#0e0e18', 0.8), 0.15);

  const vars = {
    '--brand': primary,
    '--brand-hover': hover,
    '--brand-active': active,
    '--brand-wash': wash,
    '--brand-wash-strong': washStrong,
    '--brand-contrast': readableOn(primary),
    '--brand-a12': alpha(primary, 0.12),
    '--brand-a24': alpha(primary, 0.24),

    '--accent': accent,
    '--accent-contrast': readableOn(accent),
    '--accent-wash': tint(accent, 0.9),

    '--sider-bg': siderBg,
    '--sider-bg-end': siderBgEnd,

    '--ink': INK,
    '--muted': MUTED,
    '--line': LINE,
    '--bg': CANVAS,
    '--surface': SURFACE,

    '--due': DUE,
    '--paid': PAID,
    '--warn': WARN,

    '--radius': '12px',
    '--radius-sm': '8px',
    '--shadow-sm': '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.05)',
    '--shadow-md': '0 6px 18px rgba(16,24,40,.07), 0 2px 6px rgba(16,24,40,.05)',
    '--shadow-lg': '0 16px 40px rgba(16,24,40,.12)',
  };

  const antd = {
    token: {
      colorPrimary: primary,
      colorLink: primary,
      colorLinkHover: hover,
      colorInfo: primary,
      colorError: DUE,
      colorSuccess: PAID,
      colorWarning: WARN,

      colorText: INK,
      colorTextSecondary: MUTED,
      colorBorder: LINE,
      colorBorderSecondary: '#f0f0f3',
      colorBgLayout: CANVAS,
      colorBgContainer: SURFACE,

      borderRadius: 12,
      borderRadiusLG: 14,
      borderRadiusSM: 8,

      fontFamily:
        "'Noto Sans Devanagari', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: 14,
      // Devanagari sits taller than Latin: matras above and below the line
      // need room, and antd's default line height crowds them.
      lineHeight: 1.65,

      controlHeight: 38,
      controlHeightLG: 44,
      wireframe: false,

      boxShadow: vars['--shadow-md'],
      boxShadowSecondary: vars['--shadow-md'],
    },

    components: {
      Layout: {
        siderBg,
        headerBg: SURFACE,
        headerHeight: 64,
        bodyBg: CANVAS,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemSelectedBg: alpha(accent, 0.18),
        darkItemSelectedColor: accent,
        darkItemHoverBg: 'rgba(255,255,255,.07)',
        darkItemColor: 'rgba(255,255,255,.74)',
        itemHeight: 44,
        itemMarginInline: 8,
        itemBorderRadius: 9,
      },
      Card: {
        headerBg: 'transparent',
        headerFontSize: 14,
        paddingLG: 22,
      },
      Table: {
        headerBg: wash,
        headerColor: shade(primary, 0.15),
        rowHoverBg: tint(primary, 0.97),
        headerSplitColor: 'transparent',
        borderColor: LINE,
      },
      Button: {
        primaryShadow: `0 1px 2px ${alpha(primary, 0.24)}`,
        fontWeight: 500,
      },
      Input: { paddingBlock: 6 },
      Select: { optionSelectedBg: wash },
      Tabs: { itemSelectedColor: primary, inkBarColor: primary },
      Statistic: { contentFontSize: 24 },
      Drawer: { paddingLG: 22 },
      Segmented: {
        itemSelectedBg: primary,
        itemSelectedColor: readableOn(primary),
        trackBg: washStrong,
      },
    },
  };

  return { primary, accent, antd, vars };
}

/** `{'--brand':'#8B0000'}` → a string for a `style` attribute or `cssText`. */
export function varsToCss(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}
