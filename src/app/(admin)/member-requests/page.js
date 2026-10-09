'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Avatar, Button, Card, DatePicker, Descriptions, Drawer, Empty, Form, Grid, Image,
  Input, InputNumber, Modal, Segmented, Select, Space, Spin, Table, Tag, Typography,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, ReloadOutlined, UserOutlined, EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import PageHeader from '../../../components/ui/PageHeader.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Text } = Typography;

const STATUS = {
  pending: { color: 'orange', label: 'लंबित' },
  approving: { color: 'processing', label: 'स्वीकार हो रहा' },
  approved: { color: 'green', label: 'स्वीकार हुए' },
  rejected: { color: 'red', label: 'अस्वीकृत' },
};

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const dmy = (ms) => (ms ? dayjs(ms).format('DD-MM-YYYY') : '—');

/**
 * सदस्य अनुरोध — members an agent has asked the office to add, from the agent
 * app. Review the details and photos, then:
 *
 *   स्वीकार — creates the member through the same path as the counter (rates
 *             from the age band, next registration number, a real receipt
 *             for any joining fee the agent took, the agent's commission)
 *   अस्वीकार — with a reason the agent reads in their app
 *   हटाएँ    — takes a request that will not be acted on out of the list
 */
export default function MemberRequestsPage() {
  const t = useT();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [agentId, setAgentId] = useState(undefined);
  const [open, setOpen] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const list = useQuery({
    queryKey: keys.memberRequests({ status, agentId }),
    queryFn: () => api.memberRequests.list({ status, agentId }),
  });
  const agents = useQuery({ queryKey: [...keys.agents, 'all'], queryFn: () => api.agents.list({ includeInactive: true }) });

  const rows = list.data?.requests ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['member-requests'] });
    queryClient.invalidateQueries({ queryKey: ['members'] });
    queryClient.invalidateQueries({ queryKey: keys.stats });
  };

  const remove = useMutation({
    mutationFn: (id) => api.memberRequests.remove(id),
    onSuccess: () => { message.success(t('अनुरोध हटा दिया गया')); setOpen(null); refresh(); },
    onError: (e) => message.error(e.message),
  });

  const columns = useMemo(() => [
    {
      title: t('सदस्य'),
      key: 'name',
      render: (_, r) => (
        <Space>
          <Avatar src={r.photoURL || undefined} icon={<UserOutlined />} />
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600 }}>{r.displayName}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.fatherName || '—'} · {r.village}</Text>
          </div>
        </Space>
      ),
    },
    { title: t('योजना'), dataIndex: 'programName', responsive: ['lg'] },
    { title: t('मोबाइल'), dataIndex: 'phone', responsive: ['md'] },
    { title: t('एजेंट'), dataIndex: 'agentName', responsive: ['md'] },
    {
      title: t('शुल्क लिया'), key: 'fee', responsive: ['lg'], align: 'right',
      render: (_, r) => `${inr(r.joinFeesCollected)} / ${inr(r.joinFees)}`,
    },
    { title: t('भेजा'), key: 'at', responsive: ['lg'], render: (_, r) => dmy(r.createdAtMs) },
    {
      title: t('स्थिति'), key: 'status',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Tag color={STATUS[r.status]?.color}>{t(STATUS[r.status]?.label ?? r.status)}</Tag>
          {r.status === 'approved' ? <Text type="secondary" style={{ fontSize: 12 }}>{t('रजि.')} {r.registrationNumber}</Text> : null}
        </Space>
      ),
    },
    {
      title: '', key: 'go', width: 60,
      render: (_, r) => <Button type="text" icon={<EyeOutlined />} onClick={() => setOpen(r)} aria-label={t('देखें')} />,
    },
  ], [t]);

  return (
    <>
      <PageHeader
        title={t('सदस्य अनुरोध')}
        subtitle={t('एजेंट ऐप से आए नए सदस्य — जाँचें, स्वीकार या अस्वीकार करें')}
        error={list.error?.message}
        extra={<Button icon={<ReloadOutlined />} onClick={refresh}>{t('ताज़ा करें')}</Button>}
      />

      <Card styles={{ body: { padding: isMobile ? 12 : 20 } }}>
        <Space wrap style={{ marginBottom: 14 }}>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: t('लंबित') },
              { value: 'approved', label: t('स्वीकार हुए') },
              { value: 'rejected', label: t('अस्वीकृत') },
              { value: 'all', label: t('सभी') },
            ]}
          />
          <Select
            allowClear
            placeholder={t('सभी एजेंट')}
            style={{ minWidth: 180 }}
            value={agentId}
            onChange={setAgentId}
            options={(agents.data?.agents ?? []).map((a) => ({ value: a.id, label: a.displayName }))}
          />
        </Space>

        <Table
          rowKey="id"
          size={isMobile ? 'small' : 'middle'}
          loading={list.isLoading}
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty description={t('कोई अनुरोध नहीं')} /> }}
        />
      </Card>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        width={isMobile ? '100%' : 560}
        title={open ? `${open.displayName} — ${t('सदस्य अनुरोध')}` : ''}
        extra={open ? <Tag color={STATUS[open.status]?.color}>{t(STATUS[open.status]?.label ?? open.status)}</Tag> : null}
        footer={open && open.status === 'pending' ? (
          <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button danger icon={<DeleteOutlined />} loading={remove.isPending}
              onClick={() => modal.confirm({
                title: t('यह अनुरोध हटाएँ?'),
                content: t('एजेंट को यह अनुरोध सूची में नहीं दिखेगा।'),
                okButtonProps: { danger: true },
                okText: t('हटाएँ'),
                onOk: () => remove.mutateAsync(open.id),
              })}
            >
              {t('हटाएँ')}
            </Button>
            <Button icon={<CloseOutlined />} onClick={() => setRejecting(open)}>{t('अस्वीकार')}</Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={() => setApproving(open)}>{t('स्वीकार करें')}</Button>
          </Space>
        ) : open && open.status === 'rejected' ? (
          <Button danger icon={<DeleteOutlined />} loading={remove.isPending} onClick={() => remove.mutate(open.id)}>{t('सूची से हटाएँ')}</Button>
        ) : null}
      >
        {open ? <RequestDetail r={open} t={t} /> : null}
      </Drawer>

      <ApproveModal
        request={approving}
        onClose={() => setApproving(null)}
        onDone={(res) => {
          setApproving(null);
          setOpen(null);
          refresh();
          modal.success({
            title: t('सदस्य जुड़ गया'),
            content: (
              <div>
                {t('रजि. नंबर')}: <b>{res.member?.registrationNumber}</b>
                {res.member?.joinFeesPaid ? <div>{t('नामांकन शुल्क रसीद बनी')}: {inr(res.member.joinFeesPaid)}</div> : null}
                {res.login?.created ? (
                  <div style={{ marginTop: 6 }}>
                    {t('सदस्य ऐप लॉगिन')}: <b>{res.login.loginId}</b> · {t('पासवर्ड')}: <b>{res.login.password}</b> ({t('मोबाइल नंबर')})
                  </div>
                ) : res.login?.existed ? (
                  <div style={{ marginTop: 6 }}>{t('सदस्य ऐप लॉगिन पहले से है')}: <b>{res.login.loginId}</b></div>
                ) : res.login?.reason ? (
                  <div style={{ marginTop: 6, color: '#c77e12' }}>{t('सदस्य ऐप लॉगिन नहीं बना')}: {res.login.reason}</div>
                ) : null}
                <div style={{ marginTop: 8 }}><Link href="/members">{t('सदस्य सूची खोलें')} →</Link></div>
              </div>
            ),
          });
        }}
      />
      <RejectModal
        request={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => { setRejecting(null); setOpen(null); refresh(); message.success(t('अनुरोध अस्वीकार किया गया')); }}
      />
    </>
  );
}

