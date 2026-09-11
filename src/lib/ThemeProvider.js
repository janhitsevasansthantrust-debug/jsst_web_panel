'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import en_US from 'antd/locale/en_US';
import hi_IN from 'antd/locale/hi_IN';

import { useLocale } from '../i18n/index.js';

import { api } from './api.js';
import { buildTheme } from './theme.js';

/**
 * Paints the app in the trust's colours.
 *
 * Two jobs, and they have to happen together or the app looks half-rebranded:
 *
 *  1. Feed the derived tokens to antd's `ConfigProvider`, which covers every
 *     component.
 *  2. Write the same values as CSS custom properties on `<html>`, which covers
 *     everything antd does not — plain CSS, AG Grid, the sidebar gradient.
 *
 * Both come from one `buildTheme()` call, so they cannot disagree.
 *
 * The colours arrive from `/api/branding`, which needs no session — the login
 * screen is branded too. Until it answers, the defaults render, so there is no
 * flash of an unstyled app and no blocking spinner in front of a login form.
 */
/**
 * antd's own strings — its date picker, pagination, empty states.
 *
 * antd ships no Gujarati, so Gujarati falls back to English rather than to
 * Hindi: someone who has chosen Gujarati has told us they do not want Hindi,
 * and English is the more widely-read of the two remaining options here.
 */
const ANTD_LOCALE = { en: en_US, hi: hi_IN, gu: en_US };

export default function ThemeProvider({ children }) {
  const locale = useLocale();

  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.branding(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const theme = useMemo(
    () => buildTheme(data?.branding?.theme?.primary, data?.branding?.theme?.accent),
    [data],
  );

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value);
    }
  }, [theme]);

  return (
    <ConfigProvider locale={ANTD_LOCALE[locale] ?? en_US} theme={theme.antd}>
      {children}
    </ConfigProvider>
  );
}
