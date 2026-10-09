'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, UserOutlined, MailOutlined } from '@ant-design/icons';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { requireAuth, configError, auth } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';
import { homeForRole, safeNext } from '../../lib/homeForRole.js';
import { useT } from '../../i18n/index.js';
import LanguageSwitcher from '../shell/LanguageSwitcher.js';

/**
 * Sign-in for the two phone apps.
 *
 *  member — रजिस्ट्रेशन नंबर + पासवर्ड. The number becomes `1023@gmail.com`,
 *           the convention every member login has used since the old app.
 *  agent  — the email the office created the agent with + password.
 *
 * Whoever signs in is sent to THEIR home whichever door they used: an agent
 * who opens the member app lands in the agent app, not on an error.
 */
export default function MobileLogin({ app }) {
  return (
    <Suspense>
      <LoginInner app={app} />
    </Suspense>
  );
}

function LoginInner({ app }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(null);
  const isMember = app === 'member';

  const branding = useQuery({ queryKey: ['branding'], queryFn: () => api.branding(), staleTime: 600000 });
  // Read only after mount: this form hydrates late (under <Suspense>), by
  // which time the branding has arrived and would not match the server HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const b = mounted ? branding.data?.branding : undefined;
  const trustName = b?.nameHi || t('ट्रस्ट प्रबंधन');

  // Already signed in with a live session → straight in.
  useEffect(() => {
    let cancelled = false;
    api.session.me()
      .then((res) => {
        if (cancelled || !res?.user) return;
        const role = res.user.role;
        router.replace(safeNext(params.get('next'), role) ?? homeForRole(role));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [router, params]);

  async function onFinish(values) {
    setBusy(true);
    setError(null);
    try {
      const id = values.identifier.trim();
      const email = id.includes('@') ? id : `${id.toLowerCase()}@gmail.com`;
      const cred = await signInWithEmailAndPassword(requireAuth(), email, values.password);
      const idToken = await cred.user.getIdToken();
      const res = await api.session.create(idToken);
      const role = res?.user?.role ?? 'member';
      router.replace(safeNext(params.get('next'), role) ?? homeForRole(role));
      router.refresh();
    } catch (err) {
      if (auth) await signOut(auth).catch(() => {});
      setError(friendly(err, isMember, t));
      setBusy(false);
    }
  }

  return (
    <div className="m-login">
      <div className="m-login__brand">
        {b?.logoURL
          ? <img src={b.logoURL} alt="" className="m-login__logo" />
          : <div className="m-login__logo">{trustName.slice(0, 1)}</div>}
        <h1 style={{ margin: '12px 0 0', fontSize: 21, lineHeight: 1.35 }}>{trustName}</h1>
        {b?.tagline ? <div className="m-muted">{b.tagline}</div> : null}
        <div className="m-login__app">{isMember ? t('सदस्य ऐप') : t('एजेंट ऐप')}</div>
      </div>

      <div className="m-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{t('प्रवेश करें')}</div>
        <div className="m-muted" style={{ marginBottom: 16 }}>
          {isMember
            ? t('अपने रजिस्ट्रेशन नंबर और पासवर्ड से लॉगिन करें')
            : t('कार्यालय से मिले ईमेल और पासवर्ड से लॉगिन करें')}
        </div>

        {configError ? <Alert type="warning" showIcon message={configError} style={{ marginBottom: 12 }} /> : null}
        {params.get('stale') === '1' && !error ? (
          <Alert type="info" showIcon message={t('सत्र समाप्त हो गया था — दोबारा लॉगिन करें')} style={{ marginBottom: 12 }} />
        ) : null}
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

        <Form layout="vertical" size="large" onFinish={onFinish} disabled={busy || checking} requiredMark={false}>
          <Form.Item
            name="identifier"
            label={isMember ? t('रजिस्ट्रेशन नंबर') : t('ईमेल')}
            rules={[{ required: true, message: isMember ? t('रजिस्ट्रेशन नंबर डालें') : t('ईमेल डालें') }]}
          >
            <Input
              prefix={isMember ? <UserOutlined /> : <MailOutlined />}
              placeholder={isMember ? '1023' : 'agent@example.com'}
              inputMode={isMember ? 'text' : 'email'}
              autoComplete="username"
              autoCapitalize="none"
            />
          </Form.Item>
          <Form.Item name="password" label={t('पासवर्ड')} rules={[{ required: true, message: t('पासवर्ड डालें') }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy || checking} style={{ height: 48, borderRadius: 12, fontWeight: 600 }}>
            {t('प्रवेश करें')}
          </Button>
        </Form>
        <div className="m-muted" style={{ marginTop: 14, textAlign: 'center' }}>
          {isMember
            ? t('पासवर्ड नहीं पता? अपने एजेंट या कार्यालय से पूछें।')
            : t('पासवर्ड भूल गए? कार्यालय से नया पासवर्ड लें।')}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <LanguageSwitcher />
      </div>
    </div>
  );
}

function friendly(err, isMember, t) {
  const code = err?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) {
    return isMember ? t('रजिस्ट्रेशन नंबर या पासवर्ड गलत है') : t('ईमेल या पासवर्ड गलत है');
  }
  if (code.includes('user-disabled')) return t('यह लॉगिन बंद है — कार्यालय से संपर्क करें');
  if (code.includes('too-many-requests')) return t('बहुत बार कोशिश की गई — कुछ देर बाद प्रयास करें');
  if (code.includes('network')) return t('इंटरनेट कनेक्शन जाँचें');
  return err?.message ?? t('प्रवेश नहीं हो सका');
}
