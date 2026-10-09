'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown } from 'antd';
import { ArrowLeftOutlined, MoreOutlined, LogoutOutlined, ReloadOutlined, GlobalOutlined, CheckOutlined } from '@ant-design/icons';
import { signOut } from 'firebase/auth';

import { api } from '../../lib/api.js';
import { auth } from '../../lib/firebase/client.js';
import { LOCALES, setLocale, useLocale, useT } from '../../i18n/index.js';

/**
 * The frame of both phone apps: a coloured header in the trust's own colours,
 * the page, and a tab bar under the thumb.
 *
 * `tabs` is `[{ href, icon, label, badge?, match? }]`. A tab is lit when the
 * path starts with its `match` (default: its href), longest match winning, so
 * `/agent/members/123` lights सदस्य, not होम.
 */
export default function MobileShell({
  title, subtitle, back, tabs = [], loginPath = '/login', extraMenu = [], right, children,
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const locale = useLocale();

  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.branding(),
    staleTime: 10 * 60 * 1000,
  });
  /**
   * Branding is applied only after mount. A page that sits under <Suspense>
   * hydrates late — after the branding request has answered — so reading it
   * during that hydration renders the trust's name where the server rendered
   * the fallback, and React throws the whole tree away.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const b = mounted ? branding.data?.branding : undefined;
  const trustName = b?.nameHi || t('ट्रस्ट प्रबंधन');

  const lit = tabs
    .map((tab) => tab.match ?? tab.href)
    .filter((m) => pathname === m || pathname.startsWith(`${m}/`))
    .sort((a, c) => c.length - a.length)[0];

  async function handleSignOut() {
    await api.session.destroy().catch(() => {});
    if (auth) await signOut(auth).catch(() => {});
    queryClient.clear();
    router.replace(loginPath);
    router.refresh();
  }

  const menu = {
    items: [
      ...extraMenu,
      {
        key: 'refresh',
        icon: <ReloadOutlined />,
        label: t('ताज़ा करें'),
        onClick: () => queryClient.invalidateQueries(),
      },
      {
        key: 'lang',
        icon: <GlobalOutlined />,
        label: t('भाषा'),
        children: LOCALES.map((l) => ({
          key: `lang-${l.value}`,
          label: l.native,
          icon: l.value === locale ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />,
          onClick: () => setLocale(l.value),
        })),
      },
      { type: 'divider' },
      { key: 'out', icon: <LogoutOutlined />, label: t('लॉग आउट'), danger: true, onClick: handleSignOut },
    ],
  };

  return (
    <div className="m-app">
      <header className="m-top">
        {back ? (
          <Button
            type="text"
            aria-label={t('वापस')}
            icon={<ArrowLeftOutlined />}
            onClick={() => (typeof back === 'string' ? router.push(back) : router.back())}
          />
        ) : b?.logoURL ? (
          <img src={b.logoURL} alt="" className="m-top__logo" />
        ) : (
          <div className="m-top__logo">{trustName.slice(0, 1)}</div>
        )}
        <div className="m-top__titles">
          <div className="m-top__title">{title ?? trustName}</div>
          <div className="m-top__sub">{subtitle ?? (title ? trustName : '')}</div>
        </div>
        {right}
        <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
          <Button type="text" aria-label={t('मेनू')} icon={<MoreOutlined style={{ fontSize: 20 }} />} />
        </Dropdown>
      </header>

      <main className={`m-body${tabs.length ? '' : ' m-body--notabs'}`}>{children}</main>

      {tabs.length > 0 && (
        <nav className="m-tabs" aria-label={t('मुख्य मेनू')}>
          {tabs.map((tab) => {
            const on = (tab.match ?? tab.href) === lit;
            return (
              <Link key={tab.href} href={tab.href} className={`m-tab${on ? ' m-tab--on' : ''}`}>
                {tab.icon}
                <span>{t(tab.label)}</span>
                {tab.badge ? <span className="m-tab__badge">{tab.badge > 99 ? '99+' : tab.badge}</span> : null}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/** A stat tile; pass `onClick` to make it a button. */
export function Stat({ label, value, hint, tone, onClick }) {
  const cls = `m-stat${tone ? ` m-stat--${tone}` : ''}`;
  const body = (
    <>
      <div className="m-stat__label">{label}</div>
      <div className="m-stat__value">{value}</div>
      {hint ? <div className="m-stat__hint">{hint}</div> : null}
    </>
  );
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** Horizontal filter chips. `options`: [{ value, label, count? }]. */
export function Chips({ value, onChange, options }) {
  return (
    <div className="m-chips" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`m-chip${value === o.value ? ' m-chip--on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null ? <span className="m-chip__n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="m-empty">{children}</div>;
}

/** A member's photo or initial. */
export function Avatar({ src, name, size = 40 }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: size, height: size, borderRadius: size / 3.2, objectFit: 'cover', flexShrink: 0, background: 'var(--brand-wash)' }}
      />
    );
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size / 3.2, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: 'var(--brand-wash-strong)', color: 'var(--brand)', fontWeight: 700, fontSize: size * 0.42,
      }}
    >
      {String(name || '?').trim().slice(0, 1)}
    </div>
  );
}
