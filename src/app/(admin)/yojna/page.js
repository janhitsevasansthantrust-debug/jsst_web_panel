'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Card, Col, Descriptions, Empty, Input, Modal, Row, Space,
  Statistic, Tabs, Tag, Typography, App, Table, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, EyeOutlined, CheckCircleOutlined, SearchOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import ProgramForm from '../../../components/programs/ProgramForm.js';
import { inr } from '../../../components/ui/DataGrid.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Text, Title, Paragraph } = Typography;

const CATEGORY_LABEL = {
  isSuraksha: 'सुरक्षा',
  isMamera: 'मामेरा',
  isVivah: 'विवाह',
  isOther: 'अन्य',
};

/**
 * योजना प्रबंधन — the programs screen.
 *
 * Each card is a self-contained book: its own members, closings, receipts,
 * sequence counters and index documents. Only one program is "active" at a
 * time; that is the one new members join and the one every other screen reads.
 */
export default function YojnaPage() {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: keys.programs, queryFn: () => api.programs.list() });

  const setActive = useMutation({
    mutationFn: (program) =>
      api.programs.update(program.id, { ...program, isSelected: true }),
    onSuccess: () => {
      message.success(t('योजना चालू कर दी गई'));
      queryClient.invalidateQueries({ queryKey: keys.programs });
      queryClient.invalidateQueries({ queryKey: keys.stats });
    },
    onError: (err) => message.error(err.message),
  });

  const deleteProgram = useMutation({
    mutationFn: (id) => api.programs.remove(id),
    onSuccess: () => {
      message.success(t('योजना हटा दी गई'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: keys.programs });
    },
    onError: (err) => message.error(err.message),
  });

  const programs = useMemo(() => {
    const all = query.data?.programs ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.hiname ?? '').toLowerCase().includes(q),
    );
  }, [query.data, search]);

  return (
    <>
      <PageHeader
        title={t('योजना प्रबंधन')}
        subtitle={t('{n} योजनाएँ', { n: programs.length })}
        error={query.error}
        extra={
          <>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('योजना खोजें')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('नई योजना')}
            </Button>
          </>
        }
      />

      {!query.isLoading && programs.length === 0 && (
        <Card>
          <Empty description={t('कोई योजना नहीं — ऊपर से पहली योजना बनाएँ')} />
        </Card>
      )}

      <Row gutter={[16, 16]}>
        {programs.map((program) => {
          const noBands = !program.ageGroups?.length;
          return (
            <Col key={program.id} xs={24} md={12} xl={8}>
              <Badge.Ribbon
                text={program.isSelected ? t('चालू') : t(CATEGORY_LABEL[program.category] ?? 'अन्य')}
                color={program.isSelected ? 'green' : 'default'}
              >
                <Card
                  hoverable
                  style={{ height: '100%' }}
                  actions={[
                    <Button
                      key="view"
                      type="text"
                      icon={<EyeOutlined />}
                      onClick={() => setViewing(program)}
                    >
                      {t('देखें')}
                    </Button>,
                    <Button
                      key="edit"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditing(program);
                        setFormOpen(true);
                      }}
                    >
                      {t('संपादित')}
                    </Button>,
                    <Button
                      key="active"
                      type="text"
                      icon={<CheckCircleOutlined />}
                      disabled={program.isSelected}
                      loading={setActive.isPending && setActive.variables?.id === program.id}
                      onClick={() => setActive.mutate(program)}
                    >
                      {program.isSelected ? t('चालू है') : t('चालू करें')}
                    </Button>,
                    <Button
                      key="delete"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={program.isSelected}
                      onClick={() => setDeleting(program)}
                    >
                      {t('हटाएँ')}
                    </Button>,
                  ]}
                >
                  <Title level={5} style={{ marginTop: 0, marginBottom: 2 }}>
                    {program.hiname || program.name}
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {program.hiname ? program.name : ''}
                  </Text>

                  {program.about && (
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ marginTop: 8, marginBottom: 8, fontSize: 13 }}
                    >
                      {program.about}
                    </Paragraph>
                  )}

                  {noBands && (
                    <Alert
                      type="error"
                      showIcon
                      style={{ margin: '8px 0' }}
                      message={t('कोई आयु समूह नहीं — इसमें सदस्य नहीं जुड़ सकते')}
                    />
                  )}

                  <Row gutter={8} style={{ marginTop: 12 }}>
                    <Col span={8}>
                      <Statistic
                        title={t('सदस्य')}
                        value={program.stats?.members ?? 0}
                        valueStyle={{ fontSize: 18 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title={t('क्लोजिंग')}
                        value={program.stats?.closings ?? 0}
                        valueStyle={{ fontSize: 18 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title={t('वसूली')}
                        value={inr(program.stats?.collected)}
                        valueStyle={{ fontSize: 16, color: 'var(--paid)' }}
                      />
                    </Col>
                  </Row>

                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('आयु समूह')}</Text>
                    <div style={{ marginTop: 4 }}>
                      {program.ageGroups?.length ? (
                        <Space size={4} wrap>
                          {program.ageGroups.map((g) => (
                            <Tag key={g.id ?? `${g.startAge}-${g.endAge}`}>
                              {g.startAge}–{g.endAge}: {inr(g.payAmount)}
                            </Tag>
                          ))}
                        </Space>
                      ) : (
                        <Tag color="red">{t('कोई नहीं')}</Tag>
                      )}
                    </div>
                  </div>
                </Card>
              </Badge.Ribbon>
            </Col>
          );
        })}
      </Row>

      <ProgramForm
        open={formOpen}
        program={editing}
        onClose={() => setFormOpen(false)}
      />

      <ViewModal program={viewing} onClose={() => setViewing(null)} />

      <Modal
        title={t('योजना हटाएँ')}
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onOk={() => deleting && deleteProgram.mutate(deleting.id)}
        okText={t('हाँ, हटाएँ')}
        cancelText={t('रद्द करें')}
        okButtonProps={{ danger: true, loading: deleteProgram.isPending }}
      >
        <p>
          {t('क्या आप वाकई "{name}" को हटाना चाहते हैं?', {
            name: deleting?.hiname || deleting?.name,
          })}
        </p>
        <p style={{ color: 'var(--ant-color-text-secondary)' }}>
          {t('यह क्रिया पूर्ववत नहीं की जा सकती।')}
        </p>
      </Modal>
    </>
  );
}