function RequestDetail({ r, t }) {
  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {r.lastError && r.status === 'pending' ? (
        <Alert type="warning" showIcon message={t('पिछली स्वीकृति नहीं हो सकी')} description={r.lastError} />
      ) : null}
      {r.status === 'rejected' ? <Alert type="error" showIcon message={t('अस्वीकार का कारण')} description={r.rejectReason} /> : null}
      {r.status === 'approved' ? (
        <Alert type="success" showIcon message={`${t('स्वीकार हुए')} — ${t('रजि.')} ${r.registrationNumber}`} description={r.reviewedByName ? `${r.reviewedByName} · ${dmy(r.reviewedAtMs)}` : dmy(r.reviewedAtMs)} />
      ) : null}

      <Space size={12} wrap>
        {[
          ['सदस्य का फोटो', r.photoURL], ['वारिसदार फोटो', r.extraImageURL],
          ['दस्तावेज़ (आगे)', r.documentFrontURL], ['दस्तावेज़ (पीछे)', r.documentBackURL],
          ['वारिसदार का दस्तावेज़', r.guardianDocumentURL],
        ].map(([label, url]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            {url && /\.pdf\?|%2F[^?]*\.pdf/i.test(url) ? (
              <a href={url} target="_blank" rel="noreferrer" style={{ width: 96, height: 96, borderRadius: 10, background: 'var(--bg)', display: 'grid', placeItems: 'center', fontSize: 13 }}>PDF ↗</a>
            ) : url ? <Image src={url} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 10 }} /> : (
              <div style={{ width: 96, height: 96, borderRadius: 10, background: 'var(--bg)', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>{t('नहीं')}</div>
            )}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t(label)}</div>
          </div>
        ))}
      </Space>

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('योजना')}>{r.programName}</Descriptions.Item>
        <Descriptions.Item label={t('नाम')}>{r.displayName}</Descriptions.Item>
        <Descriptions.Item label={t('पिता / पति')}>{r.fatherName || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('लिंग')}>{r.gender || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('जन्म तिथि')}>{dmy(r.bobDateMs)} {r.age != null ? `(${r.age})` : ''}</Descriptions.Item>
        <Descriptions.Item label={t('जुड़ने की तिथि')}>{dmy(r.joinDateMs)}</Descriptions.Item>
        <Descriptions.Item label={t('आयु समूह / दर')}>{r.ageGroupRange || '—'} · {inr(r.payAmount)} {t('प्रति क्लोजिंग')}</Descriptions.Item>
        <Descriptions.Item label={t('नामांकन शुल्क')}>{inr(r.joinFees)} — {t('एजेंट ने लिया')} {inr(r.joinFeesCollected)} ({r.joinFeesMethod}{r.joinFeesReference ? ` · ${r.joinFeesReference}` : ''})</Descriptions.Item>
        <Descriptions.Item label={t('जाति / गोत्र')}>{[r.jati, r.gotra].filter(Boolean).join(' / ') || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('संरक्षक')}>{r.guardian ? `${r.guardian} (${r.guardianRelation || '—'})` : '—'}</Descriptions.Item>
        <Descriptions.Item label={t('मोबाइल')}>{r.phone}{r.phoneAlt ? `, ${r.phoneAlt}` : ''}</Descriptions.Item>
        <Descriptions.Item label={t('आधार')}>{r.aadhaarNo || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('पता')}>{[r.currentAddress, r.village, r.district, r.state, r.pinCode].filter(Boolean).join(', ') || '—'}</Descriptions.Item>
        {(r.extraDetails ?? []).map((d, i) => (
          <Descriptions.Item key={`x${i}`} label={d.label || '—'}>{d.value || '—'}</Descriptions.Item>
        ))}
        <Descriptions.Item label={t('एजेंट')}>{r.agentName}{r.agentPhone ? ` · ${r.agentPhone}` : ''}</Descriptions.Item>
        <Descriptions.Item label={t('भेजा')}>{dmy(r.createdAtMs)}</Descriptions.Item>
        {r.note ? <Descriptions.Item label={t('नोट')}>{r.note}</Descriptions.Item> : null}
      </Descriptions>
    </Space>
  );
}

