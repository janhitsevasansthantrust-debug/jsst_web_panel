'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, Form, Input, List, Radio, Row, Select, Space, Statistic, Tag, Typography,
} from 'antd';
import { BellOutlined, SendOutlined } from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Paragraph, Text } = Typography;

/**
 * Push notifications to the phone app (Firebase Cloud Messaging).
 *
 * Phones register themselves after login. From here the office sends a
 * message to everyone, only members, only agents, or one योजना. The app also
 * notifies on its own: receipt made (member), new closing (the योजना),
 * request approved / rejected (the agent). Everything sent shows in the app's
 * "सूचनाएँ" list too, so a phone that was off still sees it.
 */
const QUICK = [
  { title: 'नई क्लोजिंग सूचना जारी', body: 'नई क्लोजिंग सूचना जारी हुई है। अपना बकाया ऐप में देखें और अंतिम तिथि से पहले जमा करें।' },
  { title: 'भुगतान की याद', body: 'आपकी क्लोजिंग राशि बाकी है। कृपया जल्द जमा करें — ऐप में "भुगतान करें" से UPI द्वारा भी दे सकते हैं।' },
  { title: 'सभा / बैठक', body: 'ट्रस्ट की सभा … तारीख़ को … बजे … पर होगी। सभी सदस्य सादर आमंत्रित हैं।' },
];

export default function NotificationsTab() {
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const data = useQuery({ queryKey: ['push'], queryFn: () => api.push.overview() });
  const programs = useQuery({ queryKey: keys.programs, queryFn: () => api.programs.list() });
  const audience = Form.useWatch('audience', form);

  const send = useMutation({
    mutationFn: (v) => api.push.send(v),
    onSuccess: (res) => {
      const r = res.result;
      message.success(t('भेजा गया — {sent} फ़ोन पर पहुँचा', { sent: r.sent }) + (r.failed ? `, ${r.failed} ${t('विफल')}` : ''), 6);
      form.resetFields(['title', 'body']);
      qc.invalidateQueries({ queryKey: ['push'] });
    },
    onError: (e) => message.error(e.message, 8),
  });

  const counts = data.data?.counts;
  const programList = programs.data?.programs ?? programs.data?.items ?? [];

  return (
    <>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        <BellOutlined /> {t('एजेंट और सदस्य के फ़ोन ऐप पर सूचना (Firebase)। ऐप अपने-आप भी सूचना भेजता है: रसीद बनने पर सदस्य को, नई क्लोजिंग पर योजना के सब सदस्यों/एजेंटों को, और अनुरोध स्वीकार/अस्वीकार पर एजेंट को।')}
      </Paragraph>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={8}><Card size="small"><Statistic title={t('कुल फ़ोन')} value={counts?.total ?? 0} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title={t('सदस्य फ़ोन')} value={counts?.members ?? 0} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title={t('एजेंट फ़ोन')} value={counts?.agents ?? 0} /></Card></Col>
      </Row>
      {counts && !counts.total ? (
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={t('अभी कोई फ़ोन जुड़ा नहीं है — ऐप का नया APK इंस्टॉल करके लॉगिन करते ही फ़ोन यहाँ गिना जाएगा।')} />
      ) : null}

      <Card size="small" title={<><SendOutlined /> {t('नई सूचना भेजें')}</>} style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical" initialValues={{ audience: 'all' }} onFinish={(v) => send.mutate(v)}>
          <Form.Item name="audience" label={t('किसे भेजें')}>
            <Radio.Group optionType="button" buttonStyle="solid" options={[
              { value: 'all', label: t('सभी') },
              { value: 'members', label: t('सिर्फ़ सदस्य') },
              { value: 'agents', label: t('सिर्फ़ एजेंट') },
              { value: 'program', label: t('एक योजना') },
            ]} />
          </Form.Item>
          {audience === 'program' ? (
            <Form.Item name="programId" label={t('योजना')} rules={[{ required: true, message: t('योजना चुनें') }]}>
              <Select options={programList.map((p) => ({ value: p.id, label: p.hiname || p.name }))} style={{ maxWidth: 320 }} />
            </Form.Item>
          ) : null}
          <Form.Item label={t('तैयार संदेश')}>
            <Space wrap>
              {QUICK.map((q) => (
                <Button key={q.title} size="small" onClick={() => form.setFieldsValue(q)}>{t(q.title)}</Button>
              ))}
            </Space>
          </Form.Item>
          <Form.Item name="title" label={t('शीर्षक')} rules={[{ required: true, min: 2, message: t('शीर्षक लिखें') }]}>
            <Input maxLength={120} showCount />
          </Form.Item>
          <Form.Item name="body" label={t('संदेश')}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={send.isPending}>{t('भेजें')}</Button>
        </Form>
      </Card>

      <Card size="small" title={t('भेजी गई सूचनाएँ')}>
        <List
          loading={data.isLoading}
          dataSource={data.data?.sent ?? []}
          locale={{ emptyText: t('अभी कुछ नहीं भेजा') }}
          renderItem={(n) => (
            <List.Item>
              <List.Item.Meta
                title={<Space wrap>{n.title}<Tag>{kindLabel(n, t)}</Tag></Space>}
                description={<>
                  <div>{n.body}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {n.createdAtMs ? new Date(n.createdAtMs).toLocaleString('en-IN') : ''} · {t('पहुँचा')} {n.sent ?? 0}/{n.devices ?? 0}
                    {n.sentBy ? ` · ${n.sentBy}` : ''}
                  </Text>
                </>}
              />
            </List.Item>
          )}
        />
      </Card>
    </>
  );
}

function kindLabel(n, t) {
  const a = n.audience ?? {};
  if (n.kind === 'receipt') return t('रसीद');
  if (n.kind === 'closing') return t('क्लोजिंग');
  if (n.kind === 'request') return t('अनुरोध');
  if (a.role === 'member') return t('सदस्य');
  if (a.role === 'agent') return t('एजेंट');
  if (a.programId) return t('योजना');
  return t('सभी');
}
