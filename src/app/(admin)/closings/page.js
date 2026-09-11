'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal, Progress, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, UndoOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import PageHeader from '../../../components/ui/PageHeader.js';
import ClosingBatches, { BatchFormModal } from '../../../components/closings/ClosingBatches.js';
import DataGrid, { inr, money, dateCell } from '../../../components/ui/DataGrid.js';
import { api, keys } from '../../../lib/api.js';
import { useMasters } from '../../../lib/useMasters.js';
import { useT } from '../../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * Closings.
 *
 * The whole list is ONE Firestore read — it comes from the shared closings
 * index document rather than 500 individual documents. Creating a closing is
 * one transaction and five writes, whatever the size of the trust, because no
 * obligation rows are materialised.
 */
export default function ClosingsPage() {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const query = useQuery({
    queryKey: keys.closings,
    queryFn: () => api.closings.list({ includeReverted: true }),
  });

  const closings = query.data?.closings ?? [];

  const totals = useMemo(() => {
    const active = closings.filter((c) => c.status !== 'reverted');
    return { total: closings.length, active: active.length };
  }, [closings]);

  const columns = useMemo(
    () => [
      { headerName: t('क्रम'), field: 'seq', width: 90, pinned: 'left', sort: 'desc' },
      { headerName: t('नाम'), field: 'name', flex: 1, minWidth: 160, pinned: 'left' },
      { headerName: t('रजि.'), field: 'regNo', width: 100 },
      { headerName: t('पिता'), field: 'fatherName', flex: 1, minWidth: 140 },
      { headerName: t('गाँव'), field: 'village', width: 130 },
      { headerName: t('तिथि'), field: 'dateMs', width: 120, valueFormatter: dateCell },
      {
        headerName: t('प्रति क्लोजिंग'),
        field: 'amount',
        width: 120,
        type: 'rightAligned',
        valueFormatter: money,
      },
      {
        headerName: t('समूह'),
        field: 'batchId',
        width: 110,
        // The id is meaningless on screen; what matters is whether this
        // closing is on a notice at all. One that is not will never be billed
        // on paper, and that is worth seeing in the list rather than finding
        // out when the sheet comes back short.
        cellRenderer: (p) =>
          p.value ? <Tag color="gold">{t('समूह में')}</Tag> : <Tag>{t('बिना समूह')}</Tag>,
      },
      {
        headerName: t('स्थिति'),
        field: 'status',
        width: 110,
        cellRenderer: (p) =>
          p.value === 'reverted' ? <Tag color="red">{t('वापस लिया')}</Tag> : <Tag color="blue">{t('चालू')}</Tag>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      <PageHeader
        title={t('क्लोजिंग')}
        subtitle={`${totals.active} ${t('चालू')} · ${totals.total} ${t('कुल')} — ${t('पूरी सूची 1 read में')}`}
        error={query.error}
        extra={
          <>
            <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('नई क्लोजिंग')}
            </Button>
          </>
        }
      />

      <ClosingBatches />

      <DataGrid
        rows={closings}
        columns={columns}
        loading={query.isLoading}
        getRowId={(p) => p.data.id}
        onRowClick={(row) => setDetail(row)}
        emptyText={t('अभी कोई क्लोजिंग नहीं')}
      />

      <CreateClosingModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ClosingDetailDrawer closing={detail} onClose={() => setDetail(null)} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

function CreateClosingModal({ open, onClose }) {
  const t = useT();
  const masters = useMasters();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newBatch, setNewBatch] = useState(null);

  const members = useQuery({
    queryKey: keys.closable(search),
    queryFn: () => api.closings.closable(search),
    enabled: open,
  });

  // Only OPEN batches: a batch that has been issued is a sheet already in
  // people's hands, and adding a name to it after the fact would bill for
  // something nobody was told about.
  const batches = useQuery({
    queryKey: keys.closingBatches,
    queryFn: () => api.closingBatches.list(),
    enabled: open,
    select: (d) => (d.batches ?? []).filter((b) => b.status !== 'issued'),
  });

  const save = useMutation({
    mutationFn: (values) =>
      api.closings.create({
        ...values,
        closingDate: values.closingDate.format('DD-MM-YYYY'),
        closingDateMs: values.closingDate.startOf('day').valueOf(),
      }),
    onSuccess: (res) => {
      message.success(t('क्लोजिंग #{seq} बन गई', { seq: res.closing.seq }));
      queryClient.invalidateQueries({ queryKey: keys.closings });
      queryClient.invalidateQueries({ queryKey: keys.closingBatches });
      queryClient.invalidateQueries({ queryKey: keys.stats });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      form.resetFields();
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Modal
      title={t('नई क्लोजिंग')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText={t('क्लोजिंग करें')}
      cancelText={t('रद्द')}
      width={620}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('कोई pending row नहीं बनेगी')}
        description={
          <Text style={{ fontSize: 13 }}>
            {t('पुराने सिस्टम में यहाँ हर सदस्य के लिए एक row बनती थी — 5000 सदस्य यानी 5000 writes। अब सिर्फ़ 5 writes होती हैं। कौन क्या देगा, यह तारीख़ से अपने-आप तय होता है।')}
          </Text>
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={save.mutate}
        initialValues={{ closingDate: dayjs(), closingType: 'marriage' }}
      >
        <Form.Item
          name="memberId"
          label={t('सदस्य')}
          rules={[{ required: true, message: t('सदस्य चुनें') }]}
          extra={t('सिर्फ़ स्वीकृत सदस्य दिखते हैं जिनकी क्लोजिंग अभी नहीं हुई')}
        >
          <Select
            showSearch
            placeholder={t('नाम या रजि. नंबर से खोजें')}
            loading={members.isLoading}
            onSearch={setSearch}
            filterOption={false}
            options={(members.data?.members ?? []).map((m) => ({
              label: `${m.registrationNumber} — ${m.displayName}${m.village ? ` (${m.village})` : ''}`,
              value: m.id,
            }))}
            onChange={(id) => {
              const m = (members.data?.members ?? []).find((x) => x.id === id);
              if (m) form.setFieldValue('amountPerMember', m.payAmount || 200);
            }}
          />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="closingDate"
              label={t('क्लोजिंग तिथि')}
              rules={[{ required: true }]}
              extra={t('इसी तारीख़ से तय होता है कौन भुगतान करेगा')}
            >
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="closingType" label={t('प्रकार')}>
              <Select options={masters.closingTypes} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="amountPerMember" label={t('प्रति सदस्य राशि')}>
          <InputNumber min={1} prefix="₹" style={{ width: '100%' }} />
        </Form.Item>

        {/* Which sheet this closing goes out on. Optional — a closing with no
            batch is still a perfectly good closing and members still owe it;
            it just will not appear on a printed notice until it is put in
            one. */}
        <Form.Item
          name="batchId"
          label={t('क्लोजिंग समूह')}
          extra={t('इसी समूह की सूचना में यह क्लोजिंग छपेगी')}
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={batches.isLoading}
            placeholder={t('समूह चुनें (वैकल्पिक)')}
            options={(batches.data ?? []).map((b) => ({
              label: `${b.name} (${b.closingCount ?? 0})`,
              value: b.id,
            }))}
            popupRender={(menu) => (
              <>
                {menu}
                <div style={{ padding: 8, borderTop: '1px solid var(--line, #f0f0f0)' }}>
                  <Button
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setNewBatch({})}
                  >
                    {t('नया समूह बनाएँ')}
                  </Button>
                </div>
              </>
            )}
          />
        </Form.Item>

        <Form.Item name="notes" label={t('टिप्पणी')}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>

      {/* Created from inside the picker and selected straight away, so an
          operator who realises mid-closing that this month has no batch yet
          does not have to abandon the form to make one. */}
      <BatchFormModal
        batch={newBatch}
        onClose={() => setNewBatch(null)}
        onCreated={(created) => {
          batches.refetch();
          form.setFieldValue('batchId', created.id);
        }}
      />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

function ClosingDetailDrawer({ closing, onClose }) {
  const t = useT();
  const open = Boolean(closing);
  const [revertOpen, setRevertOpen] = useState(false);

  const [rowFilter, setRowFilter] = useState('pending');
  const [rowSearch, setRowSearch] = useState('');

  const detail = useQuery({
    queryKey: keys.closingCollection(closing?.id),
    // 500, not 100: this is the collection sheet, and a sheet that stops at a
    // hundred names is a sheet somebody has to ask for again.
    queryFn: () => api.closings.collection(closing.id, { limit: 500 }),
    enabled: open,
  });

  const c = detail.data?.closing;
  const bands = detail.data?.byAgeBand ?? [];

  const rows = useMemo(() => {
    const all = detail.data?.rows ?? [];
    const q = rowSearch.trim().toLowerCase();

    return all.filter((r) => {
      if (rowFilter !== 'all' && r.status !== rowFilter) return false;
      if (!q) return true;
      return [r.displayName, r.registrationNumber, r.phone, r.village, r.fatherName]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [detail.data, rowFilter, rowSearch]);
  const pct = c?.eligibleCount ? Math.round((c.paidCount / c.eligibleCount) * 100) : 0;

  return (
    <Drawer
      title={closing ? t('क्लोजिंग #{seq} — {name}', { seq: closing.seq, name: closing.name }) : ''}
      open={open}
      onClose={onClose}
      width={800}
      destroyOnHidden
      extra={
        closing?.status !== 'reverted' && (
          <Button danger icon={<UndoOutlined />} onClick={() => setRevertOpen(true)}>
            {t('वापस लें')}
          </Button>
        )
      }
    >
      {c && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={12}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('वसूली')} value={inr(c.paidAmount)} valueStyle={{ color: 'var(--paid)', fontSize: 20 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('बकाया')} value={inr(c.pendingAmount)} valueStyle={{ color: 'var(--due)', fontSize: 20 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('भुगतान किया')} value={`${c.paidCount} / ${c.eligibleCount}`} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('प्रति सदस्य')} value={inr(c.amountPerMember)} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
          </Row>

          <Card size="small">
            <Progress percent={pct} status={pct === 100 ? 'success' : 'active'} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('ये आँकड़े क्लोजिंग document के counters से आते हैं — 1 read।')}
            </Text>
          </Card>

          {/* ── who owes, by age band ───────────────────────────────────
              The band decides the contribution, so this is the breakdown
              anyone checking a collection sheet against the programme's rate
              card actually needs — "180 at ₹200, 60 at ₹300", not one total. */}
          {bands.length > 0 && (
            <Card size="small" title={t('आयु समूह के अनुसार')}>
              <Table
                size="small"
                rowKey="band"
                pagination={false}
                dataSource={bands}
                summary={(data) => {
                  const sum = (k) => data.reduce((a, b) => a + (b[k] ?? 0), 0);
                  return (
                    <Table.Summary.Row style={{ fontWeight: 600 }}>
                      <Table.Summary.Cell>{t('कुल')}</Table.Summary.Cell>
                      <Table.Summary.Cell align="right">{sum('total')}</Table.Summary.Cell>
                      <Table.Summary.Cell align="right">{sum('paid')}</Table.Summary.Cell>
                      <Table.Summary.Cell align="right">{sum('pending')}</Table.Summary.Cell>
                      <Table.Summary.Cell align="right">
                        {inr(sum('pendingAmount'))}
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
                columns={[
                  { title: t('आयु समूह'), dataIndex: 'band' },
                  { title: t('सदस्य'), dataIndex: 'total', width: 80, align: 'right' },
                  {
                    title: t('जमा'),
                    dataIndex: 'paid',
                    width: 80,
                    align: 'right',
                    render: (v) => <Text style={{ color: 'var(--paid)' }}>{v}</Text>,
                  },
                  {
                    title: t('बकाया'),
                    dataIndex: 'pending',
                    width: 80,
                    align: 'right',
                    render: (v) => (
                      <Text style={{ color: v ? 'var(--due)' : undefined }}>{v}</Text>
                    ),
                  },
                  {
                    title: t('बकाया राशि'),
                    dataIndex: 'pendingAmount',
                    width: 120,
                    align: 'right',
                    render: (v) => inr(v),
                  },
                ]}
              />
            </Card>
          )}

          {/* ── the members themselves ──────────────────────────────────── */}
          <Card
            size="small"
            title={t('सदस्य')}
            extra={
              <Space>
                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined />}
                  placeholder={t('नाम, रजि. नं., गाँव…')}
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  style={{ width: 200 }}
                />
                <Segmented
                  size="small"
                  value={rowFilter}
                  onChange={setRowFilter}
                  options={[
                    { value: 'pending', label: t('बकाया') },
                    { value: 'paid', label: t('जमा') },
                    { value: 'all', label: t('सभी') },
                  ]}
                />
              </Space>
            }
          >
            <Table
              size="small"
              rowKey="id"
              loading={detail.isLoading}
              dataSource={rows}
              pagination={{ pageSize: 25, size: 'small', showSizeChanger: false }}
              locale={{ emptyText: t('कोई सदस्य नहीं') }}
              columns={[
                { title: t('रजि.'), dataIndex: 'registrationNumber', width: 90 },
                {
                  title: t('नाम'),
                  dataIndex: 'displayName',
                  render: (v, row) => (
                    <div style={{ lineHeight: 1.3 }}>
                      <div>{v || '—'}</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {[row.fatherName, row.village].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                  ),
                },
                { title: t('आयु समूह'), dataIndex: 'ageGroupRange', width: 100 },
                { title: t('मोबाइल'), dataIndex: 'phone', width: 120 },
                { title: t('एजेंट'), dataIndex: 'agentName', width: 130 },
                {
                  title: t('राशि'),
                  dataIndex: 'amount',
                  width: 100,
                  align: 'right',
                  render: (v) => inr(v),
                },
                {
                  title: t('स्थिति'),
                  dataIndex: 'status',
                  width: 90,
                  render: (v) =>
                    v === 'paid' ? <Tag color="green">{t('जमा')}</Tag>
                    : v === 'exempt' ? <Tag>{t('छूट')}</Tag>
                    : <Tag color="red">{t('बकाया')}</Tag>,
                },
              ]}
            />
          </Card>

          <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={t('रजि. नंबर')}>{c.regNo}</Descriptions.Item>
            <Descriptions.Item label={t('तिथि')}>
              {c.dateMs ? new Date(c.dateMs).toLocaleDateString('hi-IN') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('क्रम संख्या')}>{c.seq}</Descriptions.Item>
            <Descriptions.Item label={t('स्थिति')}>
              {c.status === 'reverted' ? <Tag color="red">{t('वापस लिया')}</Tag> : <Tag color="blue">{t('चालू')}</Tag>}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}

      <RevertModal
        closing={closing}
        open={revertOpen}
        onClose={() => setRevertOpen(false)}
        onDone={onClose}
      />
    </Drawer>
  );
}

function RevertModal({ closing, open, onClose, onDone }) {
  const t = useT();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const revert = useMutation({
    mutationFn: (values) => api.closings.revert(closing.id, values),
    onSuccess: (res) => {
      message.success(
        t('क्लोजिंग वापस ली गई — {n} सदस्य प्रभावित, {amt} क्रेडिट हुआ', {
          n: res.affectedMembers,
          amt: inr(res.reversedAmount),
        }),
      );
      queryClient.invalidateQueries({ queryKey: keys.closings });
      queryClient.invalidateQueries({ queryKey: keys.stats });
      onClose();
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Modal
      title={t('क्लोजिंग वापस लें')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={revert.isPending}
      okText={t('वापस लें')}
      okButtonProps={{ danger: true }}
      cancelText={t('रद्द')}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('कोई भुगतान रिकॉर्ड नहीं मिटेगा')}
        description={
          <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
            {t('पुराना सिस्टम इस समय सारे payment records {del} कर देता था — किसने भुगतान किया था, वो इतिहास हमेशा के लिए चला जाता था। अब सिर्फ़ उन्हीं सदस्यों को छुआ जाता है जिन्होंने वाकई भुगतान किया था, रसीदें बनी रहती हैं, और पैसा उनके क्रेडिट में चला जाता है। पूरा रिकॉर्ड audit log में दर्ज होता है।', {
              del: <strong>{t('डिलीट')}</strong>,
            })}
          </Paragraph>
        }
      />

      <Form form={form} layout="vertical" onFinish={revert.mutate} initialValues={{ refundMode: 'keep' }}>
        <Form.Item
          name="reason"
          label={t('कारण')}
          rules={[{ required: true, min: 3, message: t('कारण लिखें — यह रिकॉर्ड में जाता है') }]}
        >
          <Input.TextArea rows={3} placeholder={t('क्यों वापस लिया जा रहा है?')} />
        </Form.Item>

        <Form.Item name="refundMode" label={t('जमा हुए पैसे का क्या करें')}>
          <Select
            options={[
              { label: t('सदस्य के क्रेडिट में रखें (सुझाया गया)'), value: 'keep' },
              { label: t('रसीद की लाइनें रद्द करें'), value: 'cancel' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
