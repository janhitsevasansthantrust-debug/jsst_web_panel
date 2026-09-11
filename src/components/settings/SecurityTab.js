'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Form, Input, Button, Typography, App, Alert, Descriptions, Tag } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth';

import { auth } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Paragraph, Text } = Typography;

/**
 * Your own account.
 *
 * The password change runs entirely in the browser against Firebase Auth,
 * which is the only place that can do it: the server never sees a password,
 * and adding a route that did would mean the current password travelling to us
 * for no reason.
 *
 * Firebase requires a recent sign-in before it will accept a new password.
 * Rather than failing with `auth/requires-recent-login` and leaving the user
 * to guess, this re-authenticates with the current password first — which is
 * also the check that the person at the keyboard is the account holder.
 */
export default function SecurityTab() {
  // The signed-in user comes from the session endpoint rather than a prop: a
  // Next.js page receives none, and threading one down from the layout would
  // make this component impossible to drop anywhere else.
  const session = useQuery({
    queryKey: ['session', 'me'],
    queryFn: () => api.session.me(),
  });
  const user = session.data?.user;

  const t = useT();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function change({ current, next }) {
    if (!auth?.currentUser) {
      message.error(t('सत्र नहीं मिला — दोबारा लॉग इन करें'));
      return;
    }

    setBusy(true);
    try {
      await reauthenticateWithCredential(
        auth.currentUser,
        EmailAuthProvider.credential(auth.currentUser.email, current),
      );
      await updatePassword(auth.currentUser, next);

      // The session cookie was minted from the old credentials. Refreshing it
      // keeps this tab signed in; without it the next request could 401 in the
      // middle of something.
      const idToken = await auth.currentUser.getIdToken(true);
      await api.session.create(idToken).catch(() => {});

      message.success(t('पासवर्ड बदल गया'));
      form.resetFields();
    } catch (error) {
      message.error(t(explain(error)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card size="small" title={t('आपका खाता')} style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label={t('नाम')}>{user?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label={t('ईमेल')}>{user?.email || '—'}</Descriptions.Item>
          <Descriptions.Item label={t('भूमिका')}>
            <Tag color="blue">{t(roleLabel(user?.role))}</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title={t('पासवर्ड बदलें')} style={{ maxWidth: 460 }}>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('बदलने के बाद बाक़ी डिवाइस पर लॉग इन बना रहेगा। किसी और का खाता बंद करना हो तो "टीम सदस्य" में जाकर करें।')}
        </Paragraph>

        <Form form={form} layout="vertical" onFinish={change}>
          <Form.Item name="current" label={t('मौजूदा पासवर्ड')}
            rules={[{ required: true, message: t('मौजूदा पासवर्ड डालें') }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>

          <Form.Item name="next" label={t('नया पासवर्ड')}
            rules={[{ required: true, min: 8, message: t('कम से कम 8 अक्षर') }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirm"
            label={t('नया पासवर्ड दोबारा')}
            dependencies={['next']}
            rules={[
              { required: true, message: t('दोबारा डालें') },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('next') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('दोनों पासवर्ड अलग हैं'))),
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" loading={busy} onClick={() => form.submit()}>
            {t('पासवर्ड बदलें')}
          </Button>
        </Form>
      </Card>

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16, maxWidth: 640 }}
        message={t('ब्राउज़र सीधे डेटाबेस से बात नहीं करता')}
        description={
          <Text style={{ fontSize: 12 }}>
            {t('इस सिस्टम में हर पढ़ना-लिखना सर्वर से होकर जाता है, और वहीं जाँचा जाता है कि आप कौन हैं और क्या कर सकते हैं। इसीलिए Firestore के नियम ब्राउज़र के लिए पूरी तरह बंद रखे गए हैं।')}
          </Text>
        }
      />
    </>
  );
}

function roleLabel(role) {
  return {
    owner: 'मालिक', admin: 'व्यवस्थापक', operator: 'ऑपरेटर',
    agent: 'एजेंट', member: 'सदस्य',
  }[role] ?? role ?? '—';
}

/** Firebase error codes are not sentences. Turn the ones people hit into ones. */
function explain(error) {
  const code = error?.code ?? '';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'मौजूदा पासवर्ड ग़लत है';
  }
  if (code.includes('weak-password')) return 'पासवर्ड बहुत कमज़ोर है';
  if (code.includes('too-many-requests')) {
    return 'बहुत बार कोशिश हुई — कुछ देर बाद दोबारा करें';
  }
  if (code.includes('requires-recent-login')) {
    return 'सुरक्षा के लिए दोबारा लॉग इन करें';
  }
  return error?.message ?? 'पासवर्ड नहीं बदला';
}
