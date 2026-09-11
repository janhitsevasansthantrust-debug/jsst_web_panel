'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, Form, Input, Typography, Alert, Space, Grid } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  UserOutlined, LockOutlined, SafetyCertificateOutlined,
  TeamOutlined, BarChartOutlined,
} from '@ant-design/icons';
import { signInWithEmailAndPassword } from 'firebase/auth';

import { requireAuth, configError, missingEnv } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import LanguageSwitcher from '../../components/shell/LanguageSwitcher.js';

const { Title, Text, Paragraph } = Typography;

/**
 * Sign in.
 *
 * The ID token is used exactly once — to mint an httpOnly session cookie — and
 * then forgotten. The old app kept the token in JS memory and attached it to
 * every request, which meant any XSS on any page could walk off with a
 * long-lived credential.
 *
 * A small suspense boundary wraps the form: `useSearchParams()` must sit under
 * <Suspense> or the build fails with "missing-suspense-with-csr-bailout".
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const screens = Grid.useBreakpoint();
  const isDesktop = screens.lg;

  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const t = useT();

  const stale = params.get('stale') === '1';

  // The trust's own name, logo and colours — before anyone has a session, so
  // the first screen a person sees is not the one unbranded page in the app.
  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.branding(),
    staleTime: 10 * 60 * 1000,
  });
  const b = branding.data?.branding;

  /**
   * Forward an already-signed-in user.
   *
   * Proxy used to do this by looking for a session cookie, but a cookie can be
   * present and dead — and then proxy's redirect here fought the admin
   * layout's redirect back, which is what produced ERR_TOO_MANY_REDIRECTS.
   * Asking the server whether the session is actually VALID cannot loop: a bad
   * cookie simply answers 401 and the form stays put.
   */
  useEffect(() => {
    let cancelled = false;
    api.session
      .me()
      .then((res) => {
        if (cancelled || !res?.user?.trustId) return;
        router.replace(params.get('next') || '/dashboard');
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, params]);

  async function onFinish(values) {
    setBusy(true);
    setError(null);

    try {
      // Members log in with their registration number; staff use an email.
      const identifier = values.identifier.trim();
      const email = identifier.includes('@')
        ? identifier
        : `${identifier}@gmail.com`;

      const credential = await signInWithEmailAndPassword(
        requireAuth(),
        email,
        values.password,
      );
      const idToken = await credential.user.getIdToken();

      await api.session.create(idToken);

      router.replace(params.get('next') || '/dashboard');
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg)',
      }}
    >
      {/* ── Branded left panel (desktop only) ───────────────────────────── */}
      {isDesktop && (
        <div
          className="login-aside"
          style={{
            flex: '1 1 52%',
            maxWidth: 620,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '64px 72px',
            color: '#fff',
            background:
              'radial-gradient(900px 500px at 85% -10%, var(--brand-hover) 0%, transparent 55%),' +
              'linear-gradient(165deg, var(--brand) 0%, var(--sider-bg) 65%, var(--sider-bg-end) 100%)',
          }}
        >
          {/* soft decorative glow */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              right: '-120px',
              top: '40%',
              width: 360,
              height: 360,
              borderRadius: '50%',
              background: 'var(--accent)',
              opacity: 0.08,
              filter: 'blur(70px)',
            }}
          />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
              {b?.logoURL ? (
                <img
                  src={b.logoURL}
                  alt=""
                  style={{
                    width: 54, height: 54, objectFit: 'contain', borderRadius: 14,
                    background: 'rgba(255,255,255,.94)', padding: 6,
                    boxShadow: '0 8px 24px rgba(0,0,0,.25)',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 54, height: 54, borderRadius: 14, display: 'grid',
                    placeItems: 'center', fontWeight: 700, fontSize: 22,
                    background: 'var(--accent)', color: 'var(--accent-contrast)',
                    boxShadow: '0 8px 24px rgba(0,0,0,.25)',
                  }}
                >
                  {(b?.nameHi || 'ट्रस्ट प्रबंधन').slice(0, 1)}
                </div>
              )}
              <Title level={3} style={{ color: '#fff', margin: 0, fontSize: 24 }}>
                {b?.nameHi || 'ट्रस्ट प्रबंधन'}
              </Title>
            </div>

            <Title level={2} style={{ color: '#fff', margin: 0, fontSize: 34, lineHeight: 1.3 }}>
              {t('सदस्य, क्लोजिंग और भुगतान — सब एक जगह।')}
            </Title>
            {b?.tagline && (
              <Text style={{ color: 'rgba(255,255,255,.72)', fontSize: 15 }}>{b.tagline}</Text>
            )}

            <Space
              direction="vertical"
              size={14}
              style={{ marginTop: 40, width: '100%' }}
            >
              <Feature icon={<TeamOutlined />} title={t('सदस्य')} desc={t('हजारों सदस्यों की पूरी सूची और खोज')} />
              <Feature icon={<BarChartOutlined />} title={t('रिपोर्ट / PDF')} desc={t('हर रिपोर्ट और रसीद एक क्लिक पर, सर्वर से')} />
              <Feature icon={<SafetyCertificateOutlined />} title={t('सुरक्षित लेन-देन')} desc={t('हर भुगतान एक transaction में, दोहरा चार्ज असंभव')} />
            </Space>
          </div>
        </div>
      )}

      {/* ── Form panel ──────────────────────────────────────────────────── */}
      <div
        style={{
          flex: '1 1 48%',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background:
            !isDesktop
              ? 'radial-gradient(900px 500px at 50% -20%, var(--brand-wash) 0%, transparent 60%), var(--bg)'
              : 'var(--bg)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 420 }}>
          {!isDesktop && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              {b?.logoURL ? (
                <img
                  src={b.logoURL}
                  alt=""
                  style={{
                    width: 58, height: 58, objectFit: 'contain', borderRadius: 14,
                    background: 'var(--surface)', padding: 6,
                    boxShadow: 'var(--shadow-md)',
                  }}
                />
              ) : null}
              <Title level={3} style={{ margin: '12px 0 0', fontSize: 22 }}>
                {b?.nameHi || 'ट्रस्ट प्रबंधन'}
              </Title>
              {b?.tagline && (
                <Text type="secondary" style={{ fontSize: 13 }}>{b.tagline}</Text>
              )}
            </div>
          )}

          <Card
            style={{
              borderRadius: 18, border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-md)',
            }}
            styles={{ body: { padding: 30 } }}
          >
            <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 22 }}>
              <Title level={3} style={{ margin: 0, fontSize: 20 }}>{t('प्रवेश करें')}</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('रजिस्ट्रेशन नंबर या ईमेल से लॉग इन करें')}
              </Text>
            </Space>

            {configError ? <ConfigHelp missing={missingEnv} /> : null}

            {stale && !error && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('सत्र समाप्त हो गया था')}
                description="दोबारा लॉगिन करें। (एजेंट/मालिक के अधिकार बदलने पर पुराने सत्र अपने-आप बंद हो जाते हैं।)"
              />
            )}

            {error && (
              <Alert
                type="error"
                message={error}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Form
              layout="vertical"
              onFinish={onFinish}
              disabled={busy || checking || Boolean(configError)}
              size="large"
            >
              <Form.Item
                name="identifier"
                label={t('रजिस्ट्रेशन नंबर या ईमेल')}
                rules={[{ required: true, message: t('रजिस्ट्रेशन नंबर डालें') }]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: '#999' }} />}
                  placeholder="1023"
                  autoComplete="username"
                  autoFocus
                />
              </Form.Item>

              <Form.Item
                name="password"
                label={t('पासवर्ड')}
                rules={[{ required: true, message: t('पासवर्ड डालें') }]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#999' }} />}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                block
                loading={busy || checking}
                disabled={Boolean(configError)}
                size="large"
                style={{ height: 46, borderRadius: 12, fontWeight: 600 }}
              >
                {t('प्रवेश करें')}
              </Button>
            </Form>
          </Card>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Space direction="vertical" size={2} align="center">
              <LanguageSwitcher />
              <Text type="secondary" style={{ fontSize: 11, color: 'var(--muted)' }}>
                {b?.nameEn || ''}
              </Text>
            </Space>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div
        style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,.12)',
          color: '#fff', fontSize: 18,
          backdropFilter: 'blur(4px)',
        }}
      >
        {icon}
      </div>
      <div style={{ lineHeight: 1.4 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <Text style={{ color: 'rgba(255,255,255,.62)', fontSize: 12.5 }}>{desc}</Text>
      </div>
    </div>
  );
}

