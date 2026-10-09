'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Empty, Input, InputNumber,
  Result, Row, Select, Space, Statistic, Table, Tag, App, Typography,
  Descriptions, Divider,
} from 'antd';
import { SearchOutlined, WalletOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import PageHeader from '../../../components/ui/PageHeader.js';
import { inr } from '../../../components/ui/DataGrid.js';
import { api, keys, newIdempotencyKey } from '../../../lib/api.js';
import { useMasters } from '../../../lib/useMasters.js';
import { useMemberSearch } from '../../../lib/useMemberSearch.js';
import { joinFeesState } from '../../../lib/joinFees.js';
import { useT } from '../../../i18n/index.js';

const { Text, Title, Paragraph } = Typography;

/**
 * Take a payment (भुगतान लें).
 *
 * Find a member, tick the closings they are paying for, submit. Behind it,
 * everything runs in one Firestore transaction that re-reads the member's
 * ledger and decides for itself what is genuinely due — so a double-tap, a
 * stale tab or a retried request can never charge twice.
 *
 * The idempotency key is generated once per submit attempt, not per retry:
 * that is what makes a retried request return the ORIGINAL receipt instead of
 * creating a second one.
 */
export default function CollectPage() {
  const t = useT();
  // Dropdown values come from the master screen, not a source file.
  const masters = useMasters();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [term, setTerm] = useState('');
  const [memberId, setMemberId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [method, setMethod] = useState('cash');
  const [paidAt, setPaidAt] = useState(dayjs());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);

  /**
   * The joining fee, when part of it is still outstanding.
   *
   * It was only ever collectable at the moment of enrolment: tick the box on
   * the member form or never. So a member who put down ₹2,100 of ₹11,000 had
   * no screen anywhere that would take the other ₹8,900. It belongs here, on
   * the counter screen, beside everything else they owe.
   */
  const [takeFee, setTakeFee] = useState(false);
  const [feeNow, setFeeNow] = useState(0);

  /**
   * The member list, searched in the browser.
   *
   * This screen is the counter: someone is standing there while the operator
   * types. A request per keystroke over a village connection is the whole
   * delay, and there is nothing to fetch — the list is already here.
   */
  const index = useMemberSearch();

  const localHits = useMemo(
    () => (term.trim() ? index.search(term, 30) : []),
    [term, index],
  );

  // Only for a trust too large to search locally.
  const remote = useQuery({
    queryKey: keys.memberSearch(term),
    queryFn: ({ signal }) => api.members.search(term, undefined, signal),
    enabled: !index.local && index.ready && term.trim().length >= 2,
  });

  const results = index.local
    ? (localHits ?? [])
    : (remote.data?.members ?? []).map((m) => ({
        id: m.id,
        reg: m.registrationNumber,
        name: m.displayName,
        father: m.fatherName,
        phone: m.phone,
        village: m.village,
        status: m.status,
        due: m.dueAmount ?? 0,
      }));

  const ledger = useQuery({
    queryKey: keys.memberLedger(memberId),
    queryFn: () => api.members.ledger(memberId),
    enabled: Boolean(memberId),
  });

  const due = ledger.data?.due?.items ?? [];
  const member = ledger.data?.member;

  const fees = useMemo(() => joinFeesState(member ?? {}), [member]);

  // A different member has a different fee — never carry the last one's
  // figure over to them.
  useEffect(() => {
    setTakeFee(false);
    setFeeNow(0);
  }, [memberId]);

  const feeAmount = takeFee ? Math.min(Number(feeNow) || 0, fees.due) : 0;

  const selectedTotal = useMemo(
    () =>
      due
        .filter((d) => selected.includes(d.seq))
        .reduce((sum, d) => sum + d.remaining, 0),
    [due, selected],
  );

  const grandTotal = selectedTotal + feeAmount;

  const pay = useMutation({
    mutationFn: () =>
      api.payments.create(
        {
          memberId,
          seqs: selected,
          ...(feeAmount > 0 ? { joinFeeAmount: feeAmount } : {}),
          method,
          paidAtMs: paidAt.valueOf(),
          reference,
          note,
        },
        newIdempotencyKey(),
      ),
    onSuccess: (res) => {
      setReceipt(res);
      setSelected([]);
      setTakeFee(false);
      setFeeNow(0);
      message.success(t('रसीद {no} बन गई', { no: res.receipt.receiptNo }));
      queryClient.invalidateQueries({ queryKey: keys.memberLedger(memberId) });
      queryClient.invalidateQueries({ queryKey: keys.stats });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => message.error(err.message),
  });

  function reset() {
    setReceipt(null);
    setMemberId(null);
    setTerm('');
    setSelected([]);
    setReference('');
    setNote('');
    setTakeFee(false);
    setFeeNow(0);
  }

  /* ── Receipt view ──────────────────────────────────────────────────────── */

  if (receipt) {
    const r = receipt.receipt;
    return (
      <>
        <PageHeader title={t('भुगतान लें')} />
        <Card>
          <Result
            status="success"
            title={t('रसीद {no}', { no: r.receiptNo })}
            subTitle={`${r.memberSnapshot.name} — ${inr(r.totalAmount)}`}
            extra={[
              /* Printing is the point of a receipt. It opens in a tab rather
                 than downloading, because the next thing that happens is
                 Ctrl+P, not a trip to the Downloads folder. */
              <Button
                key="print"
                type="primary"
                icon={<PrinterOutlined />}
                onClick={() => window.open(api.payments.receiptUrl(r.id), '_blank')}
              >
                {t('रसीद छापें')}
              </Button>,
              <Button key="new" onClick={reset}>
                {t('अगला भुगतान')}
              </Button>,
            ]}
          />

          <Descriptions size="small" bordered column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t('सदस्य')}>{r.memberSnapshot.name}</Descriptions.Item>
            <Descriptions.Item label={t('रजि. नंबर')}>{r.memberSnapshot.regNo}</Descriptions.Item>
            <Descriptions.Item label={t('क्लोजिंग')}>{r.itemCount}</Descriptions.Item>
            {r.joinFeeAmount > 0 && (
              <Descriptions.Item label={t('नामांकन शुल्क')}>
                {inr(r.joinFeeAmount)}
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t('राशि')}>{inr(r.totalAmount)}</Descriptions.Item>
            <Descriptions.Item label={t('तरीका')}>{r.method}</Descriptions.Item>
            <Descriptions.Item label={t('तिथि')}>
              {new Date(r.paidAtMs).toLocaleDateString('hi-IN')}
            </Descriptions.Item>
          </Descriptions>

          <Table
            size="small"
            rowKey="seq"
            pagination={false}
            dataSource={r.items}
            columns={[
              { title: t('क्रम'), dataIndex: 'seq', width: 70 },
              { title: t('नाम'), dataIndex: 'name' },
              { title: t('रजि.'), dataIndex: 'regNo', width: 100 },
              {
                title: t('राशि'),
                dataIndex: 'amount',
                width: 110,
                align: 'right',
                render: (v) => inr(v),
              },
            ]}
          />

          {receipt.rejected?.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message={t('{n} लाइनें नहीं ली गईं', { n: receipt.rejected.length })}
              description={
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {receipt.rejected.map((x) => (
                    <li key={x.seq}>
                      {t('क्रम {seq}', { seq: x.seq })} — {rejectReason(x.reason, t)}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </Card>
      </>
    );
  }

  /* ── Collection form ───────────────────────────────────────────────────── */

  return (
    <>
      <PageHeader
        title={t('भुगतान लें')}
        subtitle={t('सदस्य खोजें, क्लोजिंग चुनें, रसीद बनाएँ')}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card size="small" title={t('सदस्य खोजें')}>
            <Input
              allowClear
              autoFocus
              prefix={<SearchOutlined />}
              placeholder={t('नाम, रजि. नंबर या मोबाइल')}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setMemberId(null);
                setSelected([]);
              }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {index.local
                ? t('{n} सदस्य इसी डिवाइस पर — टाइप करते ही नतीजे, बिना इंटरनेट भी', {
                    n: index.count.toLocaleString('en-IN'),
                  })
                : t('खोज सर्वर से हो रही है')}
            </Text>

            <div style={{ marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
              {!index.ready && <Text type="secondary">{t('सूची लोड हो रही है…')}</Text>}
              {index.ready && term.trim() && results.length === 0 && (
                <Empty description={t('कोई सदस्य नहीं मिला')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
              {results.map((m) => (
                <div
                  key={m.id}
                  onClick={() => {
                    setMemberId(m.id);
                    setSelected([]);
                    // On a phone the member's dues are BELOW the search list,
                    // so picking someone appeared to do nothing. Bring them up.
                    if (typeof window !== 'undefined' && window.innerWidth < 992) {
                      setTimeout(() => document.getElementById('collect-member')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
                    }
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: memberId === m.id ? '#fff1f1' : 'transparent',
                    border: `1px solid ${memberId === m.id ? 'var(--brand)' : 'transparent'}`,
                  }}
                >
                  <Space size={6}>
                    <Text strong>{m.name}</Text>
                    <Text type="secondary">#{m.reg}</Text>
                  </Space>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {m.village || '—'} · {m.phone || '—'}
                    </Text>
                    {m.due > 0 && (
                      <Tag color="red" style={{ marginInlineStart: 6 }}>
                        {inr(m.due)}
                      </Tag>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={15} id="collect-member" style={{ scrollMarginTop: 72 }}>
          {!memberId && (
            <Card className="collect-empty">
              <Empty description={t('बाईं ओर से सदस्य चुनें')} />
            </Card>
          )}

          {memberId && ledger.isLoading && <Card loading />}

          {memberId && member && (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Card size="small">
                <Row gutter={12} align="middle">
                  <Col flex="auto">
                    <Title level={5} style={{ margin: 0 }}>
                      {member.displayName}{' '}
                      <Text type="secondary">#{member.registrationNumber}</Text>
                    </Title>
                    <Text type="secondary">
                      {member.fatherName} · {member.village} · {member.phone}
                    </Text>
                  </Col>
                  <Col>
                    <Statistic
                      title={t('कुल बकाया')}
                      value={inr(ledger.data.due.amount)}
                      valueStyle={{ color: 'var(--due)', fontSize: 22 }}
                    />
                  </Col>
                </Row>
              </Card>

              <Card
                size="small"
                title={t('बकाया क्लोजिंग ({n})', { n: due.length })}
                extra={
                  <Space>
                    <Button
                      size="small"
                      onClick={() => setSelected(due.map((d) => d.seq))}
                      disabled={!due.length}
                    >
                      {t('सब चुनें')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setSelected([])}
                      disabled={!selected.length}
                    >
                      {t('हटाएँ')}
                    </Button>
                  </Space>
                }
              >
                {due.length === 0 ? (
                  <Empty description={t('कोई बकाया नहीं — सब भुगतान हो चुका')} />
                ) : (
                  <Table
                    size="small"
                    rowKey="seq"
                    pagination={{ pageSize: 12, size: 'small' }}
                    dataSource={due}
                    rowSelection={{
                      selectedRowKeys: selected,
                      onChange: setSelected,
                    }}
                    columns={[
                      { title: t('क्रम'), dataIndex: 'seq', width: 70 },
                      { title: t('नाम'), dataIndex: 'name' },
                      { title: t('रजि.'), dataIndex: 'regNo', width: 90 },
                      {
                        title: t('तिथि'),
                        dataIndex: 'dateMs',
                        width: 110,
                        render: (v) => (v ? new Date(v).toLocaleDateString('hi-IN') : '—'),
                      },
                      {
                        title: t('राशि'),
                        dataIndex: 'remaining',
                        width: 100,
                        align: 'right',
                        render: (v, row) =>
                          row.partial ? (
                            <Space size={4}>
                              {inr(v)}
                              <Tag color="orange">{t('आंशिक')}</Tag>
                            </Space>
                          ) : (
                            inr(v)
                          ),
                      },
                    ]}
                  />
                )}
              </Card>

              {fees.due > 0 && (
                <Card
                  size="small"
                  title={
                    <Space>
                      {t('नामांकन शुल्क')}
                      <Tag color={fees.partial ? 'orange' : 'red'}>
                        {fees.partial ? t('आंशिक जमा') : t('बाकी')}
                      </Tag>
                    </Space>
                  }
                >
                  <Row gutter={12} align="middle">
                    <Col xs={8} md={5}>
                      <Statistic
                        title={t('कुल शुल्क')}
                        value={inr(fees.total)}
                        valueStyle={{ fontSize: 18 }}
                      />
                    </Col>
                    <Col xs={8} md={5}>
                      <Statistic
                        title={t('अब तक जमा')}
                        value={inr(fees.paid)}
                        valueStyle={{ fontSize: 18, color: 'var(--paid)' }}
                      />
                    </Col>
                    <Col xs={8} md={5}>
                      <Statistic
                        title={t('बाकी')}
                        value={inr(fees.due)}
                        valueStyle={{ fontSize: 18, color: 'var(--due)' }}
                      />
                    </Col>
                    <Col xs={24} md={9}>
                      <Checkbox
                        checked={takeFee}
                        onChange={(e) => {
                          setTakeFee(e.target.checked);
                          // Default to clearing it — the common case — but
                          // leave it editable for another part payment.
                          setFeeNow(e.target.checked ? fees.due : 0);
                        }}
                      >
                        {t('इस रसीद में शुल्क भी लें')}
                      </Checkbox>

                      {takeFee && (
                        <InputNumber
                          min={0}
                          max={fees.due}
                          value={feeNow}
                          onChange={(v) => setFeeNow(v ?? 0)}
                          prefix="₹"
                          style={{ width: '100%', marginTop: 8 }}
                        />
                      )}
                    </Col>
                  </Row>
                </Card>
              )}

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
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Col>
                </Row>

                <Divider style={{ margin: '16px 0' }} />

                <Row align="middle" justify="space-between">
                  <Col>
                    <Statistic
                      title={
                        feeAmount > 0
                          ? t('{n} क्लोजिंग + नामांकन शुल्क {f}', {
                              n: selected.length,
                              f: inr(feeAmount),
                            })
                          : t('{n} क्लोजिंग चुनी', { n: selected.length })
                      }
                      value={inr(grandTotal)}
                      valueStyle={{ fontSize: 26, color: 'var(--paid)' }}
                    />
                  </Col>
                  <Col>
                    <Button
                      type="primary"
                      size="large"
                      icon={<WalletOutlined />}
                      loading={pay.isPending}
                      disabled={!selected.length && feeAmount <= 0}
                      onClick={() => pay.mutate()}
                    >
                      {t('रसीद बनाएँ')}
                    </Button>
                  </Col>
                </Row>
              </Card>
            </Space>
          )}
        </Col>
      </Row>
    </>
  );
}

function rejectReason(code, t) {
  return (
    {
      already_paid: t('पहले ही भुगतान हो चुका है'),
      not_eligible: t('यह सदस्य इसके लिए देय नहीं है'),
      exempt: t('छूट दी गई है'),
      closing_reverted: t('क्लोजिंग वापस ली जा चुकी है'),
      unknown_closing: t('क्लोजिंग नहीं मिली'),
      amount_exceeds_due: t('राशि बकाया से ज़्यादा है'),
      invalid_amount: t('राशि गलत है'),
    }[code] ?? code
  );
}
