'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, AutoComplete, Avatar, Button, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  PlusOutlined, UserOutlined, KeyOutlined, StopOutlined, CheckOutlined,
  CopyOutlined,
} from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { useMasters } from '../../lib/useMasters.js';
import { ROLE } from '../../config/constants.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

const ROLE_LABEL = {
  owner: 'मालिक',
  admin: 'व्यवस्थापक',
  operator: 'ऑपरेटर',
  agent: 'एजेंट',
  member: 'सदस्य',
};

const ROLE_COLOR = {
  owner: 'purple', admin: 'red', operator: 'blue', agent: 'green', member: 'default',
};

/**
 * Who can sign in to the office side.
 *
 * Adding someone creates a real Firebase Auth account with role claims, so
 * "team member" is not a label on a document — it is an account that can log
 * in, scoped to exactly what their role allows.
 *
 * The password appears exactly once, in the dialog after creation. It is never
 * written to Firestore: a password sitting in a document leaks with every read
 * of that document, and the old system stored member passwords in plain text
 * for precisely that reason — convenience. If it is lost the route is a reset,
 * which is the correct answer rather than the convenient one.
 */
export default function TeamTab() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState(null);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const masters = useMasters();

  const query = useQuery({ queryKey: keys.team, queryFn: () => api.trust.team.list() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.team });

  const add = useMutation({
    mutationFn: (values) => api.trust.team.add(values),
    onSuccess: (res) => {
      setCredential({ email: res.user.email, password: res.password, name: res.user.name });
      form.resetFields();
      setOpen(false);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ uid, patch }) => api.trust.team.update(uid, patch),
    onSuccess: () => {
      message.success(t('बदलाव सहेज दिया गया'));
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const reset = useMutation({
    mutationFn: (user) =>
      api.trust.team.resetPassword(user.id).then((r) => ({ ...r, user })),
    onSuccess: (res) => {
      setCredential({
        email: res.user.email,
        password: res.password,
        name: res.user.name,
        reset: true,
      });
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <>
      <Paragraph type="secondary">
        {t('जिन लोगों को इस सिस्टम में लॉग इन करना है। एजेंट यहाँ नहीं — वे “एजेंट” पेज से जुड़ते हैं, क्योंकि उनका कमीशन और सदस्य भी वहीं संभाले जाते हैं।')}
      </Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          {t('नया सदस्य जोड़ें')}
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.users ?? []}
        pagination={false}
        locale={{ emptyText: <Empty description={t('कोई टीम सदस्य नहीं')} /> }}
        columns={[
          {
            title: t('नाम'),
            dataIndex: 'name',
            render: (_, u) => (
              <Space>
                <Avatar src={u.photoURL || undefined} icon={<UserOutlined />} />
                <div style={{ lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 600 }}>{u.name || '—'}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{u.email}</Text>
                </div>
              </Space>
            ),
          },
          { title: t('पद'), dataIndex: 'designation', render: (v) => v || '—' },
          { title: t('फ़ोन'), dataIndex: 'phone', width: 130, render: (v) => v || '—' },
          {
            title: t('भूमिका'),
            dataIndex: 'role',
            width: 190,
            render: (role, u) =>
              role === ROLE.OWNER ? (
                <Tag color={ROLE_COLOR.owner}>{t(ROLE_LABEL.owner)}</Tag>
              ) : (
                <Select
                  size="small"
                  style={{ width: 150 }}
                  value={role}
                  onChange={(v) => update.mutate({ uid: u.id, patch: { role: v } })}
                  options={[ROLE.ADMIN, ROLE.OPERATOR, ROLE.AGENT].map((r) => ({
                    value: r,
                    label: t(ROLE_LABEL[r]),
                  }))}
                />
              ),
          },
          {
            title: t('स्थिति'),
            dataIndex: 'active',
            width: 100,
            render: (active) =>
              active === false
                ? <Tag color="red">{t('बंद')}</Tag>
                : <Tag color="green">{t('चालू')}</Tag>,
          },
          {
            title: '',
            width: 120,
            render: (_, u) => (
              <Space size={4}>
                <Tooltip title={t('नया पासवर्ड बनाएँ')}>
                  <Popconfirm
                    title={t('नया पासवर्ड बनाएँ?')}
                    description={t('पुराना पासवर्ड तुरंत काम करना बंद कर देगा।')}
                    okText={t('बनाएँ')}
                    cancelText={t('रद्द')}
                    onConfirm={() => reset.mutate(u)}
                  >
                    <Button size="small" icon={<KeyOutlined />} />
                  </Popconfirm>
                </Tooltip>

                {u.role !== ROLE.OWNER && (
                  <Tooltip title={u.active === false ? t('फिर चालू करें') : t('लॉग इन बंद करें')}>
                    <Button
                      size="small"
                      danger={u.active !== false}
                      icon={u.active === false ? <CheckOutlined /> : <StopOutlined />}
                      onClick={() =>
                        update.mutate({ uid: u.id, patch: { active: u.active === false } })
                      }
                    />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />

      {/* ── add ──────────────────────────────────────────────────────────── */}
      <Modal
        title={t('नया टीम सदस्य')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={add.isPending}
        okText={t('बनाएँ')}
        cancelText={t('रद्द')}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={add.mutate}
          initialValues={{ role: ROLE.OPERATOR }}
        >
          <Form.Item name="name" label={t('पूरा नाम')}
            rules={[{ required: true, min: 2, message: t('नाम ज़रूरी है') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('ईमेल (यही लॉग इन आईडी होगी)')}
            rules={[{ required: true, type: 'email', message: t('सही ईमेल डालें') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="designation" label={t('पद')}>
            {/* Free text is still allowed — a trust invents a post far more
                often than it edits the master list, and being unable to add
                someone because their title is missing is the wrong trade. */}
            <AutoComplete
              allowClear
              options={masters.designations}
              placeholder={t('जैसे: कोषाध्यक्ष')}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="phone" label={t('फ़ोन')}>
            <Input maxLength={15} />
          </Form.Item>
          <Form.Item name="role" label={t('भूमिका')} rules={[{ required: true }]}
            extra={t('व्यवस्थापक सब कुछ कर सकता है · ऑपरेटर सदस्य और भुगतान संभालता है · एजेंट सिर्फ़ अपने सदस्य देखता है')}>
            <Select options={[ROLE.ADMIN, ROLE.OPERATOR, ROLE.AGENT].map((r) => ({
              value: r, label: t(ROLE_LABEL[r]),
            }))} />
          </Form.Item>
          <Form.Item name="password" label={t('पासवर्ड (खाली छोड़ें तो अपने आप बनेगा)')}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── the one-time password ────────────────────────────────────────── */}
      <Modal
        title={credential?.reset ? t('नया पासवर्ड') : t('खाता बन गया')}
        open={Boolean(credential)}
        onCancel={() => setCredential(null)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setCredential(null)}>
            {t('नोट कर लिया')}
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('यह पासवर्ड दोबारा नहीं दिखेगा')}
          description={t('अभी नोट कर लें या भेज दें। यह कहीं सहेजा नहीं जाता — भूलने पर नया बनाना ही रास्ता है।')}
        />
        <Field label={t('नाम')} value={credential?.name} />
        <Field label={t('ईमेल')} value={credential?.email} copyable />
        <Field label={t('पासवर्ड')} value={credential?.password} copyable mono />
      </Modal>
    </>
  );
}

function Field({ label, value, copyable, mono }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{label}</Text>
      <Text
        strong
        copyable={copyable ? { icon: [<CopyOutlined key="c" />, <CheckOutlined key="d" />] } : false}
        style={mono ? { fontFamily: 'ui-monospace, monospace', fontSize: 15 } : undefined}
      >
        {value ?? '—'}
      </Text>
    </div>
  );
}
