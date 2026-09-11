'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, DatePicker, Divider, Drawer, Form, Input,
  InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Typography, App,
} from 'antd';
import {
  UserOutlined, MailOutlined, PhoneOutlined, KeyOutlined, SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { api, keys } from '../../lib/api.js';
import AgentHandover from './AgentHandover.js';
import { useMasters } from '../../lib/useMasters.js';
import { COMMISSION_MODE } from '../../config/constants.js';
import PhotoUpload from '../members/PhotoUpload.js';
import MultiFileUpload from '../members/MultiFileUpload.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * Add / edit an agent.
 *
 * An agent is not just a record — they sign in, collect payments and see their
 * own members. So the email is required (it is their login), and creating one
 * creates a real Firebase Auth account with role claims attached.
 *
 * The generated password is shown ONCE, after saving. It is never stored in
 * plain text anywhere, so if the admin loses it the only route is a reset —
 * which is the correct behaviour, not an inconvenience to design around.
 */
export default function AgentForm({ open, onClose, agent }) {
  // Same reference lists the member form uses — edited on the master screen.
  const masters = useMasters();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const t = useT();
  const queryClient = useQueryClient();
  const editing = Boolean(agent?.id);

  const [files, setFiles] = useState({});
  const [override, setOverride] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [handingOver, setHandingOver] = useState(false);

  const selectedState = Form.useWatch('state', form);

  useEffect(() => {
    if (!open) return;
    setFiles({});
    setCredentials(null);
    setOverride(Boolean(agent?.commissionOverride));

    if (agent) {
      form.setFieldsValue({
        ...agent,
        dateJoin: agent.dateJoinMs ? dayjs(agent.dateJoinMs) : dayjs(),
        useOverride: Boolean(agent.commissionOverride),
        joinFee: agent.commissionOverride?.joinFee ?? blankRule(),
        collection: agent.commissionOverride?.collection ?? blankRule(),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        dateJoin: dayjs(),
        active: true,
        sendEmail: false,
        useOverride: false,
        joinFee: blankRule(),
        collection: blankRule(),
      });
    }
  }, [open, agent, form]);

  /**
   * How many members carry this agent's name.
   *
   * Shown before a rename rather than after, because the number is the whole
   * point: renaming an agent with 400 members rewrites 400 documents, and an
   * admin correcting a typo deserves to know that before pressing save, not in
   * a toast afterwards.
   */
  const memberCounts = useQuery({
    queryKey: ['members', 'summary', 'agent'],
    queryFn: () => api.members.summary({ groupBy: 'agent' }),
    enabled: open && editing,
  });

  const myMembers =
    memberCounts.data?.groups?.agent?.find((r) => r.value === agent?.id)?.count ?? 0;

  const nameNow = Form.useWatch('displayName', form);
  const renaming =
    editing && nameNow && nameNow.trim() !== String(agent?.displayName ?? '').trim();

  const resetPassword = useMutation({
    mutationFn: () => api.agents.resetPassword(agent.id),
    onSuccess: (res) => setCredentials({ email: res.email, password: res.password, reset: true }),
    onError: (err) => message.error(err.message),
  });

  const save = useMutation({
    mutationFn: (values) => {
      const { useOverride, joinFee, collection, dateJoin, ...rest } = values;
      const body = {
        ...rest,
        dateJoin: dateJoin?.format('DD-MM-YYYY') ?? '',
        dateJoinMs: dateJoin?.startOf('day').valueOf(),
        photoURL: files.photo ?? agent?.photoURL ?? '',
        signatureURL: files.signature ?? agent?.signatureURL ?? '',
        documentURLs: files.documents ?? agent?.documentURLs ?? [],
        commissionOverride: useOverride ? { joinFee, collection } : null,
      };
      return editing ? api.agents.update(agent.id, body) : api.agents.create(body);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: keys.agents });
      // The agent's name is copied onto their members, so a rename changes the
      // members list too — its cache has to go with it.
      queryClient.invalidateQueries({ queryKey: ['members'] });

      if (!editing && res.password) {
        // Show the password before closing — this is the only time it exists.
        setCredentials({ email: res.agent.email, password: res.password });
        return;
      }

      const moved = res.cascade?.members ?? 0;
      message.success(
        moved
          ? t('एजेंट अपडेट हो गया — {n} सदस्यों पर नाम भी बदल गया', { n: moved.toLocaleString('en-IN') })
          : t('एजेंट अपडेट हो गया'),
      );
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <>
      <Drawer
        title={editing ? t('एजेंट संपादित करें') : t('नया एजेंट')}
        open={open}
        onClose={onClose}
        width={860}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={onClose}>{t('रद्द')}</Button>
            <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
              {t('सहेजें')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={save.mutate} scrollToFirstError>
          <Divider orientation="left">{t('बुनियादी जानकारी')}</Divider>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="displayName"
                label={t('पूरा नाम')}
                rules={[{ required: true, message: t('नाम डालें') }, { min: 2 }]}
              >
                <Input prefix={<UserOutlined />} placeholder={t('पूरा नाम')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="email"
                label={t('ईमेल पता')}
                rules={[
                  { required: true, message: t('ईमेल ज़रूरी है') },
                  { type: 'email', message: t('सही ईमेल डालें') },
                ]}
                extra={
                  editing
                    ? t('बदलने पर एजेंट को नए ईमेल से लॉगिन करना होगा')
                    : t('एजेंट इसी से लॉगिन करेगा')
                }
              >
                <Input prefix={<MailOutlined />} placeholder="agent@example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="phone"
                label={t('मोबाइल नंबर')}
                rules={[{ pattern: /^[0-9]{10}$/, message: t('10 अंकों का नंबर') }]}
              >
                <Input prefix={<PhoneOutlined />} placeholder={t('10 अंकों का नंबर')} maxLength={10} />
              </Form.Item>
            </Col>

            <Col xs={12} md={8}>
              <Form.Item name="dateJoin" label={t('जुड़ने की तारीख')}>
                <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="active" label={t('सक्रिय')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">{t('पता')}</Divider>

          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item name="address" label={t('पूरा पता')}>
                <Input.TextArea rows={2} placeholder={t('पूरा पता')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="city" label={t('शहर')}>
                <Input placeholder={t('शहर')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="state" label={t('राज्य')}>
                <Select
                  allowClear
                  showSearch
                  placeholder={t('राज्य चुनें')}
                  options={masters.states}
                  onChange={() => form.setFieldValue('district', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="district" label={t('ज़िला')}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('ज़िला चुनें')}
                  disabled={!selectedState}
                  options={masters.districtsFor(selectedState)}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item
                name="pinCode"
                label={t('पिन कोड')}
                rules={[{ pattern: /^\d{6}$/, message: t('6 अंक') }]}
              >
                <Input maxLength={6} placeholder={t('6 अंकों का पिन')} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">{t('दस्तावेज़')}</Divider>

          <Row gutter={16}>
            <Col xs={12} md={8}>
              <PhotoUpload
                label={t('प्रोफ़ाइल फोटो')}
                crop
                value={files.photo ?? agent?.photoURL}
                onChange={(url) => setFiles((f) => ({ ...f, photo: url }))}
              />
            </Col>
            <Col xs={12} md={8}>
              <PhotoUpload
                label={t('हस्ताक्षर')}
                value={files.signature ?? agent?.signatureURL}
                onChange={(url) => setFiles((f) => ({ ...f, signature: url }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <MultiFileUpload
                label={t('आईडी दस्तावेज़ (अधिकतम 5)')}
                max={5}
                value={files.documents ?? agent?.documentURLs ?? []}
                onChange={(urls) => setFiles((f) => ({ ...f, documents: urls }))}
              />
            </Col>
          </Row>

          {renaming && myMembers > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('नाम बदलने पर {n} सदस्यों पर भी एजेंट का नाम बदल जाएगा', { n: myMembers.toLocaleString('en-IN') })}
              description={t('सदस्य के रिकॉर्ड में एजेंट का नाम भी लिखा होता है — इसी से सूची में एजेंट दिखता है और छँटाई होती है। सहेजते ही सब जगह सुधर जाएगा।')}
            />
          )}

          <Divider orientation="left">{t('लॉगिन')}</Divider>

          {editing ? (
            <Row gutter={16}>
              <Col xs={24}>
                {/* Password changing is its own action, not a field. A field
                    would be applied silently alongside a name change; this
                    revokes the agent's sessions and shows the result once. */}
                <Space wrap>
                  <Popconfirm
                    title={t('नया पासवर्ड बनाएँ?')}
                    description={t('पुराना पासवर्ड तुरंत बंद हो जाएगा और एजेंट हर डिवाइस से लॉग आउट हो जाएगा।')}
                    okText={t('बनाएँ')}
                    cancelText={t('रद्द')}
                    onConfirm={() => resetPassword.mutate()}
                  >
                    <Button icon={<KeyOutlined />} loading={resetPassword.isPending}>
                      {t('नया पासवर्ड बनाएँ')}
                    </Button>
                  </Popconfirm>
                  {/* Changing the person, not just their password. Sits here
                      because this is where an admin looks when someone leaves. */}
                  <Button icon={<SwapOutlined />} onClick={() => setHandingOver(true)}>
                    {t('किसी और को यह पद दें')}
                  </Button>
                </Space>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('पासवर्ड कहीं सहेजा नहीं जाता — भूलने पर नया बनाना ही रास्ता है। एजेंट काम छोड़ दे तो “किसी और को यह पद दें” से उसके सदस्य और कमीशन इतिहास वहीं रहते हैं।')}
                  </Text>
                </div>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="password"
                  label={t('पासवर्ड')}
                  extra={t('खाली छोड़ें तो अपने-आप बनेगा और सहेजने के बाद एक बार दिखेगा')}
                  rules={[{ min: 6, message: t('कम से कम 6 अक्षर') }]}
                >
                  <Input.Password placeholder={t('अपने-आप बनेगा')} autoComplete="new-password" />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Divider orientation="left">{t('कमीशन')}</Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('दो अलग-अलग कमीशन')}
            description={
              <Text style={{ fontSize: 13 }}>
                <strong>{t('जॉइनिंग फीस')}</strong> — {t('नया सदस्य जोड़ने पर।')}{' '}
                <strong>{t('वसूली')}</strong> — {t('क्लोजिंग का भुगतान इकट्ठा करने पर। दोनों हर रसीद के साथ उसी transaction में दर्ज होते हैं, इसलिए कमीशन और वसूली कभी अलग नहीं हो सकते।')}
              </Text>
            }
          />

          <Form.Item
            name="useOverride"
            label={t('इस एजेंट के लिए अलग नियम')}
            valuePropName="checked"
            extra={t('बंद रखें तो योजना का सामान्य नियम लागू होगा')}
          >
            <Switch onChange={setOverride} />
          </Form.Item>

          {override && (
            <>
              <RuleFields prefix="joinFee" title={t('जॉइनिंग फीस पर')} />
              <RuleFields prefix="collection" title={t('वसूली पर')} />
            </>
          )}
        </Form>
      </Drawer>

      <AgentHandover
        agent={agent}
        open={handingOver}
        onClose={() => {
          setHandingOver(false);
          // The agent in this form is now a different person; reopening it
          // from the list is the honest way back in.
          onClose();
        }}
      />

      <CredentialsModal
        credentials={credentials}
        onClose={() => {
          const wasReset = credentials?.reset;
          setCredentials(null);
          // A reset happens while editing — dismissing the password should
          // leave the admin where they were, not throw them out of the form
          // they are still filling in. Only a newly created agent closes it.
          if (!wasReset) onClose();
        }}
      />
    </>
  );
}

/**
 * The password exists in readable form exactly once — here. It is hashed by
 * Firebase Auth and never written to Firestore, so this dialog is deliberately
 * hard to dismiss by accident.
 */
function CredentialsModal({ credentials, onClose }) {
  const { message } = App.useApp();
  const t = useT();
  if (!credentials) return null;

  return (
    <Modal
      title={credentials.reset ? t('नया पासवर्ड') : t('एजेंट बन गया — लॉगिन विवरण')}
      open
      onCancel={onClose}
      maskClosable={false}
      footer={[
        <Button
          key="copy"
          onClick={() => {
            navigator.clipboard
              ?.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`)
              .then(() => message.success(t('कॉपी हो गया')))
              .catch(() => message.warning(t('कॉपी नहीं हुआ — हाथ से नोट कर लें')));
          }}
        >
          {t('कॉपी करें')}
        </Button>,
        <Button key="ok" type="primary" onClick={onClose}>
          {t('नोट कर लिया')}
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('यह पासवर्ड दोबारा नहीं दिखेगा')}
        description={t('पासवर्ड कहीं सुरक्षित नहीं रखा जाता — अभी नोट कर लें या एजेंट को भेज दें। भूल जाने पर सिर्फ़ रीसेट ही रास्ता है।')}
      />
      <Card size="small">
        <Paragraph style={{ marginBottom: 8 }}>
          <Text type="secondary">{t('ईमेल')}</Text>
          <br />
          <Text copyable strong>{credentials.email}</Text>
        </Paragraph>
        <Paragraph style={{ marginBottom: 0 }}>
          <Text type="secondary">{t('पासवर्ड')}</Text>
          <br />
          <Text copyable strong style={{ fontSize: 18, fontFamily: 'monospace' }}>
            {credentials.password}
          </Text>
        </Paragraph>
      </Card>
    </Modal>
  );
}

function RuleFields({ prefix, title }) {
  const t = useT();
  return (
    <Card size="small" title={title} style={{ marginBottom: 12 }}>
      <Row gutter={12}>
        <Col xs={24} md={6}>
          <Form.Item name={[prefix, 'enabled']} label={t('चालू')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
        <Col xs={12} md={10}>
          <Form.Item name={[prefix, 'mode']} label={t('तरीका')}>
            <Select
              options={[
                { label: t('प्रतिशत (%)'), value: COMMISSION_MODE.PERCENT },
                { label: t('निश्चित राशि (₹)'), value: COMMISSION_MODE.FIXED },
                { label: t('प्रति क्लोजिंग (₹)'), value: COMMISSION_MODE.FIXED_PER_CLOSING },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name={[prefix, 'value']} label={t('मान')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </Card>
  );
}

const blankRule = () => ({ enabled: false, mode: COMMISSION_MODE.PERCENT, value: 0 });
