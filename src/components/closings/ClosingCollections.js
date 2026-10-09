'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, DatePicker, Divider, Empty, Input, InputNumber,
  Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  DownloadOutlined, PrinterOutlined, SearchOutlined, TeamOutlined,
  WalletOutlined, HistoryOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { api, keys, newIdempotencyKey } from '../../lib/api.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { inr } from '../ui/DataGrid.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * The counter's two jobs: take the money, and find the receipt for it later.
 *
 * Both live in one tab because they are one visit. Somebody walks in owing six
 * months, pays four of them, and three weeks later the family comes back for a
 * copy of the receipt — and the slip they are handed is pre-payment paperwork,
 * not proof of anything. Only the numbered receipt below, made at the moment the
 * money was banked, is that.
 *
 * The dues themselves come from `ledger.isEligible` on the server. Nothing here
 * decides who owes what; this screen only shows the answer and sends a request.
 *
 * The period arrives from the page above, because a month is chosen once for the
 * whole screen. Everything narrower than that — which notice, whose closing,
 * whose agent, which member — belongs to this tab and is set here, where it can
 * be seen.
 */

/** A bulk deposit is capped so one mistake cannot lock the transaction. */
const MAX_MEMBERS = 200;

export default function ClosingCollections({ scope }) {
  const t = useT();
  const { message } = App.useApp();
  const cache = useQueryClient();

  /** Which half of the tab is being looked at. */
  const [view, setView] = useState('collect');
  /** Extra narrowing on the receipt register only — a deposit date range. */
  const [paidRange, setPaidRange] = useState(null);

  const [batchId, setBatchId] = useState();
  const [closingId, setClosingId] = useState();
  const [agentId, setAgentId] = useState();
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [method, setMethod] = useState('cash');
  const [paidAt, setPaidAt] = useState(dayjs());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  /**
   * The request as it was FIRST sent.
   *
   * Held so that a retry after a dropped connection resends the same thing,
   * idempotency key and all, and gets back the receipts that already exist
   * rather than banking the money twice. Cleared on any 4xx, because the server
   * rejected the request outright — there is nothing to retry, and the operator
   * needs to be free to change the amounts.
   */
  const [attempt, setAttempt] = useState(null);
  const [result, setResult] = useState(null);

  /**
   * The search box is instant; the request behind it is not.
   *
   * Every keystroke used to re-derive what all 5,000 members owe. Typing one
   * name is three keystrokes and three full passes over the member × closing
   * grid, with somebody waiting at the counter. The letters still appear at
   * once; only the query waits.
   */
  const search = useDebounced(term, 300);

  /** One selection, sent verbatim to the report, the slips and the history. */
  const filters = useMemo(
    () => ({ ...scope, batchId, closingId, agentId }),
    [scope, batchId, closingId, agentId],
  );

  const report = useQuery({
    queryKey: ['closing-collection', filters, search, page],
    queryFn: () => api.closings.report({ ...filters, q: search, page, limit: 50 }),
  });

  const rows = report.data?.rows ?? [];
  const totals = report.data?.totals;

  const batches = useQuery({
    queryKey: keys.closingBatches,
    queryFn: () => api.closingBatches.list(),
  });

  const closings = useQuery({
    queryKey: keys.closings,
    queryFn: () => api.closings.list(),
  });

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: () => api.agents.list(),
  });

  /**
   * The receipt register.
   *
   * A separate date range from the closings one on purpose: "which instalments
   * were due in April" and "what was banked in April" are different questions,
   * and one range picker cannot answer both. Ordering is by payment time then
   * document id server-side, because a bulk deposit stamps one timestamp on
   * forty receipts — ordering by time alone silently skipped thirty-nine of them.
   *
   * Not fetched until it is looked at. An operator taking a deposit has no use
   * for the history, and reading receipts is the expensive half of this screen.
   */
  const history = useInfiniteQuery({
    queryKey: ['payments', 'closing-history', filters, paidRange],
    queryFn: ({ pageParam }) =>
      api.payments.list({
        ...filters,
        paidFromMs: paidRange?.[0]?.startOf('day').valueOf(),
        paidToMs: paidRange?.[1]?.endOf('day').valueOf(),
        cursor: pageParam,
        limit: 100,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: view === 'history',
  });

  const receipts = useMemo(
    () => (history.data?.pages ?? []).flatMap((p) => p.payments),
    [history.data],
  );

  /** Clearing the screen is one function so no caller can half-do it. */
  function resetSelection() {
    setSelected([]);
    setAmounts({});
    setAttempt(null);
    setResult(null);
  }

  /** What a member will be banked for: the typed figure, else their full due. */
  function amountFor(row) {
    if (Object.prototype.hasOwnProperty.call(amounts, row.id)) {
      return Number(amounts[row.id]) || 0;
    }
    return Number(row.dueAmount) || 0;
  }

  const collectTotal = useMemo(
    () => selected.reduce((sum, id) => sum + amountFor(rows.find((r) => r.id === id) ?? {}), 0),
    // `rows` is in the closure deliberately: the per-member amounts are read
    // against the row as it is now, so a refetch that changes a due figure must
    // move the running total with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, amounts, rows],
  );

  const collect = useMutation({
    mutationFn: () => {
      const body =
        attempt ??
        {
          ...filters,
          q: search,
          memberIds: selected,
          byMember: Object.fromEntries(
            selected.map((id) => [id, amountFor(rows.find((r) => r.id === id) ?? {})]),
          ),
          include: 'closings',
          method,
          paidAtMs: paidAt.valueOf(),
          reference,
          note,
          collectedByAgentId: filters.agentId,
          idempotencyKey: newIdempotencyKey(),
        };

      setAttempt(body);
      return api.payments.bulk(body);
    },
    onSuccess: (data) => {
      setResult(data);
      setSelected([]);
      setAmounts({});
      setAttempt(null);
      message.success(
        t('{n} रसीदें बनीं — {amt}', { n: data.receiptCount, amt: inr(data.collected) }),
      );
      cache.invalidateQueries({ queryKey: ['closing-collection'] });
      cache.invalidateQueries({ queryKey: ['payments'] });
      cache.invalidateQueries({ queryKey: ['members'] });
      cache.invalidateQueries({ queryKey: ['member'] });
      cache.invalidateQueries({ queryKey: keys.stats });
    },
    onError: (error) => {
      // A 4xx means the server refused, so there is nothing to resend — drop the
      // frozen body and let the operator correct the figures. A 5xx or a network
      // drop keeps it, so "जाँचें" asks again instead of banking twice.
      if (error.status >= 400 && error.status < 500) setAttempt(null);
      message.error(error.message);
    },
  });

  /**
   * Narrowing the selection.
   *
   * Page 3 of the previous selection is meaningless under a new one, so every
   * change starts again at the top — and the ticked members are dropped with it,
   * because an amount typed against the old table belongs to the old table.
   */
  function narrow(patch) {
    if ('batchId' in patch) {
      setBatchId(patch.batchId);
      // A closing sits on one notice. Leaving the old closing chosen under a new
      // batch gives an empty table and a total of zero, with nothing on screen
      // to say why.
      setClosingId(undefined);
    }
    if ('closingId' in patch) setClosingId(patch.closingId);
    if ('agentId' in patch) setAgentId(patch.agentId);
    setPage(1);
    resetSelection();
  }

  /* ── columns ──────────────────────────────────────────────────────────── */

  const dueColumns = [
    {
      title: t('रजि.'),
      dataIndex: 'registrationNumber',
      width: 100,
      render: (v, r) => (
        <span>
          {v}
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {[r.fatherName, r.village].filter(Boolean).join(' · ')}
            </Text>
          </div>
        </span>
      ),
    },
    { title: t('सदस्य'), dataIndex: 'displayName', width: 150 },
    { title: t('एजेंट'), dataIndex: 'agentName', width: 140 },
    {
      title: t('किस्तें'),
      dataIndex: 'dueCount',
      width: 70,
      align: 'right',
      render: (v) => <Text type="secondary">{v}</Text>,
    },
    {
      title: t('जमा'),
      dataIndex: 'selectedPaid',
      width: 100,
      align: 'right',
      render: (v) => <Text style={{ color: 'var(--paid)' }}>{inr(v)}</Text>,
    },
    {
      title: t('बाकी'),
      dataIndex: 'dueAmount',
      width: 110,
      align: 'right',
      render: (v) => <Text style={{ color: v ? 'var(--due)' : undefined }}>{inr(v)}</Text>,
    },
    {
      title: t('अभी जमा'),
      key: 'amount',
      width: 130,
      render: (_, row) => (
        <InputNumber
          min={0}
          max={row.dueAmount}
          precision={2}
          style={{ width: '100%' }}
          disabled={!selected.includes(row.id) || Boolean(attempt) || collect.isPending}
          value={amounts[row.id] ?? row.dueAmount}
          onChange={(v) =>
            setAmounts((old) => ({ ...old, [row.id]: v === null ? 0 : v }))
          }
        />
      ),
    },
    {
      title: t('पर्ची'),
      key: 'slip',
      width: 70,
      align: 'center',
      render: (_, row) => (
        <Tooltip title={t('बकाया पर्ची छापें')}>
          <Button
            size="small"
            icon={<PrinterOutlined />}
            disabled={!row.dueAmount}
            onClick={() =>
              window.open(api.closings.billsUrl({ ...filters, memberId: row.id }), '_blank')
            }
          />
        </Tooltip>
      ),
    },
  ];

  const receiptColumns = [
    {
      title: t('रसीद'),
      dataIndex: 'receiptNo',
      width: 130,
      render: (v, r) => (
        <span>
          <Text strong>{v}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('{n} किस्त', { n: r.itemCount ?? r.items?.length ?? 0 })}
            </Text>
          </div>
        </span>
      ),
    },
    {
      title: t('जमा तिथि'),
      dataIndex: 'paidAtMs',
      width: 110,
      render: (v) => (v ? dayjs(v).format('DD-MM-YYYY') : '—'),
    },
    {
      title: t('सदस्य'),
      key: 'member',
      render: (_, r) => (
        <span>
          {r.memberSnapshot?.name || '—'}
          <Text type="secondary"> · {r.memberSnapshot?.regNo ?? ''}</Text>
        </span>
      ),
    },
    { title: t('एजेंट'), dataIndex: 'collectedByAgentName', width: 140 },
    {
      title: t('राशि'),
      dataIndex: 'totalAmount',
      width: 110,
      align: 'right',
      render: (v) => <Text strong>{inr(v)}</Text>,
    },
    {
      title: t('स्थिति'),
      key: 'status',
      width: 150,
      render: (_, r) => (
        <Tag color={r.status === 'cancelled' ? 'red' : r.reversedSeqs?.length ? 'orange' : 'green'}>
          {r.status === 'cancelled'
            ? t('रद्द')
            : r.reversedSeqs?.length
              ? t('क्लोजिंग वापस ली गई')
              : t('जमा')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'print',
      width: 70,
      align: 'center',
      render: (_, r) => (
        <Tooltip title={t('रसीद छापें')}>
          <Button
            size="small"
            icon={<PrinterOutlined />}
            onClick={() => window.open(api.payments.receiptUrl(r.id), '_blank')}
          />
        </Tooltip>
      ),
    },
  ];

  /* ── the counters ─────────────────────────────────────────────────────── */

  const collected = totals?.paidAmount ?? 0;
  const outstanding = totals?.dueAmount ?? 0;
  const fullyPaid = rows.filter((r) => r.dueAmount <= 0).length;
  const withDue = rows.length - fullyPaid;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message={t('किस्त कैसे लगती है')}
        description={
          <Text style={{ fontSize: 13 }}>
            {t(
              'जुड़ने की तारीख़ से अपनी क्लोजिंग तारीख़ तक की दूसरी क्लोजिंग की किस्त लगेगी। एक ही तारीख़ को बंद होने वाले सदस्य एक-दूसरे की किस्त देंगे। अपनी खुद की किस्त किसी पर नहीं लगती। क्लोजिंग समूह चुनने से यह तय नहीं होता — तारीख़ से होता है।',
            )}
          </Text>
        }
      />

      <FilterRow
        filters={filters}
        onFilter={narrow}
        term={term}
        onTerm={(value) => {
          setTerm(value);
          setPage(1);
          resetSelection();
        }}
        batches={batches.data?.batches ?? []}
        closings={closings.data?.closings ?? []}
        agents={agents.data?.agents ?? []}
        locked={Boolean(attempt) || collect.isPending}
        onReset={resetSelection}
      />

      <Segmented
        size="large"
        value={view}
        onChange={setView}
        options={[
          {
            value: 'collect',
            label: (
              <Space size={7}>
                <WalletOutlined />
                <span>{t('किस्तें और जमा')}</span>
                {withDue > 0 && <Tag color="red" style={{ marginInlineEnd: 0 }}>{withDue}</Tag>}
              </Space>
            ),
          },
          {
            value: 'history',
            label: (
              <Space size={7}>
                <HistoryOutlined />
                <span>{t('रसीद और भुगतान इतिहास')}</span>
              </Space>
            ),
          },
        ]}
      />

      {view === 'collect' ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} lg={6}>
              <Card size="small">
                <Statistic
                  title={t('पात्र सदस्य')}
                  value={totals?.members ?? 0}
                  prefix={<TeamOutlined />}
                  valueStyle={{ fontSize: 20 }}
                />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small">
                {/* The members still owing something. Not the ones who have
                    paid — a count of "fully paid" next to a due total reads as
                    though the collection is finished. */}
                <Statistic
                  title={t('जिनका बकाया बाकी है')}
                  value={withDue}
                  valueStyle={{ fontSize: 20 }}
                />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small">
                <Statistic
                  title={t('जमा हुई राशि')}
                  value={inr(collected)}
                  valueStyle={{ color: 'var(--paid)', fontSize: 20 }}
                />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card size="small">
                <Statistic
                  title={t('बाकी राशि')}
                  value={inr(outstanding)}
                  valueStyle={{ color: 'var(--due)', fontSize: 20 }}
                />
              </Card>
            </Col>
          </Row>

          {(report.error) && <Alert type="error" showIcon message={report.error.message} />}

          <Card
            size="small"
            title={t('किस्तें और बकाया')}
            extra={
              <Button
                icon={<DownloadOutlined />}
                onClick={() => window.open(api.closings.billsUrl(filters), '_blank')}
              >
                {t('बकाया पर्चियाँ')}
              </Button>
            }
            styles={{ body: { paddingTop: 4 } }}
          >
            <Table
              rowKey="id"
              size="small"
              dataSource={rows}
              columns={dueColumns}
              loading={report.isLoading}
              scroll={{ x: 940 }}
              locale={{
                emptyText: search
                  ? t('कोई सदस्य नहीं मिला')
                  : t('इस चुनाव में कोई किस्त नहीं है'),
              }}
              pagination={{
                current: page,
                pageSize: 50,
                total: report.data?.total ?? 0,
                showSizeChanger: false,
                size: 'small',
                disabled: Boolean(attempt) || collect.isPending,
                // Paging is not a filter. It must not go through `narrow`, which
                // would drop the ticked members and restart at page 1 — but the
                // rows on a new page were not ticked anyway.
                onChange: (next) => {
                  setPage(next);
                  resetSelection();
                },
              }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: setSelected,
                getCheckboxProps: (row) => ({
                  disabled:
                    !row.dueAmount || collect.isPending || Boolean(attempt),
                }),
              }}
              expandable={{
                expandedRowRender: (row) => (
                  <Table
                    size="small"
                    rowKey="seq"
                    pagination={false}
                    dataSource={row.items}
                    columns={[
                      { title: t('बंद सदस्य'), dataIndex: 'name' },
                      {
                        title: t('क्लोजिंग तिथि'),
                        dataIndex: 'dateMs',
                        width: 110,
                        render: (v) => dayjs(v).format('DD-MM-YYYY'),
                      },
                      {
                        title: t('किस्त'),
                        dataIndex: 'amount',
                        width: 100,
                        align: 'right',
                        render: (v) => inr(v),
                      },
                      {
                        title: t('जमा'),
                        dataIndex: 'paid',
                        width: 100,
                        align: 'right',
                        render: (v) => inr(v),
                      },
                      {
                        title: t('बाकी'),
                        dataIndex: 'remaining',
                        width: 100,
                        align: 'right',
                        render: (v) => (
                          <Text style={{ color: v ? 'var(--due)' : 'var(--paid)' }}>
                            {v ? inr(v) : t('पूरा')}
                          </Text>
                        ),
                      },
                    ]}
                  />
                ),
              }}
            />
          </Card>

          {/* ── the deposit bar ─────────────────────────────────────────────
              Pinned to the bottom and always in the same place, because it is
              the last thing the operator touches and it must not be somewhere
              that moves when the table above re-sorts. */}
          <Card
            size="small"
            title={t('जमा करें')}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('एक बार में अधिकतम {n} सदस्य', { n: MAX_MEMBERS })}
              </Text>
            }
          >
            <Row gutter={[12, 12]} align="bottom">
              <Col xs={12} md={6} lg={4}>
                <label className="field">
                  <span>{t('भुगतान का तरीक़ा')}</span>
                  <Select
                    value={method}
                    disabled={Boolean(attempt)}
                    onChange={setMethod}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'cash', label: t('नकद') },
                      { value: 'upi', label: 'UPI' },
                      { value: 'bank', label: t('बैंक') },
                      { value: 'online', label: t('ऑनलाइन') },
                      { value: 'cheque', label: t('चेक') },
                    ]}
                  />
                </label>
              </Col>
              <Col xs={12} md={6} lg={4}>
                <label className="field">
                  <span>{t('जमा की तिथि')}</span>
                  <DatePicker
                    value={paidAt}
                    onChange={setPaidAt}
                    allowClear={false}
                    disabled={Boolean(attempt)}
                    format="DD-MM-YYYY"
                    style={{ width: '100%' }}
                  />
                </label>
              </Col>
              <Col xs={12} md={6} lg={4}>
                <label className="field">
                  <span>{t('लेन-देन नंबर')}</span>
                  <Input
                    placeholder={t('वैकल्पिक')}
                    value={reference}
                    disabled={Boolean(attempt)}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </Col>
              <Col xs={12} md={6} lg={4}>
                <label className="field">
                  <span>{t('टिप्पणी')}</span>
                  <Input
                    placeholder={t('वैकल्पिक')}
                    value={note}
                    disabled={Boolean(attempt)}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </Col>

              <Col xs={24} md={12} lg={8}>
                <div className="deposit-total">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {selected.length
                      ? t('{n} सदस्य चुने', { n: selected.length })
                      : t('ऊपर से सदस्य चुनें')}
                  </Text>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>
                    {inr(collectTotal)}
                  </div>
                </div>
              </Col>

              <Col xs={24} md={12} lg={8} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  size="large"
                  loading={collect.isPending}
                  disabled={
                    (!attempt && (!selected.length || !collectTotal)) ||
                    (!attempt && selected.length > MAX_MEMBERS)
                  }
                  onClick={() => collect.mutate()}
                  style={{ flex: 1, maxWidth: 280 }}
                >
                  {attempt
                    ? t('उसी भुगतान का परिणाम फिर जाँचें')
                    : t('{n} सदस्य · {amt} जमा करें', { n: selected.length, amt: inr(collectTotal) })}
                </Button>
              </Col>
            </Row>

            <Divider style={{ margin: '14px 0 10px' }} />

            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                'आंशिक रकम सबसे पुरानी बची किस्त से लगेगी। दिन भर में कई सदस्य एक साथ जमा कर सकते हैं — एक साथ दबाने से एक ही रसीद दो बार नहीं बनेगी।',
              )}
            </Text>
          </Card>

          {result && <ReceiptResult result={result} />}
        </Space>
      ) : (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Card size="small">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} md={14}>
                <label className="field">
                  <span>{t('जमा की तिथि से')}</span>
                  <DatePicker.RangePicker
                    value={paidRange}
                    onChange={setPaidRange}
                    format="DD-MM-YYYY"
                    style={{ width: '100%' }}
                    placeholder={[t('शुरू'), t('आज तक')]}
                  />
                </label>
              </Col>
              <Col xs={24} md={10}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t(
                    'रसीद का क्रम जमा के समय से उल्टा है। एक जमा में 40 सदस्य होने पर भी सारी रसीदें दिखती हैं।',
                  )}
                </Text>
              </Col>
            </Row>
          </Card>

          {(history.error) && <Alert type="error" showIcon message={history.error.message} />}

          <Card
            size="small"
            title={t('रसीदें')}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('{n} दिख रही हैं', { n: receipts.length })}
              </Text>
            }
          >
            <Table
              rowKey="id"
              size="small"
              dataSource={receipts}
              columns={receiptColumns}
              loading={history.isLoading}
              scroll={{ x: 940 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('इस चुनाव में कोई रसीद नहीं')} /> }}
              expandable={{
                expandedRowRender: (r) => (
                  <Space direction="vertical" size={4} style={{ width: '100%', padding: '4px 0' }}>
                    {(r.items ?? []).map((item) => (
                      <div key={item.seq}>
                        <Text
                          delete={r.reversedSeqs?.includes(item.seq)}
                          type={r.reversedSeqs?.includes(item.seq) ? 'secondary' : undefined}
                        >
                          {item.name} · {dayjs(item.closingDateMs ?? item.dateMs).format('DD-MM-YYYY')} ·{' '}
                          {inr(item.amount)}
                          {r.reversedSeqs?.includes(item.seq) ? ` · ${t('वापस ली गई')}` : ''}
                        </Text>
                      </div>
                    ))}
                    {(r.note || r.cancelReason) && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {[r.note, r.cancelReason].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Space>
                ),
              }}
            />
            {history.hasNextPage && (
              <Button
                block
                style={{ marginTop: 10 }}
                loading={history.isFetchingNextPage}
                onClick={() => history.fetchNextPage()}
              >
                {t('आगे की रसीदें खोजें')}
              </Button>
            )}
          </Card>
        </Space>
      )}
    </Space>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which round of instalments is on screen.
 *
 * Batch and closing are one control in sequence, not two: a closing lives on
 * one notice, so choosing a batch and leaving the closing from the old batch
 * selected gives an empty table with no visible cause. The closing list is
 * narrowed to the batch for the same reason.
 *
 * Locked while a deposit is in flight — the frozen request names a batch and a
 * closing, and letting the operator change the selection underneath it would
 * mean the "check again" button could mean something different from what it
 * first said.
 */