/**
 * A missing key used to blow up at module evaluation with
 * `auth/invalid-api-key` and a 500. Now it says which variable is missing and
 * what to do about it.
 */
function ConfigHelp({ missing }) {
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 20 }}
      message="Firebase कॉन्फ़िगरेशन अधूरी है"
      description={
        <div style={{ fontSize: 13 }}>
          <Paragraph style={{ marginBottom: 8 }}>
            <Text code>.env.local</Text> में ये variables खाली हैं:
          </Paragraph>
          <ul style={{ margin: '0 0 10px', paddingInlineStart: 18 }}>
            {missing.map((name) => (
              <li key={name}>
                <Text code>{name}</Text>
              </li>
            ))}
          </ul>
          <Paragraph style={{ margin: 0 }}>
            पुराने project की <Text code>.env.local</Text> से copy कीजिए, फिर
            dev server <strong>बंद करके दोबारा चालू</strong> कीजिए —{' '}
            <Text code>NEXT_PUBLIC_*</Text> values build के समय पढ़ी जाती हैं,
            hot-reload से नहीं आतीं।
          </Paragraph>
        </div>
      }
    />
  );
}

function friendlyError(err) {
  const code = err?.code ?? '';
  if (code.includes('invalid-api-key')) {
    return 'Firebase API key गलत या खाली है — .env.local जाँचें और dev server restart करें';
  }
  if (code.includes('invalid-credential') || code.includes('wrong-password')) {
    return 'रजिस्ट्रेशन नंबर या पासवर्ड गलत है';
  }
  if (code.includes('user-not-found')) return 'यह खाता मौजूद नहीं है';
  if (code.includes('too-many-requests')) {
    return 'बहुत बार कोशिश की गई — कुछ देर बाद प्रयास करें';
  }
  if (code.includes('network')) return 'इंटरनेट कनेक्शन जाँचें';
  if (err?.code === 'forbidden') {
    return 'यह खाता किसी ट्रस्ट से जुड़ा नहीं है — व्यवस्थापक से संपर्क करें';
  }
  return err?.message ?? 'प्रवेश नहीं हो सका';
}
