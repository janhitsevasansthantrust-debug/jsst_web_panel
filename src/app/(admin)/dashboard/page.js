'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Alert, Skeleton, Typography, Tag, Space } from 'antd';
import {
  TeamOutlined,
  HeartOutlined,
  WalletOutlined,
  ExclamationCircleOutlined,
  PercentageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import StatCard from '../../../components/ui/StatCard.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Title, Text } = Typography;

const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

/**
 * The dashboard.
 *
 * TWO Firestore reads: the counters document and the cached closings index.
 * The old system built this same screen by reading the entire payment_pending
 * collection plus the entire transactions collection — around 2.5 million
 * documents, on every single load.
 */
export default function DashboardPage() {
  const t = useT();
  const stats = useQuery({
    queryKey: keys.stats,
    queryFn: () => api.stats(),
  });

  const closings = useQuery({
    queryKey: keys.closings,
    queryFn: () => api.closings.list(),
  });

  if (stats.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('डैशबोर्ड लोड नहीं हो सका')}
        description={stats.error?.message}
      />
    );
  }

  const s = stats.data?.stats ?? {};
  const members = s.members ?? {};
  const money = s.money ?? {};
  const closingStats = s.closings ?? {};
  const commission = s.commission ?? {};

  const recent = (closings.data?.closings ?? []).slice(0, 6);

  return (
    <Space direction="vertical" size={22} style={{ width: '100%' }}>
      <PageHeader
        title={t('डैशबोर्ड')}
        subtitle={
          <>
            <ThunderboltOutlined style={{ color: 'var(--accent)' }} />{' '}
            {t('पूरा पेज सिर्फ़ 2 Firestore reads लेता है')}
          </>
        }
      />

      <Skeleton loading={stats.isLoading} active paragraph={{ rows: 4 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<TeamOutlined />}
              color="var(--brand)"
              label={t('कुल सदस्य')}
              value={num(members.total)}
              extra={
                <>
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    {t('सक्रिय {n}', { n: num(members.accepted) })}
                  </Tag>
                  {members.pending > 0 && (
                    <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                      {t('लंबित {n}', { n: num(members.pending) })}
                    </Tag>
                  )}
                  {members.closed > 0 && (
                    <Tag style={{ marginInlineEnd: 0 }}>{t('क्लोज़ {n}', { n: num(members.closed) })}</Tag>
                  )}
                </>
              }
            />
          </Col>

          <Col xs={12} lg={6}>
            <StatCard
              icon={<HeartOutlined />}
              color="var(--accent)"
              label={t('कुल क्लोजिंग')}
              value={num(closingStats.total)}
              extra={
                <>
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    {t('चालू {n}', { n: num(closingStats.active) })}
                  </Tag>
                  {closingStats.reverted > 0 && (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      {t('वापस {n}', { n: num(closingStats.reverted) })}
                    </Tag>
                  )}
                </>
              }
            />
          </Col>

          <Col xs={12} lg={6}>
            <StatCard
              icon={<WalletOutlined />}
              color="var(--paid)"
              label={t('कुल जमा')}
              value={inr(money.collectedTotal)}
              hint={t('जॉइनिंग फीस {amt}', { amt: inr(money.joinFeesTotal) })}
            />
          </Col>

          <Col xs={12} lg={6}>
            <StatCard
              icon={<ExclamationCircleOutlined />}
              color="var(--due)"
              label={t('कुल बकाया')}
              value={inr(money.dueTotal)}
              hint={t('वसूली {pct}%', { pct: recovery(money) })}
            />
          </Col>
        </Row>
      </Skeleton>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <span>{t('हाल की क्लोजिंग')}</span>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>{recent.length}</Tag>
              </Space>
            }
            loading={closings.isLoading}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                1 cached read
              </Text>
            }
            styles={{ body: { paddingTop: 6 } }}
          >
            {recent.length === 0 && (
              <Text type="secondary">{t('अभी कोई क्लोजिंग नहीं')}</Text>
            )}
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              {recent.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 4px',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      aria-hidden
                      style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        display: 'grid', placeItems: 'center',
                        background: 'var(--brand-wash)', color: 'var(--brand)',
                        fontWeight: 700, fontSize: 13,
                      }}
                    >
                      {c.seq}
                    </div>
                    <div>
                      <Text strong>{c.name || '—'}</Text>{' '}
                      <Text type="secondary">#{c.regNo}</Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {c.dateMs
                            ? new Date(c.dateMs).toLocaleDateString('hi-IN')
                            : '—'}
                        </Text>
                      </div>
                    </div>
                  </div>
                  <Tag color={c.status === 'reverted' ? 'red' : 'green'} style={{ fontWeight: 600 }}>
                    {inr(c.amount)}
                  </Tag>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={t('एजेंट कमीशन')}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title={t('कुल कमाया')}
                  value={inr(commission.earnedTotal)}
                  prefix={<PercentageOutlined />}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={t('देय बाकी')}
                  value={inr(commission.dueTotal)}
                  valueStyle={{ color: 'var(--warn)' }}
                />
              </Col>
            </Row>
            <div
              style={{
                marginTop: 16, padding: 12, borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-wash)', border: '1px solid var(--line)',
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('कमीशन हर रसीद के साथ उसी transaction में दर्ज होता है — अलग से कभी नहीं बिगड़ता।')}
              </Text>
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

const num = (n) => Number(n ?? 0).toLocaleString('en-IN');

/** What share of everything owed has actually come in. */
function recovery(money) {
  if (!money?.expectedTotal) return 0;
  return Math.round(((money.collectedTotal ?? 0) / money.expectedTotal) * 100);
}