function ApproveModal({ request, onClose, onDone }) {
  const t = useT();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const approve = useMutation({
    mutationFn: (v) => api.memberRequests.approve(request.id, {
      registrationNumber: v.registrationNumber?.trim() || undefined,
      joinDateMs: v.joinDate ? v.joinDate.startOf('day').valueOf() : undefined,
      joinDate: v.joinDate ? v.joinDate.format('DD-MM-YYYY') : undefined,
      joinFeesPaidNow: v.joinFeesPaidNow ?? 0,
      joinFeesMethod: v.joinFeesMethod,
      joinFeesReference: v.joinFeesReference ?? '',
      note: v.note ?? '',
    }),
    onSuccess: onDone,
    onError: (e) => message.error(e.message, 6),
  });

  return (
    <Modal
      open={Boolean(request)}
      onCancel={onClose}
      title={request ? `${t('स्वीकार करें')} — ${request.displayName}` : ''}
      okText={t('स्वीकार करें और सदस्य बनाएँ')}
      cancelText={t('रद्द करें')}
      onOk={() => form.submit()}
      confirmLoading={approve.isPending}
      destroyOnHidden
      afterOpenChange={(o) => {
        if (o && request) {
          form.setFieldsValue({
            joinDate: request.joinDateMs ? dayjs(request.joinDateMs) : dayjs(),
            joinFeesPaidNow: request.joinFeesCollected ?? 0,
            joinFeesMethod: request.joinFeesMethod || 'cash',
            joinFeesReference: request.joinFeesReference || '',
          });
        }
      }}
    >
      {request ? (
        <Form form={form} layout="vertical" onFinish={(v) => approve.mutate(v)}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 14 }}>
            {t('सदस्य {agent} के अंतर्गत जुड़ेगा। दर और शुल्क योजना के आयु समूह से तय होंगे।', { agent: request.agentName })}
          </Text>
          <Form.Item name="registrationNumber" label={t('रजिस्ट्रेशन नंबर')} extra={t('खाली छोड़ें तो अगला नंबर अपने-आप मिलेगा')}>
            <Input placeholder={t('अपने-आप')} />
          </Form.Item>
          <Form.Item name="joinDate" label={t('जुड़ने की तिथि')} rules={[{ required: true }]}>
            <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="joinFeesPaidNow" label={t('नामांकन शुल्क प्राप्त (₹)')} style={{ flex: 1 }}
              extra={t('कुल शुल्क {amt} · एजेंट ने बताया {got}', { amt: inr(request.joinFees), got: inr(request.joinFeesCollected) })}>
              <InputNumber min={0} max={request.joinFees || undefined} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="joinFeesMethod" label={t('माध्यम')} style={{ width: 140 }}>
              <Select options={[
                { value: 'cash', label: t('नकद') }, { value: 'upi', label: 'UPI' }, { value: 'online', label: t('ऑनलाइन') },
                { value: 'cheque', label: t('चेक') }, { value: 'bank', label: t('बैंक') },
              ]} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="joinFeesReference" label={t('रेफ़रेंस')}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label={t('नोट')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      ) : <Spin />}
    </Modal>
  );
}

function RejectModal({ request, onClose, onDone }) {
  const t = useT();
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api.memberRequests.reject(request.id, reason),
    onSuccess: () => { setReason(''); onDone(); },
    onError: (e) => message.error(e.message),
  });
  return (
    <Modal
      open={Boolean(request)}
      onCancel={onClose}
      title={request ? `${t('अस्वीकार')} — ${request.displayName}` : ''}
      okText={t('अस्वीकार करें')}
      okButtonProps={{ danger: true, disabled: reason.trim().length < 2 }}
      cancelText={t('रद्द करें')}
      onOk={() => reject.mutate()}
      confirmLoading={reject.isPending}
      destroyOnHidden
    >
      <Text type="secondary">{t('कारण लिखें — एजेंट इसे अपने ऐप में पढ़ेगा और सुधार कर दोबारा भेज सकेगा।')}</Text>
      <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: 8 }} maxLength={300} showCount />
    </Modal>
  );
}
