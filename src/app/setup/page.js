'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert, Button, Card, Form, Input, InputNumber, Typography, Space, Result,
  Spin, Tag,
} from 'antd';

import { waitForUser, configError, missingEnv } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';

const { Title, Text, Paragraph } = Typography;

/**
 * One-time bootstrap.
 *
 * A fresh Firebase user has no `trustId` claim, so every endpoint refuses
 * them. This creates the trust, its first program and all the counter
 * documents, then refreshes the ID token so the new claims take effect.
 */
export default function SetupPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [authError, setAuthError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  /**
   * Wait for persistence to restore before deciding anything. Reading
   * `auth.currentUser` on mount would report "signed out" on every hard load,
   * because Firebase restores the session asynchronously.
   */
  useEffect(() => {
    if (configError) {
      setUser(null);
      return;
    }
    let cancelled = false;
    waitForUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch((err) => {
        if (!cancelled) {
          setAuthError(err.message);
          setUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFinish(values) {
    setBusy(true);
    setError(null);

    try {
      await api.setup(values);

      // Custom claims only appear in a NEW token — force a refresh, then swap
      // the session cookie for one carrying the owner claims.
      const current = await waitForUser();
      if (!current) throw new Error('सत्र समाप्त हो गया — दोबारा लॉगिन करें');

      const freshToken = await current.getIdToken(true);
      await api.session.create(freshToken);

      setDone(true);
    } catch (err) {
      setError(err?.message ?? 'Setup नहीं हो सका');
      setBusy(false);
    }
  }

  const shell = (children) => (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 540 }} styles={{ body: { padding: 32 } }}>
        {children}
      </Card>
    </div>
  );

  if (configError) {
    return shell(
      <Alert
        type="error"
        showIcon
        message="Firebase कॉन्फ़िगरेशन अधूरी है"
        description={
          <>
            <Paragraph style={{ marginBottom: 8 }}>
              <Text code>.env.local</Text> में ये खाली हैं:
            </Paragraph>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {missingEnv.map((n) => (
                <li key={n}>
                  <Text code>{n}</Text>
                </li>
              ))}
            </ul>
          </>
        }
      />,
    );
  }

  if (user === undefined) {
    return shell(
      <Space direction="vertical" align="center" style={{ width: '100%', padding: 24 }}>
        <Spin />
        <Text type="secondary">लॉगिन की जाँच हो रही है…</Text>
      </Space>,
    );
  }

  /**
   * The most common reason setup "does nothing": you have to be signed in
   * first. Say so, instead of showing a form that will fail on submit.
   */
  if (!user) {
    return shell(
      <Result
        status="warning"
        title="पहले लॉगिन करें"
        subTitle={
          authError ??
          'सेटअप के लिए Firebase खाते से लॉगिन ज़रूरी है — यही खाता ट्रस्ट का मालिक बनेगा।'
        }
        extra={
          <Link href="/login?next=/setup">
            <Button type="primary">लॉगिन पेज खोलें</Button>
          </Link>
        }
      />,
    );
  }

  if (done) {
    return shell(
      <Result
        status="success"
        title="ट्रस्ट बन गया"
        subTitle="आपका खाता अब इस ट्रस्ट का मालिक है।"
        extra={
          <Button
            type="primary"
            onClick={() => {
              router.replace('/dashboard');
              router.refresh();
            }}
          >
            डैशबोर्ड खोलें
          </Button>
        }
      />,
    );
  }

  return shell(
    <>
      <Title level={3} style={{ marginTop: 0, color: 'var(--brand)' }}>
        पहली बार सेटअप
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        यह सिर्फ़ एक बार चलता है — ट्रस्ट, पहली योजना और सारे counters बनाता है।
        इसके बाद <Text code>SETUP_SECRET</Text> को <Text code>.env.local</Text> से
        हटा दीजिए।
      </Paragraph>
      <Paragraph style={{ marginBottom: 20 }}>
        <Tag color="green">लॉगिन: {user.email}</Tag>
      </Paragraph>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form
        layout="vertical"
        onFinish={onFinish}
        disabled={busy}
        initialValues={{ programName: 'मुख्य योजना', payAmount: 200, joinFees: 0 }}
      >
        <Form.Item
          name="secret"
          label="Setup secret"
          extra=".env.local की SETUP_SECRET वैल्यू"
          rules={[{ required: true, message: 'secret डालें' }]}
        >
          <Input.Password autoFocus autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="trustName"
          label="ट्रस्ट का नाम (हिंदी)"
          rules={[{ required: true, message: 'नाम डालें' }, { min: 2 }]}
        >
          <Input placeholder="श्री ... ट्रस्ट" />
        </Form.Item>

        <Form.Item name="trustNameEn" label="Trust name (English)">
          <Input placeholder="Shri ... Trust" />
        </Form.Item>

        <Form.Item
          name="programName"
          label="योजना का नाम"
          rules={[{ required: true, message: 'योजना का नाम डालें' }, { min: 2 }]}
        >
          <Input />
        </Form.Item>

        <Space size={16} style={{ display: 'flex' }}>
          <Form.Item name="payAmount" label="प्रति क्लोजिंग राशि" style={{ flex: 1 }}>
            <InputNumber min={1} prefix="₹" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="joinFees" label="नामांकन शुल्क" style={{ flex: 1 }}>
            <InputNumber min={0} prefix="₹" style={{ width: '100%' }} />
          </Form.Item>
        </Space>

        <Button type="primary" htmlType="submit" block loading={busy}>
          ट्रस्ट बनाएँ
        </Button>
      </Form>
    </>,
  );
}
