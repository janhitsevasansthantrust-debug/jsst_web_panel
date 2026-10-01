'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Drawer, Tabs, Descriptions, Statistic, Row, Col, Table, Tag, Empty, Spin,
  Card, Space, Typography, Button, Avatar, Image, Tooltip, App, Alert, Dropdown,
} from 'antd';
import {
  UserOutlined, InfoCircleOutlined, FileImageOutlined, WalletOutlined,
  EditOutlined, StopOutlined, CheckOutlined, DeleteOutlined, TeamOutlined,
  PrinterOutlined, SafetyCertificateOutlined, FileTextOutlined, DownOutlined,
} from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { inr } from '../ui/DataGrid.js';
import { statusLabel, statusColor, hiDate } from '../../lib/memberStatus.js';
import { joinFeesState } from '../../lib/joinFees.js';
import { MEMBER_STATUS } from '../../config/constants.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;

/**
 * One member's complete record — the same four-tab view the old app had, but
 * paid for very differently.
 *
 * Cost: 1 member document + the cached closings index + their last 20 receipts.
 * The old drawer rebuilt this by reading every one of that member's ~500
 * `payment_pending` documents, and did it again on every reopen.
 */
export default function MemberDetailsDrawer({ memberId, open, onClose, onEdit }) {
  const { modal, message } = App.useApp();
  const t = useT();
  const queryClient = useQueryClient();
  const [related, setRelated] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: keys.memberLedger(memberId),
    // 200, not the default 20. This tab is the member's account — somebody
    // asking "what have I paid" means all of it, and a list that silently
    // stops at twenty is one they will dispute.
    queryFn: () => api.members.ledger(memberId, { receipts: 200 }),
    enabled: open && Boolean(memberId),
  });

  const member = data?.member;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: keys.memberLedger(memberId) });
    queryClient.invalidateQueries({ queryKey: ['members'] });
    queryClient.invalidateQueries({ queryKey: keys.stats });
  }

  const setStatus = useMutation({
    mutationFn: (status) => api.members.setStatus(memberId, { status }),
    onSuccess: () => {
      message.success(t('स्थिति बदल गई'));
      refresh();
    },
    onError: (err) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => api.members.remove(memberId),
    onSuccess: () => {
      message.success(t('सदस्य हटा दिया गया'));
      refresh();
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  const isBlocked = member?.status === MEMBER_STATUS.BLOCKED;

  function confirmDelete() {
    modal.confirm({
      title: t('सदस्य हटाएँ?'),
      okText: t('हटाएँ'),
      okButtonProps: { danger: true },
      cancelText: t('रद्द'),
      content: (
        <>
          <p>
            <strong>{member?.displayName}</strong> ({t('रजि.')} {member?.registrationNumber})
            {t('को हटाया जाए?')}
          </p>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('रिकॉर्ड मिटता नहीं — सिर्फ़ सूची से हट जाता है, ताकि पुरानी रसीदें किसी ऐसे सदस्य की ओर इशारा न करें जो मौजूद ही नहीं। जिस सदस्य का कोई भुगतान हो चुका है, उसे हटाया नहीं जा सकता।')}
          </Text>
        </>
      ),
      onOk: () => remove.mutateAsync().catch(() => {}),
    });
  }

  /* ── header ──────────────────────────────────────────────────────────── */

  const title = member ? (
    <Space size={12}>
      <Avatar size={44} src={member.photoURL || undefined} icon={<UserOutlined />} />
      <div style={{ lineHeight: 1.3 }}>
        <Space size={8} wrap>
          <Text strong style={{ fontSize: 15 }}>{member.displayName || '—'}</Text>
          <Tag color={statusColor(member.status)}>{statusLabel(member.status)}</Tag>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('रजि.')} {member.registrationNumber || '—'} · {member.phone || '—'}
          </Text>
        </div>
      </div>
    </Space>
  ) : (
    t('सदस्य')
  );

  const headerActions = member && (
    <Space>
      {/* Every printable sheet this member has, behind one button. Each opens
          in a tab rather than downloading, because the next thing that happens
          is a print dialog — not a trip to the Downloads folder. Four separate
          buttons in the header left no room for the destructive ones on a
          laptop screen, which is exactly where they should not be crowded. */}
      <Dropdown
        menu={{
          items: [
            {
              key: 'certificate',
              icon: <SafetyCertificateOutlined />,
              label: t('सदस्यता प्रमाण पत्र'),
              onClick: () =>
                window.open(api.members.documentUrl(memberId, 'certificate'), '_blank'),
            },
            {
              key: 'regform',
              icon: <FileTextOutlined />,
              label: t('सदस्यता फॉर्म'),
              onClick: () =>
                window.open(api.members.documentUrl(memberId, 'regform'), '_blank'),
            },
            { type: 'divider' },
            {
              key: 'pending',
              icon: <PrinterOutlined />,
              label: t('बकाया विवरण'),
              onClick: () =>
                window.open(api.members.statementUrl(memberId, 'pending'), '_blank'),
            },
            {
              key: 'paid',
              icon: <PrinterOutlined />,
              label: t('जमा विवरण'),
              onClick: () =>
                window.open(api.members.statementUrl(memberId, 'paid'), '_blank'),
            },
          ],
        }}
      >
        <Button icon={<PrinterOutlined />}>
          {t('छापें')} <DownOutlined />
        </Button>
      </Dropdown>

      <Tooltip title={t('सदस्य संपादित करें')}>
        <Button
          icon={<EditOutlined />}
          onClick={() => onEdit?.(member)}
          disabled={member.delete_flag}
        >
          {t('संपादित')}
        </Button>
      </Tooltip>

      <Button
        icon={isBlocked ? <CheckOutlined /> : <StopOutlined />}
        danger={!isBlocked}
        loading={setStatus.isPending}
        onClick={() =>
          setStatus.mutate(isBlocked ? MEMBER_STATUS.ACCEPTED : MEMBER_STATUS.BLOCKED)
        }
      >
        {isBlocked ? t('अनब्लॉक') : t('ब्लॉक')}
      </Button>

      <Tooltip
        title={
          (member.paidCount ?? 0) > 0
            ? t('भुगतान हो चुका है — हटाया नहीं जा सकता')
            : t('सदस्य हटाएँ')
        }
      >
        <Button
          danger
          type="primary"
          icon={<DeleteOutlined />}
          loading={remove.isPending}
          disabled={(member.paidCount ?? 0) > 0 || member.delete_flag}
          onClick={confirmDelete}
        />
      </Tooltip>
    </Space>
  );

  /* ── tabs ────────────────────────────────────────────────────────────── */

  const tabs = member && [
    {
      key: 'basic',
      label: <span><UserOutlined /> {t('मूल जानकारी')}</span>,
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <Card size="small" styles={{ body: { textAlign: 'center' } }}>
              {member.photoURL ? (
                <Image
                  src={member.photoURL}
                  alt={member.displayName}
                  width="100%"
                  style={{ maxWidth: 160, borderRadius: 10, objectFit: 'cover' }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('फ़ोटो नहीं')} />
              )}
              {member.extraImageURL && (
                <div style={{ marginTop: 12 }}>
                  <Image
                    src={member.extraImageURL}
                    alt={t('संरक्षक')}
                    width="100%"
                    style={{ maxWidth: 120, borderRadius: 10, objectFit: 'cover' }}
                  />
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>{t('संरक्षक फ़ोटो')}</Text>
                  </div>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} md={18}>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label={t('नाम')}>{member.displayName || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('पिता का नाम')}>{member.fatherName || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('जाति')}>{member.jati || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('गोत्र')}>{member.gotra || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('लिंग')}>{member.gender || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('मोबाइल')}>{member.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('वैकल्पिक मोबाइल')}>{member.phoneAlt || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('आधार नंबर')}>{member.aadhaarNo || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('रजिस्ट्रेशन नंबर')}>
                {member.registrationNumber || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('योजना')}>{member.programName || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('आयु / आयु समूह')}>
                {member.age != null ? t('{age} वर्ष', { age: member.age }) : '—'}
                {member.ageGroupRange ? ` · ${member.ageGroupRange}` : ''}
              </Descriptions.Item>
              <Descriptions.Item label={t('यूनिट / समूह')}>
                {member.locationGroup || member.memberGroup || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('प्रति क्लोजिंग राशि')}>
                {inr(member.payAmount)}
              </Descriptions.Item>
              {/*
                The fee, and how much of it has actually arrived.
                A single green/orange tag could not describe a member who has
                paid ₹2,100 of ₹11,000 — it called them either paid up or
                owing everything, and both were wrong.
              */}
              <Descriptions.Item label={t('नामांकन शुल्क')}>
                {(() => {
                  const f = joinFeesState(member);
                  if (f.total <= 0) return <Text type="secondary">{t('कोई शुल्क नहीं')}</Text>;
                  return (
                    <Space size={6} wrap>
                      <Text strong>{inr(f.total)}</Text>
                      {f.done ? (
                        <Tag color="green">{t('पूरा जमा')}</Tag>
                      ) : f.partial ? (
                        <>
                          <Tag color="orange">{t('आंशिक')}</Tag>
                          <Text type="secondary">
                            {t('जमा {p} · बाकी', { p: inr(f.paid) })}{' '}
                            <Text strong style={{ color: 'var(--due)' }}>{inr(f.due)}</Text>
                          </Text>
                        </>
                      ) : (
                        <Tag color="red">{t('बाकी')}</Tag>
                      )}
                    </Space>
                  );
                })()}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      ),
    },

    {
      key: 'more',
      label: <span><InfoCircleOutlined /> {t('अतिरिक्त जानकारी')}</span>,
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t('जन्म तिथि')}>
              {member.bobDate || hiDate(member.bobDateMs)}
            </Descriptions.Item>
            <Descriptions.Item label={t('जुड़ने की तिथि')}>
              {member.joinDate || hiDate(member.joinDateMs)}
            </Descriptions.Item>
            <Descriptions.Item label={t('संरक्षक')}>{member.guardian || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('संरक्षक से रिश्ता')}>
              {member.guardianRelation || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('गाँव')}>{member.village || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('ज़िला')}>{member.district || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('राज्य')}>{member.state || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('पिन कोड')}>{member.pinCode || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('पता')} span={2}>
              {member.currentAddress || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('जोड़ा गया')}>
              {member.addedBy === 'agent' ? t('एजेंट') : t('एडमिन')}
              {member.addedByName ? ` · ${member.addedByName}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label={t('एजेंट')}>{member.agentName || '—'}</Descriptions.Item>
            {member.exitDateMs && (
              <Descriptions.Item label={t('बाहर होने की तिथि')} span={2}>
                {hiDate(member.exitDateMs)}
                {member.exitReason ? ` · ${member.exitReason}` : ''}
              </Descriptions.Item>
            )}
          </Descriptions>

          {member.extraDetails?.length > 0 && (
            <Card size="small" title={t('अन्य विवरण')}>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                {member.extraDetails.map((f, i) => (
                  <Descriptions.Item key={`${f.label}-${i}`} label={f.label}>
                    {f.value}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          )}

          <RelatedMembers
            phone={member.phone}
            selfId={member.id}
            value={related}
            onLoad={setRelated}
          />
        </Space>
      ),
    },

    {
      key: 'docs',
      label: <span><FileImageOutlined /> {t('दस्तावेज़')}</span>,
      children: (
        <Row gutter={[16, 16]}>
          {[
            { url: member.photoURL, label: t('सदस्य फ़ोटो') },
            { url: member.extraImageURL, label: t('संरक्षक फ़ोटो') },
            { url: member.documentFrontURL, label: t('दस्तावेज़ (आगे)') },
            { url: member.documentBackURL, label: t('दस्तावेज़ (पीछे)') },
            { url: member.guardianDocumentURL, label: t('संरक्षक दस्तावेज़') },
          ].map((doc) => (
            <Col xs={12} md={8} key={doc.label}>
              <Card
                size="small"
                title={doc.label}
                extra={
                  doc.url && (
                    <a href={doc.url} target="_blank" rel="noreferrer">{t('खोलें')}</a>
                  )
                }
              >
                {doc.url ? (
                  <Image
                    src={doc.url}
                    alt={doc.label}
                    width="100%"
                    style={{ borderRadius: 8, objectFit: 'cover', maxHeight: 220 }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('अपलोड नहीं')} />
                )}
              </Card>
            </Col>
          ))}
        </Row>
      ),
    },

    {
      key: 'ledger',
      label: <span><WalletOutlined /> {t('क्लोजिंग और भुगतान')}</span>,
      children: <LedgerTab data={data} />,
    },
  ];

  return (
    <Drawer
      title={title}
      extra={headerActions}
      open={open}
      onClose={onClose}
      width={980}
      destroyOnHidden
      styles={{ body: { paddingTop: 12 } }}
    >
      {isLoading && <Spin style={{ display: 'block', margin: '48px auto' }} />}
      {error && <Alert type="error" showIcon message={error.message} />}

      {member?.delete_flag && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('यह सदस्य हटाया जा चुका है')}
          description={t('रिकॉर्ड सिर्फ़ पढ़ने के लिए है — इसे संपादित नहीं किया जा सकता।')}
        />
      )}

      {member && <Tabs defaultActiveKey="basic" items={tabs} />}
    </Drawer>
  );
}

/* ── the ledger tab ─────────────────────────────────────────────────────── */

function LedgerTab({ data }) {
  if (!data) return null;
  const t = useT();

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={t('बकाया')}
              value={inr(data.due.amount)}
              valueStyle={{ color: 'var(--due)', fontSize: 20 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{data.due.count} {t('क्लोजिंग')}</Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            {/*
              Everything the member has handed over, not only their closings.
              `settled.amount` is the ledger's figure and counts closings alone,
              so somebody who had paid ₹2,100 towards their joining fee and owed
              no closing was shown "जमा ₹0" — which is not a rounding problem,
              it is the wrong answer to the question the card asks.
            */}
            {(() => {
              const feePaid = joinFeesState(data.member).paid;
              return (
                <>
                  <Statistic
                    title={t('जमा')}
                    value={inr((data.settled.amount ?? 0) + feePaid)}
                    valueStyle={{ color: 'var(--paid)', fontSize: 20 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {data.settled.count} {t('क्लोजिंग')}
                    {data.settled.exemptCount
                      ? ` · ${t('{n} छूट', { n: data.settled.exemptCount })}`
                      : ''}
                    {feePaid > 0 ? ` · ${t('शुल्क {f}', { f: inr(feePaid) })}` : ''}
                  </Text>
                </>
              );
            })()}
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={t('कुल देय')}
              value={inr(data.eligible.amount)}
              valueStyle={{ fontSize: 20 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data.eligible.count} {t('पात्र क्लोजिंग')}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={t('जमा शेष')}
              value={inr(data.member.creditBalance)}
              valueStyle={{ fontSize: 20 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{t('अगली क्लोजिंग में लगेगा')}</Text>
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t('बकाया क्लोजिंग ({n})', { n: data.due.count })}>
        {data.due.items.length === 0 ? (
          <Empty description={t('कोई बकाया नहीं')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="seq"
            pagination={{ pageSize: 10, size: 'small' }}
            dataSource={data.due.items}
            columns={[
              { title: t('क्रम'), dataIndex: 'seq', width: 70 },
              { title: t('नाम'), dataIndex: 'name' },
              { title: t('रजि.'), dataIndex: 'regNo', width: 90 },
              { title: t('तिथि'), dataIndex: 'dateMs', width: 110, render: hiDate },
              {
                title: t('राशि'),
                dataIndex: 'remaining',
                width: 120,
                align: 'right',
                render: (v, row) =>
                  row.partial ? (
                    <span>
                      {inr(v)} <Tag color="orange" style={{ marginInlineStart: 4 }}>{t('आंशिक')}</Tag>
                    </span>
                  ) : (
                    inr(v)
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card size="small" title={t('भुगतान इतिहास ({n} रसीदें)', { n: data.receipts.length })}>
        {data.receipts.length === 0 ? (
          <Empty description={t('कोई रसीद नहीं')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.receipts}
            columns={[
              { title: t('रसीद नं.'), dataIndex: 'receiptNo', width: 160 },
              { title: t('तिथि'), dataIndex: 'paidAtMs', width: 110, render: hiDate },
              { title: t('क्लोजिंग'), dataIndex: 'itemCount', width: 90, align: 'right' },
              {
                title: t('राशि'),
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
                  v === 'cancelled' ? <Tag color="red">{t('रद्द')}</Tag> : <Tag color="green">{t('जमा')}</Tag>,
              },
              {
                title: '',
                width: 50,
                render: (_, row) => (
                  <Tooltip title={t('रसीद छापें')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<PrinterOutlined />}
                      onClick={() => window.open(api.payments.receiptUrl(row.id), '_blank')}
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}

/* ── other members on the same phone number ─────────────────────────────── */

/**
 * Families register several members against one mobile number, and whoever is
 * collecting needs to see all of them at once. Loaded on demand rather than
 * with the drawer — most of the time nobody opens this panel, and it is a
 * separate query across every program in the trust.
 */
function RelatedMembers({ phone, selfId, value, onLoad }) {
  const [enabled, setEnabled] = useState(false);
  const t = useT();

  const { data, isFetching } = useQuery({
    queryKey: keys.memberByPhone(phone),
    queryFn: () => api.members.byPhone(phone),
    enabled: enabled && Boolean(phone),
  });

  const others = (data?.members ?? []).filter((m) => m.id !== selfId);

  if (!phone) return null;

  return (
    <Card
      size="small"
      title={<Space><TeamOutlined /> {t('इसी मोबाइल पर अन्य सदस्य')}</Space>}
      extra={
        !enabled && (
          <Button size="small" onClick={() => setEnabled(true)}>{t('देखें')}</Button>
        )
      }
    >
      {!enabled ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('{phone} पर दर्ज बाकी सदस्य — ज़रूरत हो तो “देखें” दबाएँ।', { phone })}
        </Text>
      ) : isFetching ? (
        <Spin />
      ) : others.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('कोई और सदस्य नहीं')} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={others}
          columns={[
            { title: t('रजि.'), dataIndex: 'registrationNumber', width: 90 },
            { title: t('नाम'), dataIndex: 'displayName' },
            { title: t('योजना'), dataIndex: 'programName' },
            {
              title: t('स्थिति'),
              dataIndex: 'status',
              width: 100,
              render: (v) => <Tag color={statusColor(v)}>{t(statusLabel(v))}</Tag>,
            },
            {
              title: t('बकाया'),
              dataIndex: 'dueAmount',
              width: 110,
              align: 'right',
              render: (v) => inr(v),
            },
          ]}
        />
      )}
    </Card>
  );
}
