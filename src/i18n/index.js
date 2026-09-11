'use client';

import { useSyncExternalStore } from 'react';

import en from './en.js';
import gu from './gu.js';

/**
 * Language.
 *
 * The app was written in Hindi, so the Hindi text IS the message key:
 * `t('सदस्य')` returns "Members", "સભ્યો" or the Hindi itself. That has two
 * properties worth having.
 *
 * First, migration cannot break anything. A string that has not been wrapped
 * in `t()` yet still renders — in Hindi — instead of showing a raw key like
 * `members.title` to a user. Half-migrated is ugly; half-migrated with visible
 * keys is broken.
 *
 * Second, the catalogue is checkable. `npm run i18n:extract` walks the source,
 * finds every Devanagari literal, and lists the ones without a translation —
 * so "is this screen done" has an answer rather than an opinion.
 *
 * The cost is that renaming a Hindi label orphans its translations. That is a
 * real cost, and it is smaller than the alternative for a codebase that is
 * already written in one language and needs two more.
 */

export const LOCALES = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { value: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
];

export const DEFAULT_LOCALE = 'en';

/** `hi` has no table: the source text is already Hindi. */
const TABLES = { en, gu, hi: null };

const KEY = 'trust.locale';

let current = DEFAULT_LOCALE;
const listeners = new Set();

if (typeof window !== 'undefined') {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && TABLES[saved] !== undefined) current = saved;
  } catch {
    // Private mode — the default is fine.
  }
}

export function getLocale() {
  return current;
}

export function setLocale(next) {
  if (TABLES[next] === undefined || next === current) return;

  current = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Not fatal; it just will not be remembered.
  }

  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);
}

/**
 * Translate, with named placeholders.
 *
 *   t('{n} सदस्य मिले', { n: 412 })   →  "412 members found"
 *
 * Placeholders are named rather than positional because word order changes
 * between these three languages — a positional `%s` that reads correctly in
 * English lands in the wrong place in Gujarati often enough to matter.
 */
export function translate(locale, key, vars) {
  const table = TABLES[locale];
  let text = (table && table[key]) || key;

  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value ?? ''));
    }
  }

  return text;
}

/** The hook every component uses. */
export function useT() {
  const locale = useLocale();
  const t = (key, vars) => translate(locale, key, vars);
  t.locale = locale;
  return t;
}

/**
 * The locale for `Intl` — dates, numbers, currency.
 *
 * Indian digit grouping (1,20,000 rather than 120,000) is what people here
 * read, in every one of the three languages, so all three map to an -IN
 * locale rather than to `en-US`.
 */
export function intlLocale(locale) {
  return { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' }[locale] ?? 'en-IN';
}
