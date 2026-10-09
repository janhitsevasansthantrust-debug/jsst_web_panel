'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Empty, Row, Segmented, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ArrowRightOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * "क्लोजिंग पर असर" — on the member EDIT form, as soon as the joining date,
 * birth date or location group differs from what is saved.
 *
 * Asks the server what the member's bill would be with the new values
 * (nothing is saved) and shows: due before → after, the rate before → after,
 * which closings become payable and which stop, and every closing the member
 * is billed for after the change with its state. A closing that is already
 * PAID but would no longer apply blocks Save (`onBlock`) — its receipt must be
 * reversed first, because money is never silently dropped.
 */
export default function JoinDateImpact({ memberId, saved, joinDate, bobDate, locationGroupId, onBlock }) {
  const t = useT();
  const [view, setView] = useState('changes');

  const joinMs = joinDate ? joinDate.startOf('day').valueOf() : null;
  const bobMs = bobDate ? bobDate.startOf('day').valueOf() : null;
  const changed = Boolean(saved) && joinMs != null && (
    joinMs !== saved.joinDateMs ||
    (bobMs != null && bobMs !== saved.bobDateMs) ||
    (locationGroupId ?? null) !== (saved.locactionGroupId ?? null)
  );

  // Debounce: a date picker can fire several changes while the user scrolls.
  const [args, setArgs] = useState(null);
  useEffect(() => {
    if (!changed) { setArgs(null); return undefined; }
    const h = setTimeout(() => setArgs({ joinDateMs: joinMs, bobDateMs: bobMs, locationGroupId: locationGroupId ?? null }), 350);
    return () => clearTimeout(h);
  }, [changed, joinMs, bobMs, locationGroupId]);

  const q = useQuery({
    queryKey: ['member-date-preview', memberId, args],
    queryFn: () => api.members.previewDates(memberId, args),
    enabled: Boolean(memberId && args),
    staleTime: 30_000,
  });

  const data = q.data;
  const blocked = Boolean(changed && data && !data.canSave);
  // Save waits while the preview is being worked out, and is refused when a
  // paid closing would be dropped (the server refuses it too).
  useEffect(() => { onBlock?.(changed && (blocked || q.isFetching)); }, [changed, blocked, q.isFetching, onBlock]);

  const columns = useMemo(() => [
    { title: '#', dataIndex: 'seq', width: 56 },
    {
      title: t('क्लोजिंग'),
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name || '—'}</Text>
          {r.regNo ? <Text type="secondary" style={{ fontSize: 12 }}>{t('रजि.')} {r.regNo}</Text> : null}
        </Space>
      ),
    },
    { title: t('तारीख़'), dataIndex: 'dateMs', width: 110, render: (v) => (v ? dayjs(v).format('DD-MM-YYYY') : '—') },
    { title: t('राशि'), width: 100, render: (_, r) => inr(r.amount ?? r.amountAfter ?? r.amountBefore) },
    {
      title: t('स्थिति'),
      width: 150,
      render: (_, r) => {
        if (r.kind === 'conflict') return <Tag color="red" icon={<WarningOutlined />}>{t('जमा है — रसीद रद्द करें')}</Tag>;
        if (r.kind === 'added') return <Tag color="orange">{t('अब देय')}</Tag>;
        if (r.kind === 'removed') return <Tag>{t('अब देय नहीं')}</Tag>;
        const map = { paid: ['green', 'जमा'], due: ['red', 'बाकी'], partial: ['gold', 'आंशिक'], exempt: ['default', 'छूट'] };
        const [c, l] = map[r.status] ?? ['default', r.status];
        return (
          <Space size={4}>
            <Tag color={c}>{t(l)}{r.status === 'partial' ? ` · ${inr(r.remaining)}` : ''}</Tag>
            {r.isNew ? <Tag color="orange">{t('नई')}</Tag> : null}
          </Space>
        );
      },
    },
  ], [t]);

  if (!changed) return null;

  const title = (
    <Space>
      <span>{t('क्लोजिंग पर असर')}</span>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
        {saved.joinDateMs ? dayjs(saved.joinDateMs).format('DD-MM-YYYY') : '—'} <ArrowRightOutlined /> {joinDate?.format('DD-MM-YYYY')}
      </Text>
    </Space>
  );

  if (!data) {
    return (
      <Card size="small" title={title} style={{ marginBottom: 16 }}>
        {q.isError ? <Alert type="error" showIcon message={q.error?.message ?? t('असर नहीं गिना जा सका')} />
          : <Space><Spin size="small" /> <Text type="secondary">{t('नई तारीख़ से बकाया गिना जा रहा है…')}</Text></Space>}
      </Card>
    );
  }

  const changes = [
    ...data.conflicts.map((r) => ({ ...r, kind: 'conflict', amount: r.paid })),
    ...data.added.map((r) => ({ ...r, kind: 'added', amount: r.amountAfter })),
    ...data.removed.filter((r) => !data.conflicts.some((c) => c.seq === r.seq)).map((r) => ({ ...r, kind: 'removed', amount: r.amountBefore })),
  ];
  const dueDelta = data.after.dueAmount - data.before.dueAmount;
  const rateChanged = data.member.payAmount !== data.next.payAmount;

  return (
    <Card
      size="small"
      title={title}
      style={{ marginBottom: 16, borderColor: blocked ? '#ffa39e' : '#91caff', background: blocked ? '#fff1f0' : '#f0f7ff' }}
      extra={q.isFetching ? <Spin size="small" /> : null}
    >
      {data.rateError ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={data.rateError} /> : null}
      {data.conflicts.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('यह तारीख़ सेव नहीं होगी')}
          description={t('{n} क्लोजिंग का पैसा जमा है, पर नई तारीख़ से वे इस सदस्य पर लागू नहीं होंगी। पहले उनकी रसीद रद्द करें, या तारीख़ इनसे पहले की रखें।', { n: data.conflicts.length })}
        />
      ) : null}

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Statistic title={t('लागू क्लोजिंग')} value={`${data.before.eligibleCount} → ${data.after.eligibleCount}`} valueStyle={{ fontSize: 18 }} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('बाकी क्लोजिंग')} value={`${data.before.dueCount} → ${data.after.dueCount}`} valueStyle={{ fontSize: 18 }} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title={t('कुल बकाया')}
            value={inr(data.after.dueAmount)}
            valueStyle={{ fontSize: 18, color: dueDelta > 0 ? 'var(--due, #cf1322)' : dueDelta < 0 ? 'var(--paid, #389e0d)' : undefined }}
            suffix={dueDelta ? <Text style={{ fontSize: 12 }} type="secondary">({dueDelta > 0 ? '+' : '−'}{inr(Math.abs(dueDelta))})</Text> : null}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('पहले')} {inr(data.before.dueAmount)}</Text>
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title={t('प्रति क्लोजिंग राशि')}
            value={rateChanged ? `${inr(data.member.payAmount)} → ${inr(data.next.payAmount)}` : inr(data.next.payAmount)}
            valueStyle={{ fontSize: 18 }}
          />
          {rateChanged ? <Text type="secondary" style={{ fontSize: 12 }}>{t('जमा राशि नहीं बदलेगी, सिर्फ़ बाकी')}</Text> : null}
        </Col>
      </Row>

      <Segmented
        size="small"
        style={{ marginBottom: 8 }}
        value={view}
        onChange={setView}
        options={[
          { value: 'changes', label: `${t('बदलाव')} (${changes.length})` },
          { value: 'all', label: `${t('नई तारीख़ से सभी देय क्लोजिंग')} (${data.closings.length})` },
        ]}
      />
      {view === 'changes' ? (
        changes.length ? (
          <Table size="small" rowKey={(r) => `${r.kind}-${r.seq}`} columns={columns} dataSource={changes} pagination={changes.length > 8 ? { pageSize: 8, size: 'small' } : false} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('किसी क्लोजिंग पर असर नहीं — सिर्फ़ तारीख़ बदलेगी')} />
        )
      ) : (
        <Table size="small" rowKey="seq" columns={columns} dataSource={data.closings} pagination={data.closings.length > 8 ? { pageSize: 8, size: 'small' } : false}
          locale={{ emptyText: t('नई तारीख़ से कोई क्लोजिंग देय नहीं') }} />
      )}
      {!blocked ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('सेव करते ही सदस्य का बकाया, रसीद काउंटर और ऐप — सब इसी हिसाब से दिखेंगे।')}
        </Text>
      ) : null}
    </Card>
  );
}
