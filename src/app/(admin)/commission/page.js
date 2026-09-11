'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, App,
  Modal, Form, Input, Typography, Alert,
} from 'antd';

import PageHeader from '../../../components/ui/PageHeader.js';
import { inr } from '../../../components/ui/DataGrid.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Text } = Typography;

/**
 * Agent commission.
 *
 * Entries are append-only and written inside the same transaction as the
 * payment that earned them, so commission can never drift from collections.
 * Settling a set of entries into a payout re-reads them inside a transaction
 * and refuses anything already paid.
 */
export default function CommissionPage() {
  const t = useT();
  const [agentId, setAgentId] = useState();
  const [selected, setSelected] = useState([]);
  const [payoutOpen, setPayoutOpen] = useState(false);

  const agents = useQuery({ queryKey: keys.agents, queryFn: () => api.agents.list() });
  const detail = useQuery({
    queryKey: keys.agent(agentId),
    queryFn: () => api.agents.get(agentId),
    enabled: Boolean(agentId),
  });

  const agent = detail.data?.agent;
  const summary = detail.data?.summary ?? {};
  const entries = detail.data?.entries ?? [];
  const policy = detail.data?.policy;

  return (
    <>
      <PageHeader
        title={t('कमीशन')}
        subtitle={t('एजेंट की कमाई और भुगतान')}
        error={detail.error}
        extra={
          <Select
            placeholder={t('एजेंट चुनें')}
            style={{ width: 260 }}
            value={agentId}
            onChange={(v) => {
              setAgentId(v);
              setSelected([]);
            }}
            loading={agents.isLoading}
            showSearch
            optionFilterProp="label"
            options={(agents.data?.agents ?? []).map((a) => ({
              label: `${a.displayName} — ${t('देय')} ${inr(a.dueTotal)}`,
              value: a.id,
            }))}
          />
        }
      />

      {!agentId && (
        <Card>
          <Empty description={t('ऊपर से एजेंट चुनें')} />
        </Card>
      )}

      {agentId && agent && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('कुल कमाया')} value={inr(agent.earnedTotal)} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('भुगतान हुआ')} value={inr(agent.paidTotal)} valueStyle={{ fontSize: 20, color: 'var(--paid)' }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('देय बाकी')} value={inr(agent.dueTotal)} valueStyle={{ fontSize: 20, color: 'var(--warn)' }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={t('वसूली की')} value={inr(agent.collectedAmount)} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
          </Row>

          {policy && (
            <Alert
              type="info"
              showIcon
              message={t('लागू नियम')}
              description={
                <Space direction="vertical" size={2}>
                  <Text>
                    {t('जॉइनिंग फीस')}:{' '}
                    {policy.joinFee?.enabled
                      ? `${policy.joinFee.value}${policy.joinFee.mode === 'percent' ? '%' : ' ₹'} (${policy.joinFee.mode})`
                      : t('बंद')}
                  </Text>
                  <Text>
                    {t('वसूली')}:{' '}
                    {policy.collection?.enabled
                      ? `${policy.collection.value}${policy.collection.mode === 'percent' ? '%' : ' ₹'} (${policy.collection.mode})`
                      : t('बंद')}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {agent.commissionOverride
                      ? t('इस एजेंट का अपना नियम लागू है')
                      : t('योजना का सामान्य नियम लागू है')}
                  </Text>
                </Space>
              }
            />
          )}

          <Card
            size="small"
            title={t('कमीशन एंट्री ({n})', { n: entries.length })}
            extra={
              <Button
                type="primary"
                disabled={!selected.length}
                onClick={() => setPayoutOpen(true)}
              >
                {selected.length ? t('{n} का भुगतान करें', { n: selected.length }) : t('भुगतान करें')}
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="id"
              dataSource={entries}
              pagination={{ pageSize: 15, size: 'small' }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: setSelected,
                getCheckboxProps: (r) => ({
                  disabled: r.status === 'paid' || r.status === 'cancelled',
                }),
              }}
              columns={[
                {
                  title: t('तिथि'),
                  dataIndex: 'earnedAtMs',
                  width: 110,
                  render: (v) => (v ? new Date(v).toLocaleDateString('hi-IN') : '—'),
                },
                {
                  title: t('प्रकार'),
                  dataIndex: 'type',
                  width: 120,
                  render: (v) => (
                    <Tag color={v === 'join_fee' ? 'blue' : 'green'}>
                      {v === 'join_fee' ? t('जॉइनिंग') : t('वसूली')}
                    </Tag>
                  ),
                },
                { title: t('सदस्य'), dataIndex: 'memberName' },
                { title: t('रसीद'), dataIndex: 'receiptNo', width: 150 },
                {
                  title: t('आधार'),
                  dataIndex: 'baseAmount',
                  width: 100,
                  align: 'right',
                  render: (v) => inr(v),
                },
                { title: t('दर'), dataIndex: 'basis', width: 140 },
                {
                  title: t('कमीशन'),
                  dataIndex: 'amount',
                  width: 110,
                  align: 'right',
                  render: (v) => <Text strong>{inr(v)}</Text>,
                },
                {
                  title: t('स्थिति'),
                  dataIndex: 'status',
                  width: 100,
                  render: (v) => (
                    <Tag color={{ earned: 'orange', approved: 'blue', paid: 'green', cancelled: 'red' }[v]}>
                      {{ earned: t('कमाया'), approved: t('स्वीकृत'), paid: t('भुगतान'), cancelled: t('रद्द') }[v] ?? v}
                    </Tag>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      )}

      <PayoutModal
        open={payoutOpen}
        agentId={agentId}
        entryIds={selected}
        entries={entries.filter((e) => selected.includes(e.id))}
        onClose={() => setPayoutOpen(false)}
        onDone={() => setSelected([])}
      />
    </>
  );
}

function PayoutModal({ open, agentId, entryIds, entries, onClose, onDone }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const t = useT();
  const queryClient = useQueryClient();

  const total = entries.reduce((s, e) => s + (e.amount ?? 0), 0);

  const save = useMutation({
    mutationFn: (values) =>
      api.commission.createPayout({ agentId, entryIds, ...values }),
    onSuccess: (res) => {
      message.success(t('भुगतान {no} — {amount}', { no: res.payout.payoutNo, amount: inr(res.payout.netTotal) }));
      queryClient.invalidateQueries({ queryKey: keys.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: keys.agents });
      onClose();
      onDone();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Modal
      title={t('कमीशन भुगतान')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText={t('भुगतान करें')}
      cancelText={t('रद्द')}
      destroyOnHidden
    >
      <Statistic
        title={t('{n} एंट्री', { n: entryIds.length })}
        value={inr(total)}
        valueStyle={{ color: 'var(--paid)' }}
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" onFinish={save.mutate} initialValues={{ method: 'cash' }}>
        <Form.Item name="method" label={t('तरीका')}>
          <Select
            options={[
              { label: t('नकद'), value: 'cash' },
              { label: t('ऑनलाइन'), value: 'online' },
              { label: 'UPI', value: 'upi' },
              { label: t('बैंक'), value: 'bank' },
            ]}
          />
        </Form.Item>
        <Form.Item name="reference" label={t('संदर्भ नंबर')}>
          <Input />
        </Form.Item>
        <Form.Item name="note" label={t('टिप्पणी')}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
