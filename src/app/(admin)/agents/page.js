'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Col, Row, Space, Statistic, Tag, Typography, Tooltip, App,
  Popconfirm, Modal, Alert, Segmented, Switch,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, KeyOutlined, SwapOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import DataGrid, { inr, money } from '../../../components/ui/DataGrid.js';
import AgentForm from '../../../components/agents/AgentForm.js';
import AgentHandover from '../../../components/agents/AgentHandover.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Text } = Typography;

/**
 * Agents and their commission.
 *
 * Every figure on this screen is a counter kept on the agent document and
 * updated inside the same transaction as the payment that changed it. So the
 * list is one page of documents, and no total is ever computed by scanning
 * commission entries.
 */
export default function AgentsPage() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [handingOver, setHandingOver] = useState(null);

  /**
   * Which agents the table shows.
   *
   * The list used to ask the server for active agents only, which made
   * switching an agent off look like deleting them: the row left the table, and
   * the only button that could switch them back on was in the table they had
   * just vanished from. Everything is fetched now and the filter is local, so
   * "बंद" is one click away rather than a support call.
   */
  const [show, setShow] = useState('active');

  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...keys.agents, 'all'],
    queryFn: () => api.agents.list({ includeInactive: true }),
  });

  /**
   * Per-agent member counts, from the member search index.
   *
   * Not from a counter on the agent document. A counter has to be maintained
   * on every member create, move, block and delete, and the one time it is
   * missed nobody notices — the number just quietly stops matching the list.
   * This is computed from the same rows the members screen shows, so clicking
   * through to "Mohan's 412 members" gives 412 rows.
   */
  const memberCounts = useQuery({
    queryKey: ['members', 'summary', 'agent'],
    queryFn: () => api.members.summary({ groupBy: 'agent' }),
  });

  const byAgent = useMemo(() => {
    const map = new Map();
    for (const row of memberCounts.data?.groups?.agent ?? []) map.set(row.value, row);
    return map;
  }, [memberCounts.data]);

  const allAgents = query.data?.agents ?? [];
  const summary = query.data?.summary ?? {};

  const offCount = allAgents.filter((a) => a.active === false).length;

  const agents = useMemo(() => {
    if (show === 'all') return allAgents;
    if (show === 'off') return allAgents.filter((a) => a.active === false);
    return allAgents.filter((a) => a.active !== false);
  }, [allAgents, show]);

  const resetPassword = useMutation({
    mutationFn: (agent) =>
      api.agents.resetPassword(agent.id).then((r) => ({ ...r, name: agent.displayName })),
    onSuccess: (res) => setCredentials(res),
    onError: (err) => message.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: (agent) => api.agents.update(agent.id, { active: !agent.active }),
    onSuccess: (res) => {
      message.success(res.agent.active ? t('एजेंट फिर चालू') : t('एजेंट का लॉगिन बंद कर दिया गया'));
      queryClient.invalidateQueries({ queryKey: keys.agents });
    },
    onError: (err) => message.error(err.message),
  });

  const columns = useMemo(
    () => [
      { headerName: t('नाम'), field: 'displayName', flex: 1, minWidth: 160, pinned: 'left' },
      { headerName: t('ईमेल (लॉगिन)'), field: 'email', width: 210 },
      { headerName: t('मोबाइल'), field: 'phone', width: 130 },
      { headerName: t('शहर'), field: 'city', width: 130 },
      {
        headerName: t('सदस्य'),
        colId: 'members',
        width: 130,
        cellRenderer: (p) => {
          const row = byAgent.get(p.data?.id);
          if (!row) return <Text type="secondary">—</Text>;
          return (
            <div style={{ lineHeight: 1.3, textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>{row.count.toLocaleString('en-IN')}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {row.active} {t('सक्रिय')} · {row.closed} {t('क्लोज़')}
              </Text>
            </div>
          );
        },
      },
      {
        headerName: t('बकायादार'),
        colId: 'withDue',
        width: 130,
        cellRenderer: (p) => {
          const row = byAgent.get(p.data?.id);
          if (!row) return <Text type="secondary">—</Text>;
          return (
            <div style={{ lineHeight: 1.3, textAlign: 'right' }}>
              <div style={{ color: row.withDue ? 'var(--due)' : '#999', fontWeight: row.withDue ? 600 : 400 }}>
                {row.withDue}
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>{money({ value: row.dueAmount })}</Text>
            </div>
          );
        },
      },
      {
        headerName: t('वसूली'),
        field: 'collectedAmount',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
      },
      {
        headerName: t('कमीशन कमाया'),
        field: 'earnedTotal',
        width: 140,
        type: 'rightAligned',
        valueFormatter: money,
      },
      {
        headerName: t('देय बाकी'),
        field: 'dueTotal',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
        cellStyle: (p) => (p.value > 0 ? { color: 'var(--warn)', fontWeight: 600 } : null),
      },
      {
        headerName: t('कमीशन नियम'),
        field: 'commissionOverride',
        width: 140,
        cellRenderer: (p) =>
          p.value ? <Tag color="purple">{t('अपना नियम')}</Tag> : <Tag>{t('योजना का')}</Tag>,
      },
      {
        headerName: t('चालू / बंद'),
        colId: 'status',
        width: 176,
        /** Sortable on the flag itself, so "show me who is off" is one click. */
        valueGetter: (p) => (p.data?.active === false ? 0 : 1),
        cellRenderer: (p) => {
          const agent = p.data;
          if (!agent) return null;

          const on = agent.active !== false;
          const busy = toggleActive.isPending && toggleActive.variables?.id === agent.id;

          return (
            <Space size={6} wrap>
              {/* Switching OFF asks first — it signs the agent out of every
                  device they are holding. Switching back on is harmless, so it
                  does not ask. */}
              {on ? (
                <Popconfirm
                  title={t('लॉगिन बंद करें?')}
                  description={t('एजेंट तुरंत हर डिवाइस से लॉग आउट हो जाएगा। सदस्य और कमीशन का हिसाब वैसा ही रहेगा।')}
                  okText={t('बंद करें')}
                  cancelText={t('रद्द')}
                  okButtonProps={{ danger: true }}
                  disabled={agent.isSelf}
                  onConfirm={() => toggleActive.mutate(agent)}
                >
                  <Switch size="small" checked loading={busy} disabled={agent.isSelf} />
                </Popconfirm>
              ) : (
                <Switch
                  size="small"
                  checked={false}
                  loading={busy}
                  onChange={() => toggleActive.mutate(agent)}
                />
              )}

              <Text type={on ? undefined : 'secondary'} style={{ fontSize: 12 }}>
                {on ? t('चालू') : t('बंद')}
              </Text>

              {/* Your own login cannot be switched off from here — it would end
                  your own session mid-click. The server refuses it too. */}
              {agent.isSelf && <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t('आपका खाता')}</Tag>}

              {/* A position that has changed hands is worth seeing at a
                  glance — it explains why a familiar round has a new name. */}
              {agent.handovers?.length > 0 && (
                <Tooltip
                  title={`${t('पिछली बार')} ${agent.handovers[0].fromName} ${t('से')} ${
                    agent.handoverAtMs
                      ? new Date(agent.handoverAtMs).toLocaleDateString('hi-IN')
                      : ''
                  } ${t('को')}`}
                >
                  <Tag color="purple" style={{ marginInlineEnd: 0 }}>{t('बदला')}</Tag>
                </Tooltip>
              )}
            </Space>
          );
        },
      },
      {
        headerName: t('कार्रवाई'),
        colId: 'actions',
        pinned: 'right',
        width: 112,
        sortable: false,
        filter: false,
        cellRenderer: (p) => {
          const agent = p.data;
          if (!agent) return null;
          return (
            <Space size={4}>
              <Tooltip title={t('विवरण संपादित करें')}>
                <Button
                  size="small"
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(agent);
                    setOpen(true);
                  }}
                />
              </Tooltip>

              <Tooltip
                title={
                  agent.isSelf
                    ? t('यह आपका ही लॉगिन है — अपना पासवर्ड सेटिंग से बदलें')
                    : t('नया पासवर्ड बनाएँ')
                }
              >
                <Popconfirm
                  title={t('नया पासवर्ड बनाएँ?')}
                  description={t('पुराना पासवर्ड तुरंत बंद हो जाएगा और एजेंट हर डिवाइस से लॉग आउट हो जाएगा।')}
                  okText={t('बनाएँ')}
                  cancelText={t('रद्द')}
                  disabled={agent.isSelf}
                  onConfirm={() => resetPassword.mutate(agent)}
                >
                  <Button size="small" icon={<KeyOutlined />} disabled={agent.isSelf} />
                </Popconfirm>
              </Tooltip>

              <Tooltip title={t('किसी और व्यक्ति को यह पद दें')}>
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  disabled={agent.isSelf}
                  onClick={() => setHandingOver(agent)}
                />
              </Tooltip>
            </Space>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byAgent, toggleActive.isPending, toggleActive.variables],
  );

  return (
    <>
      <PageHeader
        title={t('एजेंट')}
        subtitle={
          offCount
            ? `${allAgents.length - offCount} ${t('चालू')} · ${offCount} ${t('बंद')}`
            : `${allAgents.length} ${t('एजेंट')}`
        }
        error={query.error}
        extra={
          <>
            <Segmented
              size="small"
              value={show}
              onChange={setShow}
              options={[
                { label: t('चालू'), value: 'active' },
                { label: offCount ? `${t('बंद')} (${offCount})` : t('बंद'), value: 'off' },
                { label: t('सब'), value: 'all' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {t('नया एजेंट')}
            </Button>
          </>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={t('कुल सदस्य')} value={summary.memberCount ?? 0} valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={t('कुल वसूली')} value={inr(summary.collectedAmount)} valueStyle={{ fontSize: 20, color: 'var(--paid)' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={t('कमीशन कमाया')} value={inr(summary.earnedTotal)} valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={t('कमीशन देय')} value={inr(summary.dueTotal)} valueStyle={{ fontSize: 20, color: 'var(--warn)' }} />
          </Card>
        </Col>
      </Row>

      {/*
        No `onRowClick`.
        Clicking a row used to open the edit drawer, and that was worse than
        merely unwanted: AG Grid attaches its row listener directly to the row
        element, BELOW React's root, so the `stopPropagation()` on the action
        cell never reached it. Every button in the row — including the key — was
        also opening the editor behind whatever it had just opened. The pencil
        is the one way in.
      */}
      <DataGrid
        rows={agents}
        columns={columns}
        loading={query.isLoading}
        getRowId={(p) => p.data.id}
        getRowStyle={(p) => (p.data?.active === false ? { opacity: 0.55 } : undefined)}
        emptyText={
          show === 'off'
            ? t('कोई बंद एजेंट नहीं')
            : t('कोई एजेंट नहीं — ऊपर से जोड़ें')
        }
      />

      <AgentForm open={open} agent={editing} onClose={() => setOpen(false)} />

      <AgentHandover
        agent={handingOver}
        open={Boolean(handingOver)}
        onClose={() => setHandingOver(null)}
      />

      {/* The password exists in readable form exactly once — here. */}
      <Modal
        title={t('नया पासवर्ड')}
        open={Boolean(credentials)}
        onCancel={() => setCredentials(null)}
        maskClosable={false}
        footer={[
          <Button key="ok" type="primary" onClick={() => setCredentials(null)}>
            {t('नोट कर लिया')}
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={t('यह पासवर्ड दोबारा नहीं दिखेगा')}
          description={t('कहीं सहेजा नहीं जाता। अभी नोट कर लें या एजेंट को भेज दें — भूलने पर नया बनाना ही रास्ता है।')}
        />
        <div style={{ lineHeight: 1.8 }}>
          <div><Text type="secondary">{t('एजेंट')}</Text> — <Text strong>{credentials?.name}</Text></div>
          <div><Text type="secondary">{t('ईमेल')}</Text> — <Text copyable strong>{credentials?.email}</Text></div>
          <div>
            <Text type="secondary">{t('पासवर्ड')}</Text> —{' '}
            <Text copyable strong style={{ fontSize: 17, fontFamily: 'ui-monospace, monospace' }}>
              {credentials?.password}
            </Text>
          </div>
        </div>
      </Modal>
    </>
  );
}
