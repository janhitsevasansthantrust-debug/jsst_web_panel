'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { KeyOutlined, StopOutlined, CheckOutlined, MobileOutlined, CopyOutlined } from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * The member's own login for the member app.
 *
 * The login ID is the registration number. The office sets the password —
 * by default the member's mobile number, which is the one thing a member is
 * sure to remember — and it is shown once and never stored.
 */
export default function MemberLoginPanel({ member }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [issued, setIssued] = useState(null);

  const login = useQuery({
    queryKey: keys.memberLogin(member.id),
    queryFn: () => api.memberLogin.get(member.id),
  });
  const info = login.data?.login;

  const save = useMutation({
    mutationFn: (body) => api.memberLogin.set(member.id, body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: keys.memberLogin(member.id) });
      if (res.login?.password) setIssued(res.login);
      else message.success(res.login?.disabled ? t('लॉगिन बंद कर दिया') : t('लॉगिन चालू कर दिया'));
      setPassword('');
    },
    onError: (e) => message.error(e.message, 6),
  });

  const appUrl = typeof window !== 'undefined' ? `${window.location.origin}/member/login` : '/member/login';

  return (
    <Card size="small">
      {login.isLoading ? <Spin /> : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t('लॉगिन ID (रजि. नंबर)')}><Text strong copyable>{member.registrationNumber}</Text></Descriptions.Item>
            <Descriptions.Item label={t('स्थिति')}>
              {!info?.exists ? <Tag>{t('लॉगिन नहीं बना')}</Tag>
                : info.disabled ? <Tag color="red">{t('बंद')}</Tag> : <Tag color="green">{t('चालू')}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('सदस्य ऐप')}><Text copyable={{ text: appUrl }}>{appUrl}</Text></Descriptions.Item>
          </Descriptions>

          {info?.exists && info.linkedToThisMember === false ? (
            <Alert type="warning" showIcon message={t('यह लॉगिन अभी इसी रजि. नंबर वाले दूसरे सदस्य से जुड़ा है')} />
          ) : null}

          <Text type="secondary">
            {t('सदस्य इस लॉगिन से अपने और अपने मोबाइल नंबर पर जुड़े सब सदस्यों का बकाया, जमा, रसीदें और प्रमाण पत्र देख सकेगा।')}
          </Text>

          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              placeholder={t('नया पासवर्ड (खाली = मोबाइल नंबर)')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Button
              type="primary"
              icon={<KeyOutlined />}
              loading={save.isPending}
              disabled={password.length > 0 && password.length < 6}
              onClick={() => save.mutate(password ? { password } : {})}
            >
              {info?.exists ? t('पासवर्ड बदलें') : t('लॉगिन बनाएँ')}
            </Button>
          </Space.Compact>

          {info?.exists ? (
            <Button
              icon={info.disabled ? <CheckOutlined /> : <StopOutlined />}
              danger={!info.disabled}
              loading={save.isPending}
              onClick={() => save.mutate({ disabled: !info.disabled })}
            >
              {info.disabled ? t('लॉगिन चालू करें') : t('लॉगिन बंद करें')}
            </Button>
          ) : null}
        </Space>
      )}

      <Modal
        open={Boolean(issued)}
        onCancel={() => setIssued(null)}
        onOk={() => setIssued(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        title={<span><MobileOutlined /> {t('सदस्य ऐप लॉगिन')}</span>}
      >
        {issued ? (
          <>
            <Paragraph>{t('यह पासवर्ड अभी सदस्य को बताएँ — यह दोबारा नहीं दिखेगा।')}</Paragraph>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t('ऐप')}>{appUrl}</Descriptions.Item>
              <Descriptions.Item label={t('रजि. नंबर')}><Text strong>{issued.loginId}</Text></Descriptions.Item>
              <Descriptions.Item label={t('पासवर्ड')}><Text strong copyable={{ icon: <CopyOutlined /> }}>{issued.password}</Text></Descriptions.Item>
            </Descriptions>
          </>
        ) : null}
      </Modal>
    </Card>
  );
}
