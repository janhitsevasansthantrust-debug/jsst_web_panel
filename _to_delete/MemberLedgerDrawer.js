'use client';

import { Drawer, Descriptions, Statistic, Row, Col, Table, Tag, Empty, Spin, Card, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';

import { api, keys } from '../../lib/api.js';
import { inr } from '../ui/DataGrid.js';

const { Text } = Typography;

/**
 * One member's complete position.
 *
 * Cost: 1 member document + the cached closings index + their recent receipts.
 *
 * The old system built this same drawer by reading every one of that member's
 * ~500 `payment_pending` documents — and did it again every time the drawer
 * was reopened.
 */
export default function MemberLedgerDrawer({ memberId, open, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: keys.memberLedger(memberId),
    queryFn: () => api.members.ledger(memberId),
    enabled: open && Boolean(memberId),
  });

  const member = data?.member;

  return (
    <Drawer
      title={member ? `${member.displayName} — #${member.registrationNumber}` : 'सदस्य'}
      open={open}
      onClose={onClose}
      width={840}
      destroyOnHidden
    >
      {isLoading && <Spin style={{ display: 'block', margin: '48px auto' }} />}
      {error && <Text type="danger">{error.message}</Text>}

      {data && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="बकाया"
                  value={inr(data.due.amount)}
                  valueStyle={{ color: '#b91c1c', fontSize: 20 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.due.count} क्लोजिंग
                </Text>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="जमा"
                  value={inr(data.settled.amount)}
                  valueStyle={{ color: '#15803d', fontSize: 20 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.settled.count} क्लोजिंग
                </Text>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="कुल देय"
                  value={inr(data.eligible.amount)}
                  valueStyle={{ fontSize: 20 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.eligible.count} क्लोजिंग
                </Text>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="छूट"
                  value={data.settled.exemptCount}
                  valueStyle={{ fontSize: 20 }}
                />
              </Card>
            </Col>
          </Row>

          <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="पिता">{member.fatherName || '—'}</Descriptions.Item>
            <Descriptions.Item label="मोबाइल">{member.phone || '—'}</Descriptions.Item>
            <Descriptions.Item label="गाँव">{member.village || '—'}</Descriptions.Item>
            <Descriptions.Item label="ज़िला">{member.district || '—'}</Descriptions.Item>
            <Descriptions.Item label="जुड़ने की तिथि">
              {member.joinDateMs
                ? new Date(member.joinDateMs).toLocaleDateString('hi-IN')
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="एजेंट">{member.agentName || '—'}</Descriptions.Item>
            <Descriptions.Item label="प्रति क्लोजिंग">{inr(member.payAmount)}</Descriptions.Item>
            <Descriptions.Item label="स्थिति">
              <Tag color={statusColor(member.status)}>{statusLabel(member.status)}</Tag>
            </Descriptions.Item>
          </Descriptions>

          <Card size="small" title={`बकाया क्लोजिंग (${data.due.count})`}>
            {data.due.items.length === 0 ? (
              <Empty description="कोई बकाया नहीं" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="seq"
                pagination={{ pageSize: 10, size: 'small' }}
                dataSource={data.due.items}
                columns={[
                  { title: 'क्रम', dataIndex: 'seq', width: 70 },
                  { title: 'नाम', dataIndex: 'name' },
                  { title: 'रजि.', dataIndex: 'regNo', width: 90 },
                  {
                    title: 'तिथि',
                    dataIndex: 'dateMs',
                    width: 110,
                    render: (v) => (v ? new Date(v).toLocaleDateString('hi-IN') : '—'),
                  },
                  {
                    title: 'राशि',
                    dataIndex: 'remaining',
                    width: 110,
                    align: 'right',
                    render: (v, row) =>
                      row.partial ? (
                        <span>
                          {inr(v)}{' '}
                          <Tag color="orange" style={{ marginInlineStart: 4 }}>
                            आंशिक
                          </Tag>
                        </span>
                      ) : (
                        inr(v)
                      ),
                  },
                ]}
              />
            )}
          </Card>

          <Card size="small" title={`हाल की रसीदें (${data.receipts.length})`}>
            {data.receipts.length === 0 ? (
              <Empty description="कोई रसीद नहीं" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.receipts}
                columns={[
                  { title: 'रसीद नं.', dataIndex: 'receiptNo', width: 160 },
                  {
                    title: 'तिथि',
                    dataIndex: 'paidAtMs',
                    width: 110,
                    render: (v) => (v ? new Date(v).toLocaleDateString('hi-IN') : '—'),
                  },
                  { title: 'क्लोजिंग', dataIndex: 'itemCount', width: 90, align: 'right' },
                  {
                    title: 'राशि',
                    dataIndex: 'totalAmount',
                    width: 110,
                    align: 'right',
                    render: (v) => inr(v),
                  },
                  {
                    title: '',
                    dataIndex: 'status',
                    width: 90,
                    render: (v) =>
                      v === 'cancelled' ? <Tag color="red">रद्द</Tag> : <Tag color="green">जमा</Tag>,
                  },
                ]}
              />
            )}
          </Card>
        </Space>
      )}
    </Drawer>
  );
}

export function statusLabel(status) {
  return (
    {
      pending: 'लंबित',
      accepted: 'स्वीकृत',
      closed: 'क्लोज़',
      blocked: 'ब्लॉक',
      left: 'छोड़ा',
    }[status] ?? status
  );
}

export function statusColor(status) {
  return (
    {
      pending: 'orange',
      accepted: 'green',
      closed: 'blue',
      blocked: 'red',
      left: 'default',
    }[status] ?? 'default'
  );
}