function FilterRow({
  filters, onFilter, term, onTerm, batches, closings, agents, locked, onReset,
}) {
  const t = useT();

  const closingOptions = closings
    .filter((c) => !filters.batchId || c.batchId === filters.batchId)
    .map((c) => ({
      value: c.id,
      label: `${c.regNo} ${c.name} · ${c.dateMs ? dayjs(c.dateMs).format('DD-MM-YYYY') : '—'}`,
    }));

  return (
    <Card size="small">
      <Row gutter={[12, 12]} align="bottom">
        <Col xs={24} md={12} lg={5}>
          <label className="field">
            <span>{t('क्लोजिंग समूह')}</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('सभी समूह')}
              value={filters.batchId}
              disabled={locked}
              onChange={(value) => onFilter({ batchId: value })}
              options={batches.map((b) => ({
                value: b.id,
                label: `${b.name}${b.closingCount ? ` (${b.closingCount})` : ''}`,
              }))}
            />
          </label>
        </Col>

        <Col xs={24} md={12} lg={7}>
          <label className="field">
            <span>{t('बंद हुआ सदस्य')}</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('सभी क्लोजिंग')}
              value={filters.closingId}
              disabled={locked}
              onChange={(value) => onFilter({ closingId: value })}
              options={closingOptions}
            />
          </label>
        </Col>

        <Col xs={24} md={12} lg={5}>
          <label className="field">
            <span>{t('एजेंट')}</span>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('सभी एजेंट')}
              value={filters.agentId}
              disabled={locked}
              onChange={(value) => onFilter({ agentId: value })}
              options={agents.map((a) => ({
                value: a.id,
                label: a.displayName || a.email,
              }))}
            />
          </label>
        </Col>

        <Col xs={24} md={12} lg={7}>
          <label className="field">
            <span>{t('सदस्य खोजें')}</span>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('नाम, रजि. नं., गाँव या मोबाइल')}
              value={term}
              disabled={locked}
              onChange={(e) => onTerm(e.target.value)}
            />
          </label>
        </Col>

        <Col span={24} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => window.open(api.closings.billsUrl(filters), '_blank')}
          >
            {t('बकाया पर्चियाँ')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() =>
              window.open(api.closings.billsUrl({ ...filters, doc: 'summary' }), '_blank')
            }
          >
            {t('एजेंट-वार सारांश')}
          </Button>
          <Button onClick={onReset}>{t('चयन हटाएँ')}</Button>
        </Col>
      </Row>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the last deposit actually did.
 *
 * A bulk deposit is many transactions, so it can partly fail. Saying "3 receipts
 * made" and leaving out the one that did not would be the same class of mistake
 * as a pre-payment slip being taken for a receipt: the screen would look
 * successful over a sum that is short.
 */
