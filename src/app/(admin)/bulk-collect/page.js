'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Input, InputNumber, Result,
  Row, Segmented, Select, Space, Statistic, Table, Tag, App, Typography,
} from 'antd';
import {
  TeamOutlined, WalletOutlined, PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import PageHeader from '../../../components/ui/PageHeader.js';
import { inr } from '../../../components/ui/DataGrid.js';
import { api, keys, newIdempotencyKey } from '../../../lib/api.js';
import { useMasters } from '../../../lib/useMasters.js';
import { useT } from '../../../i18n/index.js';

const { Text, Title } = Typography;

/**
 * सामूहिक वसूली — one deposit, many members.
 *
 * An agent finishes their round and hands over ₹20,000 collected from forty
 * people. Recording that through the single-member counter screen meant forty
 * searches and forty submits with the agent standing there, so in practice it
 * was written in a notebook and entered later, or not at all.
 *
 * The shape of this screen follows the shape of that conversation: pick the
 * agent, see their members who owe, select them, say how much was handed over,
 * look at the split, correct any line the agent disputes, submit once.
 *
 * Nothing here decides anything about money. The split comes from the server,
 * computed against each member's live ledger, and is recomputed there again
 * before anything is written — this page only displays it and lets the figures
 * be adjusted.
 */
export default function BulkCollectPage() {
  const t = useT();
  const masters = useMasters();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [agentId, setAgentId] = useState(null);
  const [village, setVillage] = useState(null);
  const [q, setQ] = useState('');

  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState(null);
  const [rule, setRule] = useState('member');

  /**
   * What this deposit is allowed to settle.
   *
   * A member can owe two different things and an agent collects both on the
   * same round, so "both" is the default. The other two exist for the rounds
   * that are only one errand — a fee drive, or a closing collection where the
   * trust does not want enrolment money swept up with it.
   */
  const [include, setInclude] = useState('both');

  /**
   * The figures the preview is actually asked about, a beat behind the ones
   * being typed.
   *
   * Typing "20000" is five keystrokes, and each one was firing a full preview:
   * the server re-read every selected member and re-ran the whole split, five
   * times, for four answers nobody looked at. Only the settled value is sent.
   */
  const [settled, setSettled] = useState({ amount: 0, edits: {} });

  /** memberId → amount, only for lines the operator has actually changed. */
  const [edits, setEdits] = useState({});

  const [method, setMethod] = useState('cash');
  const [paidAt, setPaidAt] = useState(dayjs());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const [done, setDone] = useState(null);

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: () => api.agents.list(),
  });

  /**
   * The villages that actually have members, with their outstanding totals.
   *
   * Not from the masters list: that one holds every village the trust has
   * ever typed, including the ones with nobody in them, and an agent's round
   * covers four of them. These come from the same grouping the agents screen
   * uses, so the dropdown is the real map of where the money is.
   */
  const villageGroups = useQuery({
    queryKey: ['members', 'summary', 'village'],
    queryFn: () => api.members.summary({ groupBy: 'village' }),
  });

  const villageOptions = useMemo(
    () =>
      (villageGroups.data?.groups?.village ?? [])
        .filter((v) => v.value && v.value !== '_none')
        .map((v) => ({
          label: `${v.label} — ${v.withDue} ${t('बकायादार')}`,
          value: v.value,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [villageGroups.data],
  );

  /**
   * Only members who owe something.
   *
   * `hasDue` is answered from the search index, so narrowing to one agent's
   * four hundred members costs the same as listing none of them.
   */
  const members = useQuery({
    queryKey: ['members', 'bulk', agentId, village, q, include],
    queryFn: () =>
      api.members.list({
        agentId: agentId ?? undefined,
        village: village ?? undefined,
        q: q.trim() || undefined,
        // Who counts as owing depends on what is being collected. Filtering on
        // closings alone would hide a member whose only debt is half a fee.
        ...(include === 'closings'
          ? { hasDue: true }
          : include === 'fees'
            ? { hasFeeDue: true }
            : { owesAnything: true }),
        limit: 100,
      }),
    enabled: Boolean(agentId || village || q.trim()),
  });

  const rows = members.data?.members ?? [];
  const total = members.data?.total ?? rows.length;

  /** What this member owes under the current choice of what to collect. */
  const owed = (m) =>
    (include === 'fees' ? 0 : (m.dueAmount ?? 0)) +
    (include === 'closings' ? 0 : (m.joinFeesDue ?? 0));

  // A changed filter means a different set of people; carrying a selection
  // across it is how money ends up against somebody nobody meant to pay for.
  useEffect(() => {
    setSelected([]);
    setEdits({});
  }, [agentId, village, q, include]);

  const selectedDue = useMemo(
    () =>
      rows
        .filter((m) => selected.includes(m.id))
        .reduce((s, m) => s + owed(m), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selected, include],
  );

  useEffect(() => {
    const id = setTimeout(() => setSettled({ amount: Number(amount) || 0, edits }), 400);
    return () => clearTimeout(id);
  }, [amount, edits]);

  const hasEdits = Object.keys(settled.edits).length > 0;

  /* ── the split, computed by the server ────────────────────────────────── */

  const previewBody = useMemo(
    () => ({
      memberIds: selected,
      ...(hasEdits
        ? { byMember: settled.edits }
        : { amount: settled.amount, rule }),
      include,
      method,
      paidAtMs: paidAt.valueOf(),
      preview: true,
    }),
    [selected, hasEdits, settled, rule, include, method, paidAt],
  );

  const preview = useQuery({
    queryKey: ['payments', 'bulk-preview', previewBody],
    queryFn: () => api.payments.bulk(previewBody),
    enabled: selected.length > 0 && (hasEdits || settled.amount > 0),
    // The split for a given set of inputs does not change on its own, and this
    // screen re-renders on every keystroke elsewhere in it.
    staleTime: 30_000,
  });

  const plan = preview.data?.plan;

  /** memberId → what this deposit gives them, as the server worked it out. */
  const planByMember = useMemo(() => {
    const map = new Map();
    for (const line of plan?.lines ?? []) map.set(line.memberId, line);
    return map;
  }, [plan]);

  const submit = useMutation({
    mutationFn: () =>
      api.payments.bulk(
        {
          memberIds: selected,
          // Submitting sends what is on screen right now, not the debounced
          // copy — a click lands before the 400ms settles often enough.
          ...(Object.keys(edits).length > 0
            ? { byMember: edits }
            : { amount: Number(amount) || 0, rule }),
          include,
          method,
          paidAtMs: paidAt.valueOf(),
          reference,
          note,
          collectedByAgentId: agentId ?? null,
        },
        newIdempotencyKey(),
      ),
    onSuccess: (res) => {
      setDone(res);
      message.success(
        t('{n} रसीदें बनीं — कुल {amt}', { n: res.receiptCount, amt: inr(res.collected) }),
      );
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: keys.stats });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => message.error(err.message),
  });

  function reset() {
    setDone(null);
    setSelected([]);
    setEdits({});
    setAmount(null);
    setReference('');
    setNote('');
  }

  /* ── after submitting ─────────────────────────────────────────────────── */

  if (done) {
    return (
      <>
        <PageHeader title={t('सामूहिक वसूली')} />
        <Card>
          <Result
            status={done.failed?.length ? 'warning' : 'success'}
            title={t('{n} सदस्यों की वसूली दर्ज हुई', { n: done.memberCount })}
            subTitle={
              done.feeCollected > 0
                ? `${inr(done.collected)} — ${t('इसमें नामांकन शुल्क {f}', {
                    f: inr(done.feeCollected),
                  })}`
                : inr(done.collected)
            }
            extra={[
              <Button key="new" type="primary" onClick={reset}>
                {t('अगली वसूली')}
              </Button>,
            ]}
          />

          {/* A shortfall means some member's receipt did not get written. It
              is stated in money, not in a count, because that is the number
              that will not match the cash box. */}
          {done.shortfall > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('{amt} दर्ज नहीं हुआ', { amt: inr(done.shortfall) })}
              description={t('नीचे की सूची वाले सदस्यों की रसीद नहीं बनी — उन्हें दोबारा लगाएँ।')}
            />
          )}

          {done.failed?.length > 0 && (
            <Table
              size="small"
              rowKey="memberId"
              pagination={false}
              style={{ marginBottom: 16 }}
              dataSource={done.failed}
              columns={[
                { title: t('सदस्य'), dataIndex: 'name' },
                { title: t('रजि.'), dataIndex: 'regNo', width: 110 },
                { title: t('राशि'), dataIndex: 'amount', width: 110, align: 'right', render: inr },
                { title: t('कारण'), dataIndex: 'error' },
              ]}
            />
          )}

          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 20, size: 'small' }}
            dataSource={done.receipts}
            columns={[
              { title: t('रसीद'), dataIndex: 'receiptNo', width: 190 },
              { title: t('सदस्य'), dataIndex: 'memberName' },
              { title: t('रजि.'), dataIndex: 'regNo', width: 110 },
              {
                title: t('राशि'),
                dataIndex: 'totalAmount',
                width: 110,
                align: 'right',
                render: (v) => inr(v),
              },
              {
                title: '',
                width: 60,
                render: (_, r) => (
                  <Button
                    size="small"
                    icon={<PrinterOutlined />}
                    onClick={() => window.open(api.payments.receiptUrl(r.id), '_blank')}
                  />
                ),
              },
            ]}
          />
        </Card>
      </>
    );
  }

  /* ── the working screen ───────────────────────────────────────────────── */

  return (
    <>
      <PageHeader
        title={t('सामूहिक वसूली')}
        subtitle={t('एक साथ जमा — एजेंट चुनें, सदस्य चुनें, रकम डालें')}
        error={members.error || preview.error}
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => members.refetch()} />
        }
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small" title={t('क्या वसूलना है')}>
          <Segmented
            block
            value={include}
            onChange={setInclude}
            options={[
              { label: t('दोनों'), value: 'both' },
              { label: t('सिर्फ़ क्लोजिंग'), value: 'closings' },
              { label: t('सिर्फ़ नामांकन शुल्क'), value: 'fees' },
            ]}
          />
        </Card>

        <Card size="small" title={t('कौन से सदस्य')}>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Text type="secondary">{t('एजेंट')}</Text>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                value={agentId}
                onChange={setAgentId}
                placeholder={t('एजेंट चुनें')}
                style={{ width: '100%' }}
                options={(agents.data?.agents ?? []).map((a) => ({
                  label: `${a.displayName}${a.village ? ` — ${a.village}` : ''}`,
                  value: a.id,
                }))}
              />
            </Col>
            <Col xs={12} md={8}>
              <Text type="secondary">{t('गाँव')}</Text>
              <Select
                allowClear
                showSearch
                value={village}
                onChange={setVillage}
                placeholder={t('सब')}
                style={{ width: '100%' }}
                options={villageOptions}
              />
            </Col>
            <Col xs={12} md={8}>
              <Text type="secondary">{t('खोजें')}</Text>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('नाम / रजि. नंबर')}
                allowClear
              />
            </Col>
          </Row>
        </Card>

        {!agentId && !village && !q.trim() ? (
          <Card>
            <Empty description={t('ऊपर एजेंट या गाँव चुनें — बकाया वाले सदस्य यहाँ आएँगे')} />
          </Card>
        ) : (
          <>
            <Card
              size="small"
              title={t('बकाया वाले सदस्य ({n})', { n: rows.length })}
              extra={
                <Space>
                  <Button size="small" onClick={() => setSelected(rows.map((m) => m.id))} disabled={!rows.length}>
                    {t('सब चुनें')}
                  </Button>
                  <Button size="small" onClick={() => setSelected([])} disabled={!selected.length}>
                    {t('हटाएँ')}
                  </Button>
                </Space>
              }
            >
              {/* The list is capped. Saying so matters: an agent with 260
                  members who owe would otherwise see 200, tick "सब चुनें",
                  and believe their whole round was banked. */}
              {/* The list is capped at a hundred rows. Saying so matters: an
                  agent with 260 members who owe would otherwise see 100, tick
                  "सब चुनें", and believe their whole round was banked. */}
              {total > rows.length && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={t('{n} में से पहले {s} दिख रहे हैं', { n: total, s: rows.length })}
                  description={t('गाँव या खोज से छाँटकर हिस्सों में जमा करें — हर हिस्से की रसीदें अलग बनेंगी।')}
                />
              )}

              <Table
                size="small"
                rowKey="id"
                loading={members.isFetching}
                pagination={{ pageSize: 15, size: 'small' }}
                dataSource={rows}
                rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
                columns={[
                  { title: t('रजि.'), dataIndex: 'registrationNumber', width: 110 },
                  { title: t('नाम'), dataIndex: 'displayName' },
                  { title: t('पिता'), dataIndex: 'fatherName', responsive: ['lg'] },
                  { title: t('गाँव'), dataIndex: 'village', width: 130, responsive: ['md'] },
                  {
                    title: t('क्लोजिंग बकाया'),
                    dataIndex: 'dueAmount',
                    width: 130,
                    align: 'right',
                    render: (v, m) =>
                      include === 'fees' ? (
                        <Text type="secondary">—</Text>
                      ) : (
                        <Space size={4}>
                          <Text strong style={{ color: 'var(--due)' }}>{inr(v)}</Text>
                          <Tag>{m.dueCount}</Tag>
                        </Space>
                      ),
                  },
                  {
                    title: t('शुल्क बाकी'),
                    dataIndex: 'joinFeesDue',
                    width: 140,
                    align: 'right',
                    render: (v, m) => {
                      if (include === 'closings' || !(v > 0)) {
                        return <Text type="secondary">—</Text>;
                      }
                      return (
                        <Space size={4}>
                          <Text strong style={{ color: 'var(--warn)' }}>{inr(v)}</Text>
                          {/* Part-paid is worth a word — it is the difference
                              between a new member and an old debt. */}
                          {m.joinFeesPaid > 0 && <Tag color="orange">{t('आंशिक')}</Tag>}
                        </Space>
                      );
                    },
                  },
                  {
                    title: t('इस जमा में'),
                    width: 150,
                    align: 'right',
                    render: (_, m) => {
                      if (!selected.includes(m.id)) return <Text type="secondary">—</Text>;
                      const line = planByMember.get(m.id);
                      const value = edits[m.id] ?? line?.total ?? 0;
                      return (
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <InputNumber
                            size="small"
                            min={0}
                            max={owed(m)}
                            value={value}
                            prefix="₹"
                            style={{ width: '100%' }}
                            onChange={(v) =>
                              setEdits((prev) => ({ ...prev, [m.id]: v ?? 0 }))
                            }
                          />
                          {/* Where the money actually lands. Without this a
                              line reading ₹9,000 says nothing about whether it
                              cleared the fee or the closings. */}
                          {line?.joinFee > 0 && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {t('शुल्क {f}', { f: inr(line.joinFee) })}
                              {line.closingAmount > 0
                                ? ` · ${t('क्लोजिंग {c}', { c: inr(line.closingAmount) })}`
                                : ''}
                            </Text>
                          )}
                        </Space>
                      );
                    },
                  },
                ]}
              />
            </Card>

            <Card size="small" title={t('कितना जमा हुआ')}>
              <Row gutter={12} align="bottom">
                <Col xs={24} md={6}>
                  <Text type="secondary">{t('कुल राशि')}</Text>
                  <InputNumber
                    value={amount}
                    onChange={(v) => {
                      setAmount(v);
                      // A new total means the old hand-edits no longer belong
                      // to it — the split is recomputed from scratch.
                      setEdits({});
                    }}
                    min={0}
                    prefix="₹"
                    size="large"
                    style={{ width: '100%' }}
                    placeholder="20000"
                    disabled={hasEdits}
                  />
                </Col>

                <Col xs={24} md={10}>
                  <Text type="secondary">{t('कैसे बाँटें')}</Text>
                  <div>
                    <Segmented
                      value={rule}
                      onChange={(v) => { setRule(v); setEdits({}); }}
                      disabled={hasEdits}
                      options={[
                        { label: t('एक-एक सदस्य पूरा'), value: 'member' },
                        { label: t('सबसे पुरानी क्लोजिंग पहले'), value: 'oldest' },
                      ]}
                    />
                  </div>
                </Col>

                <Col xs={24} md={8}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text type="secondary">
                      {t('{n} सदस्य चुने · कुल बकाया {amt}', {
                        n: selected.length,
                        amt: inr(selectedDue),
                      })}
                    </Text>
                    {hasEdits && (
                      <Button size="small" onClick={() => setEdits({})}>
                        {t('अपने बदलाव हटाकर दोबारा बाँटें')}
                      </Button>
                    )}
                  </Space>
                </Col>
              </Row>

              {/* Money that could not be placed anywhere. Shown as a warning
                  rather than quietly dropped: it is the agent's cash, and if
                  the trust keeps it, somebody has to decide to. */}
              {plan?.leftover > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={t('{amt} बचा — चुने हुए सदस्यों का बकाया इतना नहीं है', {
                    amt: inr(plan.leftover),
                  })}
                  description={t('और सदस्य चुनें, या रकम घटाएँ। बचा हुआ पैसा दर्ज नहीं होगा।')}
                />
              )}
            </Card>

            <Card size="small" title={t('भुगतान विवरण')}>
              <Row gutter={12}>
                <Col xs={12} md={6}>
                  <Text type="secondary">{t('तरीका')}</Text>
                  <Select
                    value={method}
                    onChange={setMethod}
                    options={masters.paymentMethods}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Text type="secondary">{t('तिथि')}</Text>
                  <DatePicker
                    value={paidAt}
                    onChange={setPaidAt}
                    format="DD-MM-YYYY"
                    allowClear={false}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Text type="secondary">
                    {t('संदर्भ नंबर')} {method === 'online' && <Text type="danger">*</Text>}
                  </Text>
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={method === 'online' ? t('ज़रूरी') : t('वैकल्पिक')}
                  />
                </Col>
                <Col xs={24} style={{ marginTop: 12 }}>
                  <Text type="secondary">{t('टिप्पणी')}</Text>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Col>
              </Row>
            </Card>

            <Card>
              <Row align="middle" justify="space-between" gutter={[12, 12]}>
                <Col>
                  <Space size={24} wrap>
                    <Statistic
                      title={t('{n} सदस्यों पर लगेगा', { n: plan?.memberCount ?? 0 })}
                      value={inr(plan?.allocated ?? 0)}
                      valueStyle={{ fontSize: 26, color: 'var(--paid)' }}
                    />
                    {plan?.feeTotal > 0 && (
                      <Statistic
                        title={t('इसमें नामांकन शुल्क')}
                        value={inr(plan.feeTotal)}
                        valueStyle={{ fontSize: 20 }}
                      />
                    )}
                    {plan?.leftover > 0 && (
                      <Statistic
                        title={t('नहीं लगा')}
                        value={inr(plan.leftover)}
                        valueStyle={{ fontSize: 20, color: 'var(--warn)' }}
                      />
                    )}
                  </Space>
                </Col>
                <Col>
                  <Space>
                    <Title level={5} style={{ margin: 0 }}>
                      <TeamOutlined /> {plan?.memberCount ?? 0} {t('रसीदें बनेंगी')}
                    </Title>
                    <Button
                      type="primary"
                      size="large"
                      icon={<WalletOutlined />}
                      loading={submit.isPending || preview.isFetching}
                      disabled={!plan?.lines?.length}
                      onClick={() => submit.mutate()}
                    >
                      {t('रसीदें बनाएँ')}
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Card>
          </>
        )}
      </Space>
    </>
  );
}
