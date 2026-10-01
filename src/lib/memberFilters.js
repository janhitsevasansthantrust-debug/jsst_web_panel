'use client';

import { statusLabel } from './memberStatus.js';

/**
 * The shape of "what the members list is currently showing", and the small
 * amount of logic that goes with it.
 *
 * It lives outside the page because three things need to agree about it: the
 * toolbar, the filter drawer, and the chips that show what is applied. When
 * that agreement was spread across those three components, adding a filter
 * meant remembering to touch all three, and forgetting one produced a filter
 * that worked but could not be seen or removed.
 */

export const GENDER_LABEL = { male: 'पुरुष', female: 'महिला', other: 'अन्य' };

export const EMPTY_FILTERS = {
  q: '',
  status: [],
  gender: [],
  ageBand: [],
  agentId: [],
  village: [],
  district: [],
  joinFrom: undefined,
  joinTo: undefined,
  ageMin: undefined,
  ageMax: undefined,
  hasDue: undefined,
  feeDone: undefined,
  /** Part or all of the joining fee still outstanding. */
  hasFeeDue: undefined,
  allPrograms: false,
};

/** Human names for each filter, used by the chips and the drawer headings. */
const FIELD_LABEL = {
  status: 'स्थिति',
  gender: 'लिंग',
  ageBand: 'आयु समूह',
  agentId: 'एजेंट',
  village: 'गाँव',
  district: 'ज़िला',
  hasDue: 'बकाया',
  feeDone: 'नामांकन शुल्क',
  hasFeeDue: 'शुल्क बाकी',
  allPrograms: 'योजना',
};

/**
 * Strip empty values so they never reach the URL.
 *
 * `false` needs care: for `hasDue` and `feeDone` it is a real choice — "कोई
 * बकाया नहीं" and "फीस बाकी है" — not an absent one, so those two are put back
 * after the blanket drop.
 */
export function cleanFilters(filters) {
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  if (filters.hasDue === false) out.hasDue = false;
  if (filters.feeDone === false) out.feeDone = false;
  if (filters.hasFeeDue === false) out.hasFeeDue = false;
  return out;
}

/** How many filters are on — the number on the फ़िल्टर button. */
export function countActiveFilters(filters) {
  let n = 0;
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'q') continue;
    if (Array.isArray(v)) n += v.length ? 1 : 0;
    else if (v !== undefined && v !== null && v !== '' && v !== false) n += 1;
  }
  // A date range is one filter to a person even though it is two fields.
  if (filters.joinFrom && filters.joinTo) n -= 1;
  return Math.max(0, n);
}

/**
 * Turn the applied filters into removable chips.
 *
 * Each chip carries a `clear` patch rather than a callback, so the page can
 * apply it however it likes and this stays a pure function.
 */
export function describeFilters(filters, facets = {}) {
  const chips = [];
  const labelIn = (facet, value) =>
    (facets[facet] ?? []).find((f) => f.value === value)?.label ?? value;

  const list = (key, facet, render) => {
    for (const v of filters[key] ?? []) {
      const raw = facet ? labelIn(facet, v) : v;
      chips.push({
        key: `${key}:${v}`,
        label: `${FIELD_LABEL[key]}: ${render ? render(raw) : (raw || '—')}`,
        clear: { [key]: (filters[key] ?? []).filter((x) => x !== v) },
      });
    }
  };

  list('status', 'statuses', statusLabel);
  list('gender', 'genders', (g) => GENDER_LABEL[String(g).toLowerCase()] ?? g);
  list('ageBand', 'ageBands');
  list('agentId', 'agents');
  list('village', 'villages');
  list('district', 'districts');

  if (filters.hasDue === true) {
    chips.push({ key: 'hasDue', label: 'सिर्फ़ बकायादार', clear: { hasDue: undefined } });
  }
  if (filters.hasDue === false) {
    chips.push({ key: 'hasDue', label: 'कोई बकाया नहीं', clear: { hasDue: undefined } });
  }
  if (filters.feeDone === true) {
    chips.push({ key: 'feeDone', label: 'शुल्क पूरा जमा', clear: { feeDone: undefined } });
  }
  if (filters.hasFeeDue === true) {
    chips.push({
      key: 'hasFeeDue',
      label: 'नामांकन शुल्क बाकी',
      clear: { hasFeeDue: undefined },
    });
  }
  if (filters.hasFeeDue === false) {
    chips.push({
      key: 'hasFeeDue',
      label: 'शुल्क पूरा जमा',
      clear: { hasFeeDue: undefined },
    });
  }
  if (filters.feeDone === false) {
    chips.push({ key: 'feeDone', label: 'शुल्क बाकी', clear: { feeDone: undefined } });
  }

  if (filters.ageMin != null || filters.ageMax != null) {
    chips.push({
      key: 'age',
      label: `उम्र ${filters.ageMin ?? '0'}–${filters.ageMax ?? '∞'}`,
      clear: { ageMin: undefined, ageMax: undefined },
    });
  }

  if (filters.joinFrom || filters.joinTo) {
    chips.push({
      key: 'join',
      label: `जुड़ा ${fmt(filters.joinFrom)} – ${fmt(filters.joinTo)}`,
      clear: { joinFrom: undefined, joinTo: undefined },
    });
  }

  if (filters.allPrograms) {
    chips.push({
      key: 'allPrograms',
      label: 'सभी योजनाएँ',
      clear: { allPrograms: false },
    });
  }

  return chips;
}

function fmt(ms) {
  if (!ms) return '…';
  return new Date(ms).toLocaleDateString('hi-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/** Facet → Select options, each carrying its member count. */
export function facetOptions(facet, relabel) {
  return (facet ?? []).map((f) => ({
    value: f.value,
    label: relabel ? relabel(f.label) : (f.label || '—'),
    count: f.count,
  }));
}