function ReceiptResult({ result }) {
  const t = useT();
  const receipts = result.receipts ?? [];
  const failed = result.failed ?? [];

  const columns = [
    { title: t('रसीद'), dataIndex: 'receiptNo', width: 130 },
    {
      title: t('सदस्य'),
      render: (_, r) => `${r.memberSnapshot?.regNo ?? ''} ${r.memberSnapshot?.name ?? ''}`,
    },
    { title: t('एजेंट'), dataIndex: 'collectedByAgentName', width: 140 },
    {
      title: t('राशि'),
      dataIndex: 'totalAmount',
      width: 110,
      align: 'right',
      render: (v) => inr(v),
    },
    {
      title: '',
      width: 70,
      align: 'center',
      render: (_, r) => (
        <Button
          size="small"
          icon={<PrinterOutlined />}
          onClick={() => window.open(api.payments.receiptUrl(r.id), '_blank')}
        />
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={t('इस जमा की {n} रसीदें', { n: result.receiptCount ?? receipts.length })}
      extra={<Tag color="green">{inr(result.collected)}</Tag>}
      style={{ borderColor: 'var(--paid)' }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {failed.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t('{n} सदस्यों का भुगतान नहीं हुआ', { n: failed.length })}
            description={
              <Space direction="vertical" size={2}>
                {failed.map((f) => (
                  <Text key={f.memberId} style={{ fontSize: 12.5 }}>
                    {f.name} — {f.error}
                  </Text>
                ))}
              </Space>
            }
          />
        )}

        {receipts.length > 0 ? (
          <Table
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={receipts}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
          />
        ) : (
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            {t('कोई रसीद नहीं बनी। ऊपर दिखाई गई वजह देखें — पैसा कहीं और नहीं गया।')}
          </Paragraph>
        )}
      </Space>
    </Card>
  );
}
