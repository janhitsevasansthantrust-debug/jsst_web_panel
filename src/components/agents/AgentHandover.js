'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Input, Button, Alert, Typography, Space, Descriptions, Tag,
  App, Divider, Timeline, Card,
} from 'antd';
import { SwapOutlined, UserOutlined, MailOutlined, PhoneOutlined } from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * Give an agent's position to a different person.
 *
 * The distinction this dialog exists to make clear: the POSITION stays and the
 * PERSON changes. The 400 members keep collecting under the same agent record,
 * the commission history stays in one place, and the id never moves — only the
 * login, the name and the signature do.
 *
 * The alternative an admin might reach for — switch this agent off, create a
 * new one — leaves 400 members pointing at somebody who no longer exists and
 * splits one collection round across two names in every report. So the panel
 * says plainly what carries over and what does not, before anything happens.
 */
export default function AgentHandover({ agent, open, onClose }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const t = useT();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(null);

  // How many members this position carries — the number that makes the
  // difference between "handover" and "new agent" concrete.
  const counts = useQuery({
    queryKey: ['members', 'summary', 'agent'],
    queryFn: () => api.members.summary({ groupBy: 'agent' }),
    enabled: open,
  });
  const mine = counts.data?.groups?.agent?.find((r) => r.value === agent?.id);

  const handover = useMutation({
    mutationFn: (values) => api.agents.handover(agent.id, values),
    onSuccess: (res) => {
      setDone(res);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: keys.agents });
      // The agent's name is copied onto every member they enrolled.
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => message.error(err.message),
  });

  function close() {
    setDone(null);
    onClose();
  }

  if (!agent) return null;

  /* ── after ─────────────────────────────────────────────────────────────── */

  if (done) {
    return (
      <Modal
        title={t('ज़िम्मेदारी सौंप दी गई')}
        open={open}
        onCancel={close}
        maskClosable={false}
        footer={[
          <Button key="ok" type="primary" onClick={close}>{t('नोट कर लिया')}</Button>,
        ]}
      >
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${done.previous.name} → ${done.agent.displayName}`}
          description={
            done.cascade?.members
              ? t('{n} सदस्यों पर एजेंट का नाम भी बदल गया। सारे सदस्य, रसीदें और कमीशन इतिहास वहीं हैं।', { n: done.cascade.members.toLocaleString('en-IN') })
              : t('सारे सदस्य, रसीदें और कमीशन इतिहास वहीं हैं।')
          }
        />

        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={t('यह पासवर्ड दोबारा नहीं दिखेगा')}
          description={t('{name} अब हर डिवाइस से लॉग आउट हो चुके हैं और पुराना ईमेल काम नहीं करेगा।', { name: done.previous.name })}
        />

        <Card size="small">
          <div style={{ lineHeight: 1.9 }}>
            <div>
              <Text type="secondary">{t('नया ईमेल')}</Text> —{' '}
              <Text copyable strong>{done.email}</Text>
            </div>
            <div>
              <Text type="secondary">{t('पासवर्ड')}</Text> —{' '}
              <Text copyable strong style={{ fontSize: 17, fontFamily: 'ui-monospace, monospace' }}>
                {done.password}
              </Text>
            </div>
          </div>
        </Card>
      </Modal>
    );
  }

  /* ── before ────────────────────────────────────────────────────────────── */

  return (
    <Modal
      title={<Space><SwapOutlined /> {t('एजेंट की ज़िम्मेदारी किसी और को दें')}</Space>}
      open={open}
      onCancel={close}
      onOk={() => form.submit()}
      okText={t('ज़िम्मेदारी सौंपें')}
      okButtonProps={{ danger: true }}
      cancelText={t('रद्द')}
      confirmLoading={handover.isPending}
      width={620}
      destroyOnHidden
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t('एजेंट का')} <Text strong>{t('पद')}</Text> {t('वहीं रहता है, सिर्फ़')} <Text strong>{t('व्यक्ति')}</Text> {t('बदलता है। जब पुराना एजेंट काम छोड़ दे और उसका इलाक़ा किसी और को देना हो, तब यही करें।')}
      </Paragraph>

      <Descriptions size="small" bordered column={1} style={{ marginBottom: 14 }}>
        <Descriptions.Item label={t('अभी किसके पास है')}>
          <Space wrap>
            <Text strong>{agent.displayName}</Text>
            <Text type="secondary">{agent.email}</Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('साथ में जाएगा')}>
          <Space wrap>
            <Tag color="blue">{(mine?.count ?? 0).toLocaleString('en-IN')} {t('सदस्य')}</Tag>
            <Tag color="green">{t('कमीशन इतिहास')}</Tag>
            <Tag color="green">{t('सारी रसीदें')}</Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('बदल जाएगा')}>
          <Space wrap>
            <Tag color="orange">{t('लॉगिन ईमेल')}</Tag>
            <Tag color="orange">{t('पासवर्ड')}</Tag>
            <Tag color="orange">{t('नाम')}</Tag>
            <Tag color="orange">{t('फ़ोटो और हस्ताक्षर')}</Tag>
          </Space>
        </Descriptions.Item>
      </Descriptions>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('{name} तुरंत हर डिवाइस से लॉग आउट हो जाएँगे', { name: agent.displayName })}
        description={t('पुराना ईमेल और पासवर्ड उसी क्षण काम करना बंद कर देंगे। पुराने हस्ताक्षर भी हटा दिए जाएँगे — नए व्यक्ति के हस्ताक्षर बाद में “संपादित करें” से अपलोड करें।')}
      />

      <Form form={form} layout="vertical" onFinish={handover.mutate}>
        <Form.Item
          name="displayName"
          label={t('नए व्यक्ति का नाम')}
          rules={[{ required: true, min: 2, message: t('नाम ज़रूरी है') }]}
        >
          <Input prefix={<UserOutlined />} placeholder={t('जैसे: सुरेश कुमार')} />
        </Form.Item>

        <Form.Item
          name="email"
          label={t('नया लॉगिन ईमेल')}
          rules={[
            { required: true, message: t('ईमेल ज़रूरी है') },
            { type: 'email', message: t('सही ईमेल डालें') },
          ]}
          extra={t('इसी से नया व्यक्ति लॉगिन करेगा')}
        >
          <Input prefix={<MailOutlined />} placeholder="suresh@example.com" />
        </Form.Item>

        <Form.Item
          name="phone"
          label={t('मोबाइल')}
          rules={[{ pattern: /^[0-9]{10}$/, message: t('10 अंकों का नंबर') }]}
        >
          <Input prefix={<PhoneOutlined />} maxLength={10} />
        </Form.Item>

        <Form.Item
          name="password"
          label={t('पासवर्ड')}
          extra={t('खाली छोड़ें तो अपने-आप बनेगा और एक बार दिखेगा')}
          rules={[{ min: 6, message: t('कम से कम 6 अक्षर') }]}
        >
          <Input.Password placeholder={t('अपने-आप बनेगा')} autoComplete="new-password" />
        </Form.Item>

        <Form.Item name="note" label={t('कारण / टिप्पणी')} extra={t('इतिहास में दर्ज होगा')}>
          <Input.TextArea rows={2} placeholder={t('जैसे: पुराने एजेंट ने काम छोड़ दिया')} />
        </Form.Item>
      </Form>

      {agent.handovers?.length > 0 && (
        <>
          <Divider orientation="left" style={{ fontSize: 13 }}>{t('पिछले बदलाव')}</Divider>
          <Timeline
            items={agent.handovers.slice(0, 5).map((h, i) => ({
              key: i,
              children: (
                <div style={{ lineHeight: 1.5 }}>
                  <Text>{h.fromName} → <Text strong>{h.toName}</Text></Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {h.atMs ? new Date(h.atMs).toLocaleDateString('hi-IN') : '—'}
                      {h.note ? ` · ${h.note}` : ''}
                    </Text>
                  </div>
                </div>
              ),
            }))}
          />
        </>
      )}
    </Modal>
  );
}