function ViewModal({ program, onClose }) {
  if (!program) return null;
  const t = useT();

  return (
    <Modal
      title={program.hiname || program.name}
      open
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('बंद करें')}</Button>}
      width={760}
    >
      <Tabs
        items={[
          {
            key: 'basic',
            label: t('बुनियादी'),
            children: (
              <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
                <Descriptions.Item label={t('नाम (English)')}>{program.name}</Descriptions.Item>
                <Descriptions.Item label={t('नाम (हिंदी)')}>{program.hiname || '—'}</Descriptions.Item>
                <Descriptions.Item label={t('श्रेणी')}>
                  {t(CATEGORY_LABEL[program.category] ?? '') || '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('स्थिति')}>
                  {program.isSelected ? <Tag color="green">{t('चालू')}</Tag> : <Tag>{t('बंद')}</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label={t('सदस्य')}>{program.stats?.members ?? 0}</Descriptions.Item>
                <Descriptions.Item label={t('क्लोजिंग')}>{program.stats?.closings ?? 0}</Descriptions.Item>
                <Descriptions.Item label={t('कुल वसूली')}>{inr(program.stats?.collected)}</Descriptions.Item>
                <Descriptions.Item label={t('कुल बकाया')}>{inr(program.stats?.due)}</Descriptions.Item>
                <Descriptions.Item label={t('विवरण')} span={2}>
                  {program.about || '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('प्रमाणपत्र नोट')} span={2}>
                  {program.noteLine || '—'}
                </Descriptions.Item>
              </Descriptions>
            ),
          },
          {
            key: 'age',
            label: t('आयु समूह ({n})', { n: program.ageGroups?.length ?? 0 }),
            children: (
              <Table
                size="small"
                rowKey={(r) => r.id ?? `${r.startAge}-${r.endAge}`}
                pagination={false}
                dataSource={program.ageGroups ?? []}
                locale={{ emptyText: <Empty description={t('कोई आयु समूह नहीं')} /> }}
                columns={[
                  { title: t('शुरुआती आयु'), dataIndex: 'startAge', width: 130 },
                  { title: t('अंतिम आयु'), dataIndex: 'endAge', width: 130 },
                  {
                    title: t('नामांकन शुल्क'),
                    dataIndex: 'joinFee',
                    align: 'right',
                    render: (v) => inr(v),
                  },
                  {
                    title: t('प्रति क्लोजिंग'),
                    dataIndex: 'payAmount',
                    align: 'right',
                    render: (v) => <Text strong>{inr(v)}</Text>,
                  },
                ]}
              />
            ),
          },
          {
            key: 'location',
            label: t('स्थान समूह ({n})', { n: program.locationGroups?.length ?? 0 }),
            children: (
              <Table
                size="small"
                rowKey={(r) => r.id ?? r.groupName}
                pagination={false}
                dataSource={program.locationGroups ?? []}
                locale={{ emptyText: <Empty description={t('कोई स्थान समूह नहीं')} /> }}
                columns={[
                  { title: t('समूह का नाम'), dataIndex: 'groupName' },
                  { title: t('स्थान'), dataIndex: 'location' },
                  {
                    title: t('प्रकार'),
                    dataIndex: 'groupType',
                    width: 110,
                    render: (v) => <Tag>Group {v}</Tag>,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
