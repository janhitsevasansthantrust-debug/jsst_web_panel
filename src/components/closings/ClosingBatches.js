'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Row, Select,
  Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  PlusOutlined, PrinterOutlined, LockOutlined, EditOutlined,
  FileTextOutlined, ProfileOutlined, AppstoreAddOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import PhotoUpload from '../members/PhotoUpload.js';
import { inr } from '../ui/DataGrid.js';
import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * क्लोजिंग समूह — the month's notices.
 *
 * A batch is a piece of stationery: it decides what goes on one printed sheet
 * and nothing else. It cannot change what a member owes — that is still worked
 * out per member from the closing dates — so an operator can rename a batch,
 * move a closing out of it, or scrap it entirely without touching anybody's
 * ledger. Worth saying on the screen, because the old system's "group" DID
 * move money and people are careful with it out of habit.
 */
export default function ClosingBatches() {
  const t = useT();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  /**
   * Whose round to print.
   *
   * Empty means the whole trust, which is the right default for the summary
   * (the office wants every agent on one page) and the wrong one for receipts
   * (that is a book). The receipts button says so rather than silently
   * printing four hundred pages.
   */
  const [agentId, setAgentId] = useState(null);
  /** The batch whose closings are being picked. */
  const [picking, setPicking] = useState(null);

  const query = useQuery({
    queryKey: keys.closingBatches,
    queryFn: () => api.closingBatches.list(),
  });

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: () => api.agents.list(),
    select: (d) => d.agents ?? [],
  });

  const issue = useMutation({
    mutationFn: (id) => api.closingBatches.issue(id),
    onSuccess: () => {
      message.success(t('समूह जारी हो गया'));
      queryClient.invalidateQueries({ queryKey: keys.closingBatches });
    },
    onError: (err) => message.error(err.message),
  });

  const batches = query.data?.batches ?? [];

  function confirmIssue(batch) {
    modal.confirm({
      title: t('समूह जारी करें?'),
      content: t(
        'जारी करने के बाद इस समूह में नई क्लोजिंग नहीं जुड़ सकती। सदस्यों के हाथ में जो सूची जाएगी, उसमें बाद में नाम जोड़ना ठीक नहीं — इसलिए यह पक्का हो जाता है।',
      ),
      okText: t('जारी करें'),
      cancelText: t('रद्द'),
      onOk: () => issue.mutateAsync(batch.id),
    });
  }

  return (
    <>
      <Card
        size="small"
        title={t('क्लोजिंग समूह')}
        extra={
          <Space size={6}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              size="small"
              value={agentId}
              onChange={setAgentId}
              placeholder={t('सभी एजेंट')}
              style={{ minWidth: 170 }}
              loading={agents.isLoading}
              options={(agents.data ?? []).map((a) => ({
                label: a.displayName || a.email,
                value: a.id,
              }))}
            />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
              {t('नया समूह')}
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
          {t('एक महीने की सारी क्लोजिंग एक समूह में रखिए और उसकी एक सूचना छापिए। समूह सिर्फ़ छपाई के लिए है — किसी का बकाया इससे नहीं बदलता।')}
        </Paragraph>

        {!query.isLoading && !batches.length ? (
          <Empty description={t('अभी कोई समूह नहीं')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={query.isLoading}
            dataSource={batches}
            pagination={false}
            columns={[
              {
                title: t('नाम'),
                dataIndex: 'name',
                render: (v, b) => (
                  <Space size={6}>
                    <Text strong>{v}</Text>
                    <Tag>{b.code}</Tag>
                    {b.status === 'issued' ? (
                      <Tag color="green">{t('जारी')}</Tag>
                    ) : (
                      <Tag color="blue">{t('खुला')}</Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: t('क्लोजिंग'),
                dataIndex: 'closingCount',
                width: 90,
                align: 'right',
                render: (v) => v ?? 0,
              },
              {
                title: t('प्रति सदस्य'),
                dataIndex: 'perMemberAmount',
                width: 110,
                align: 'right',
                // Only meaningful once issued: until then the batch is still
                // collecting closings and the figure would change under the
                // reader's hand.
                render: (v, b) => (b.status === 'issued' ? inr(v) : <Text type="secondary">—</Text>),
              },
              { title: t('अंतिम तिथि'), dataIndex: 'dueDate', width: 110 },
              {
                title: '',
                width: 190,
                align: 'right',
                render: (_, b) => (
                  <Space size={4}>
                    <Tooltip title={t('सूचना पत्र छापें')}>
                      <Button
                        size="small"
                        icon={<PrinterOutlined />}
                        disabled={!b.closingCount}
                        onClick={() => window.open(api.closingBatches.noticeUrl(b.id), '_blank')}
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        agentId
                          ? t('इस एजेंट के सदस्यों की रसीदें छापें')
                          : t('रसीदों के लिए पहले एजेंट चुनें')
                      }
                    >
                      <Button
                        size="small"
                        icon={<FileTextOutlined />}
                        disabled={!b.closingCount || !agentId}
                        onClick={() =>
                          window.open(api.closingBatches.receiptsUrl(b.id, agentId), '_blank')
                        }
                      />
                    </Tooltip>
                    <Tooltip title={t('एजेंट-वार सारांश छापें')}>
                      <Button
                        size="small"
                        icon={<ProfileOutlined />}
                        disabled={!b.closingCount}
                        onClick={() =>
                          window.open(api.closingBatches.summaryUrl(b.id, agentId), '_blank')
                        }
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        b.status === 'issued'
                          ? t('जारी समूह में क्लोजिंग नहीं जोड़ी जा सकती')
                          : t('क्लोजिंग जोड़ें या हटाएँ')
                      }
                    >
                      <Button
                        size="small"
                        icon={<AppstoreAddOutlined />}
                        disabled={b.status === 'issued'}
                        onClick={() => setPicking(b)}
                      />
                    </Tooltip>
                    <Tooltip title={t('संपादित करें')}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(b)} />
                    </Tooltip>
                    <Tooltip title={b.status === 'issued' ? t('जारी हो चुका है') : t('जारी करें')}>
                      <Button
                        size="small"
                        icon={<LockOutlined />}
                        disabled={b.status === 'issued' || !b.closingCount}
                        loading={issue.isPending}
                        onClick={() => confirmIssue(b)}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <BatchFormModal batch={editing} onClose={() => setEditing(null)} />
      <PickClosingsModal batch={picking} onClose={() => setPicking(null)} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function BatchFormModal({ batch, onClose, onCreated }) {
  const t = useT();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const open = Boolean(batch);
  const editing = Boolean(batch?.id);

  const save = useMutation({
    mutationFn: (values) => {
      const body = {
        ...values,
        dueDate: values.dueDate ? values.dueDate.format('DD-MM-YYYY') : '',
        dueDateMs: values.dueDate ? values.dueDate.startOf('day').valueOf() : null,
      };
      return editing
        ? api.closingBatches.update(batch.id, body)
        : api.closingBatches.create(body);
    },
    onSuccess: (res) => {
      message.success(editing ? t('समूह अपडेट हो गया') : t('समूह बन गया'));
      queryClient.invalidateQueries({ queryKey: keys.closingBatches });
      form.resetFields();
      onCreated?.(res.batch);
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Modal
      title={editing ? t('समूह संपादित करें') : t('नया क्लोजिंग समूह')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText={t('सहेजें')}
      cancelText={t('रद्द')}
      width={560}
      destroyOnHidden
      // The form is built from `batch` on open, so it must not survive a close
      // — otherwise editing one batch and then creating a new one starts with
      // the previous batch's due date and note already filled in.
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={save.mutate}
        initialValues={{
          name: batch?.name ?? dayjs().format('MMMM YYYY'),
          description: batch?.description ?? '',
          paymentNote: batch?.paymentNote ?? '',
          invitationCardURL: batch?.invitationCardURL ?? '',
          dueDate: batch?.dueDateMs ? dayjs(batch.dueDateMs) : dayjs().endOf('month'),
        }}
      >
        <Row gutter={12}>
          <Col xs={24} md={14}>
            <Form.Item
              name="name"
              label={t('समूह का नाम')}
              rules={[{ required: true, min: 2 }]}
              extra={t('जैसे: सितंबर 2026')}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item
              name="dueDate"
              label={t('भुगतान की अंतिम तिथि')}
              extra={t('सिर्फ़ सूचना पर छपती है')}
            >
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {!editing && (
          <Form.Item
            name="code"
            label={t('रसीद कोड')}
            extra={t('रसीद नंबर के बीच में छपेगा। खाली छोड़ें तो नाम से बन जाएगा। बाद में बदला नहीं जा सकता।')}
          >
            <Input maxLength={8} placeholder="SEP26" />
          </Form.Item>
        )}

        <Form.Item
          name="paymentNote"
          label={t('भुगतान की जानकारी')}
          extra={t('कहाँ और कैसे जमा करना है — सूचना के नीचे छपेगा')}
        >
          <Input.TextArea rows={3} />
        </Form.Item>

        <Form.Item name="description" label={t('टिप्पणी')}>
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item name="invitationCardURL" label={t('निमंत्रण पत्र')}>
          <InvitationCard />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** A thin wrapper so `PhotoUpload` can sit inside a `Form.Item`. */
function InvitationCard({ value, onChange }) {
  const t = useT();
  return (
    <PhotoUpload
      label={t('निमंत्रण पत्र')}
      value={value}
      onChange={onChange}
      folder="closings"
      width={160}
      height={110}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Put existing closings on a batch's notice.
 *
 * Shows both sides at once — what is already on this notice and what is not —
 * because the question being answered is "is the sheet right yet", and that is
 * not answerable from half the list.
 *
 * Moving a closing changes nothing about what anybody owes; dues come from the
 * closing's date, member by member. The batch only decides which sheet it
 * prints on. Worth saying on the screen, because people are careful with
 * anything that looks like it moves money.
 */
function PickClosingsModal({ batch, onClose }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const open = Boolean(batch);

  const [selected, setSelected] = useState([]);

  const sheet = useQuery({
    queryKey: keys.closingBatch(batch?.id),
    queryFn: () => api.closingBatches.get(batch.id),
    enabled: open,
  });

  const available = useQuery({
    queryKey: ['closing-batch', batch?.id, 'assignable'],
    queryFn: () => api.closingBatches.assignable(batch.id),
    enabled: open,
    select: (d) => d.closings ?? [],
  });

  function done(res) {
    message.success(t('{n} क्लोजिंग बदली गईं', { n: res.moved }));
    setSelected([]);
    queryClient.invalidateQueries({ queryKey: keys.closingBatches });
    queryClient.invalidateQueries({ queryKey: keys.closings });
    sheet.refetch();
    available.refetch();
  }

  const add = useMutation({
    mutationFn: (ids) => api.closingBatches.addClosings(batch.id, ids),
    onSuccess: done,
    onError: (err) => message.error(err.message),
  });

  const drop = useMutation({
    mutationFn: (ids) => api.closingBatches.removeClosings(batch.id, ids),
    onSuccess: done,
    onError: (err) => message.error(err.message),
  });

  const columns = [
    { title: t('क्रम'), dataIndex: 'seq', width: 64 },
    {
      title: t('नाम'),
      dataIndex: 'name',
      render: (v, c) => (
        <span>
          {v}
          {c.fatherName ? <Text type="secondary"> / {c.fatherName}</Text> : null}
        </span>
      ),
    },
    { title: t('रजि.'), dataIndex: 'regNo', width: 90 },
    {
      title: t('तिथि'),
      dataIndex: 'dateMs',
      width: 110,
      render: (v) => (v ? dayjs(v).format('DD-MM-YYYY') : '—'),
    },
  ];

  return (
    <Modal
      title={t('क्लोजिंग जोड़ें — {name}', { name: batch?.name ?? '' })}
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
      afterClose={() => setSelected([])}
    >
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('समूह बदलने से किसी का बकाया नहीं बदलता — वह क्लोजिंग की तारीख़ से तय होता है। समूह सिर्फ़ यह तय करता है कि किस सूचना पर छपेगी।')}
      </Paragraph>

      <Card size="small" title={t('इस समूह में')} style={{ marginBottom: 12 }}>
        <Table
          rowKey="id"
          size="small"
          loading={sheet.isLoading}
          dataSource={sheet.data?.rows ?? []}
          columns={columns}
          pagination={false}
          scroll={{ y: 180 }}
          locale={{ emptyText: t('अभी कोई क्लोजिंग नहीं') }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
          }}
        />
        <Button
          danger
          size="small"
          style={{ marginTop: 8 }}
          disabled={!selected.length}
          loading={drop.isPending}
          onClick={() => drop.mutate(selected)}
        >
          {t('चुनी हुई हटाएँ')}
        </Button>
      </Card>

      <Card size="small" title={t('जोड़ी जा सकती हैं')}>
        <Table
          rowKey="id"
          size="small"
          loading={available.isLoading}
          dataSource={available.data ?? []}
          columns={[
            ...columns,
            {
              title: t('समूह'),
              dataIndex: 'batchId',
              width: 90,
              // A closing already on ANOTHER notice can still be moved — "I put
              // it on the wrong sheet" is a normal mistake — but the operator
              // must be able to see that is what they are doing.
              render: (v) => (v ? <Tag color="gold">{t('दूसरे समूह में')}</Tag> : null),
            },
          ]}
          pagination={{ pageSize: 8, size: 'small' }}
          scroll={{ y: 220 }}
          locale={{ emptyText: t('जोड़ने के लिए कोई क्लोजिंग नहीं') }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
          }}
        />
        <Button
          type="primary"
          size="small"
          style={{ marginTop: 8 }}
          disabled={!selected.length}
          loading={add.isPending}
          onClick={() => add.mutate(selected)}
        >
          {t('चुनी हुई जोड़ें')}
        </Button>
      </Card>
    </Modal>
  );
}
