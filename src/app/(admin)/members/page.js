'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import {
  Button, Select, Space, Tag, Card, Row, Col, Tooltip, Dropdown, App,
  Pagination, Typography, Badge, Segmented, Avatar,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EyeOutlined, EditOutlined,
  DeleteOutlined, StopOutlined, CheckOutlined, WalletOutlined, MoreOutlined,
  FilterOutlined, UserOutlined, ArrowDownOutlined, RiseOutlined,
  ExclamationCircleOutlined, TeamOutlined, DownloadOutlined, FilePdfOutlined,
  FileExcelOutlined, SafetyCertificateOutlined, FileTextOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import DataGrid, { inr, money } from '../../../components/ui/DataGrid.js';
import StatCard from '../../../components/ui/StatCard.js';
import MemberForm from '../../../components/members/MemberForm.js';
import MemberDetailsDrawer from '../../../components/members/MemberDetailsDrawer.js';
import MemberSearchBox from '../../../components/members/MemberSearchBox.js';
import MemberFilterDrawer from '../../../components/members/MemberFilterDrawer.js';
import { statusLabel, statusColor, hiDate } from '../../../lib/memberStatus.js';
import {
  EMPTY_FILTERS, GENDER_LABEL, cleanFilters, countActiveFilters, describeFilters,
} from '../../../lib/memberFilters.js';
import { api, apiUrl } from '../../../lib/api.js';
import { useActiveProgramId } from '../../../lib/activeProgram.js';
import { MEMBER_STATUS } from '../../../config/constants.js';
import { useT } from '../../../i18n/index.js';

const { Text } = Typography;

/** Labels here are message keys — translated where they are rendered. */
const SORTS = [
  { value: 'registrationNumber:asc', label: 'रजि. नंबर ↑' },
  { value: 'registrationNumber:desc', label: 'रजि. नंबर ↓' },
  { value: 'displayName:asc', label: 'नाम (अ–ज्ञ)' },
  { value: 'joinDateMs:desc', label: 'नए सदस्य पहले' },
  { value: 'joinDateMs:asc', label: 'पुराने सदस्य पहले' },
  { value: 'dueAmount:desc', label: 'सबसे ज़्यादा बकाया' },
  { value: 'paidAmount:desc', label: 'सबसे ज़्यादा जमा' },
  { value: 'age:asc', label: 'उम्र ↑' },
  { value: 'lastPaymentAt:desc', label: 'हाल में भुगतान' },
];

/** The four choices people actually make, one click away from the toolbar. */
const QUICK = [
  { value: 'all', label: 'सभी' },
  { value: 'accepted', label: 'स्वीकृत' },
  { value: 'due', label: 'बकायादार' },
  /**
   * Who still owes joining fees — part of it or all of it.
   *
   * Not the same question as "बकायादार", which is about closings. A member can
   * be fully paid up on every closing and still owe ₹8,900 of their enrolment
   * fee, and until this tab existed there was no screen that would list them.
   */
  { value: 'feeDue', label: 'शुल्क बाकी' },
  { value: 'blocked', label: 'ब्लॉक' },
];

/**
 * The members list.
 *
 * Every filter here is applied to the trust's search index, which the server
 * holds in memory — so status AND gender AND age band AND village AND a date
 * range together cost what the unfiltered list costs: about ten Firestore
 * reads for 5,000 members, and none at all while the index is warm.
 *
 * The layout follows from that. Because the whole filtered set is in hand, the
 * summary row can total the *set* rather than the visible page, the filter
 * drawer can show a live result count, and every dropdown can show how many
 * members each option would match. None of that is affordable when a list is
 * fifty rows fetched blind.
 */
export default function MembersPage() {
  const activeProgramId = useActiveProgramId();
  const t = useT();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('registrationNumber:asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailsId, setDetailsId] = useState(null);

  const { modal, message } = App.useApp();
  const queryClient = useQueryClient();

  // Typing must not fire a request per keystroke, but it must still feel
  // immediate — 250ms is under the threshold where a list starts to feel slow.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // Any change to the question starts again at page 1 — staying on page 7 of a
  // result set that just shrank to two pages shows an empty grid.
  useEffect(() => setPage(1), [filters, sort, pageSize, activeProgramId]);

  const [sortBy, sortDir] = sort.split(':');

  const params = useMemo(
    () => ({
      programId: activeProgramId ?? undefined,
      ...cleanFilters(filters),
      sortBy,
      sortDir,
      page,
      limit: pageSize,
    }),
    [activeProgramId, filters, sortBy, sortDir, page, pageSize],
  );

  const query = useQuery({
    queryKey: ['members', params],
    queryFn: ({ signal }) => api.members.list(params, signal),
    // Without this the grid blanks between fetches, which reads as "no
    // results" for a moment on every keystroke.
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.members ?? [];
  const totals = query.data?.totals ?? {};
  const facets = query.data?.facets ?? {};

  const activeCount = countActiveFilters(filters);
  const chips = describeFilters(filters, facets);

  /** Which quick tab is lit — derived, never stored, so it cannot disagree. */
  const quick =
    filters.hasFeeDue === true ? 'feeDue'
      : filters.hasDue === true ? 'due'
      : filters.status?.length === 1 && filters.status[0] === MEMBER_STATUS.ACCEPTED ? 'accepted'
      : filters.status?.length === 1 && filters.status[0] === MEMBER_STATUS.BLOCKED ? 'blocked'
      : activeCount === 0 ? 'all'
      : undefined;

  function applyQuick(value) {
    if (value === 'all') return setFilters({ ...EMPTY_FILTERS, q: filters.q });
    if (value === 'due') return setFilters({ ...EMPTY_FILTERS, q: filters.q, hasDue: true });
    if (value === 'feeDue') {
      return setFilters({ ...EMPTY_FILTERS, q: filters.q, hasFeeDue: true });
    }
    setFilters({ ...EMPTY_FILTERS, q: filters.q, status: [value] });
  }

  /* ── actions ───────────────────────────────────────────────────────────── */

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['members'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }

  const changeStatus = useMutation({
    mutationFn: ({ id, status }) => api.members.setStatus(id, { status }),
    onSuccess: () => {
      message.success(t('स्थिति बदल गई'));
      refresh();
    },
    onError: (err) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api.members.remove(id),
    onSuccess: () => {
      message.success(t('सदस्य हटा दिया गया'));
      refresh();
    },
    onError: (err) => message.error(err.message),
  });

  function openEdit(member) {
    setEditing(member);
    setFormOpen(true);
  }

  const [exporting, setExporting] = useState(null);

  /**
   * Download the CURRENT filtered list — every row of it, not the page shown.
   *
   * A plain <a href> would not carry the filters and would open the file in a
   * tab as often as save it, so this fetches with the same params, takes the
   * filename the server chose, and hands the browser a blob.
   */
  async function download(format) {
    setExporting(format);
    try {
      const { page: _p, limit: _l, ...rest } = params;
      // Through `apiUrl`, so the export carries the योजना chosen in the header
      // rather than whatever was stamped into the session cookie at sign-up.
      const response = await fetch(apiUrl(`/members/export${toQuery({ ...rest, format })}`), {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        // The server answers failures as JSON even on this endpoint, so read
        // the real message rather than reporting a bare status code — "कोई
        // योजना नहीं चुनी" is an answer, "डाउनलोड नहीं हुआ (400)" is not.
        const detail = await response.json().catch(() => null);
        throw new Error(
          detail?.error ?? t('डाउनलोड नहीं हुआ ({code})', { code: response.status }),
        );
      }

      const rowCount = Number(response.headers.get('X-Total-Rows') ?? 0);
      if (rowCount === 0) {
        message.warning(t('इन फ़िल्टरों पर कोई सदस्य नहीं — फ़ाइल खाली रहेगी'));
      }

      const blob = await response.blob();
      const name =
        response.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1]
        ?? `members.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (rowCount > 0) {
        message.success(t('{n} सदस्य डाउनलोड हो गए', { n: rowCount.toLocaleString('en-IN') }));
      }
    } catch (error) {
      message.error(error.message);
    } finally {
      setExporting(null);
    }
  }

  function confirmDelete(member) {
    modal.confirm({
      title: t('सदस्य हटाएँ?'),
      okText: t('हटाएँ'),
      okButtonProps: { danger: true },
      cancelText: t('रद्द'),
      content: t('{name} (रजि. {reg}) को सूची से हटाया जाए?', { name: member.displayName, reg: member.registrationNumber }),
      onOk: () => remove.mutateAsync(member.id).catch(() => {}),
    });
  }

  function RowActions({ member }) {
    if (!member) return null;
    const isBlocked = member.status === MEMBER_STATUS.BLOCKED;
    const hasPaid = (member.paidCount ?? 0) > 0;

    const items = [
      {
        key: 'ledger',
        icon: <WalletOutlined />,
        label: t('भुगतान विवरण'),
        onClick: () => setDetailsId(member.id),
      },
      {
        // The two sheets the counter actually prints: the card the member
        // keeps and the form that goes into the file. Straight from the row,
        // because printing a certificate for someone standing at the desk
        // should not mean opening their whole record first.
        key: 'certificate',
        icon: <SafetyCertificateOutlined />,
        label: t('प्रमाण पत्र छापें'),
        onClick: () =>
          window.open(api.members.documentUrl(member.id, 'certificate'), '_blank'),
      },
      {
        key: 'regform',
        icon: <FileTextOutlined />,
        label: t('सदस्यता फॉर्म छापें'),
        onClick: () =>
          window.open(api.members.documentUrl(member.id, 'regform'), '_blank'),
      },
      { type: 'divider' },
      {
        key: 'block',
        icon: isBlocked ? <CheckOutlined /> : <StopOutlined />,
        label: t(isBlocked ? 'अनब्लॉक करें' : 'ब्लॉक करें'),
        onClick: () =>
          changeStatus.mutate({
            id: member.id,
            status: isBlocked ? MEMBER_STATUS.ACCEPTED : MEMBER_STATUS.BLOCKED,
          }),
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t(hasPaid ? 'हटाया नहीं जा सकता (भुगतान है)' : 'सदस्य हटाएँ'),
        danger: true,
        disabled: hasPaid,
        onClick: () => confirmDelete(member),
      },
    ];

    return (
      <Space size={4} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={t('पूरा विवरण')}>
          <Button size="small" type="primary" icon={<EyeOutlined />}
            onClick={() => setDetailsId(member.id)} />
        </Tooltip>
        <Tooltip title={t('संपादित करें')}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(member)} />
        </Tooltip>
        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
          <Button size="small" icon={<MoreOutlined />} />
        </Dropdown>
      </Space>
    );
  }

  /* ── columns ───────────────────────────────────────────────────────────── */

  const columns = useMemo(
    () => [
      {
        headerName: t('सदस्य'),
        colId: 'member',
        pinned: 'left',
        minWidth: 250,
        flex: 1,
        // Photo, name and father's name in one cell. Three separate columns
        // said the same thing in three times the width, and a face is how
        // someone at a counter actually confirms they have the right person.
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size={34} src={m.photoURL || undefined} icon={<UserOutlined />} />
              <div style={{ lineHeight: 1.3, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{m.displayName || '—'}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  #{m.registrationNumber} · {m.fatherName || '—'}
                </Text>
              </div>
            </div>
          );
        },
      },
      {
        headerName: t('संपर्क'),
        colId: 'contact',
        width: 165,
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          return (
            <div style={{ lineHeight: 1.3 }}>
              <div>{m.phone || '—'}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {[m.village, m.district].filter(Boolean).join(', ') || '—'}
              </Text>
            </div>
          );
        },
      },
      {
        headerName: t('उम्र / समूह'),
        colId: 'age',
        width: 120,
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          return (
            <div style={{ lineHeight: 1.3 }}>
              <div>{m.age != null ? t('{age} वर्ष', { age: m.age }) : '—'}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {m.ageGroupRange || '—'} · {GENDER_LABEL[String(m.gender).toLowerCase()] ?? '—'}
              </Text>
            </div>
          );
        },
      },
      {
        headerName: t('स्थिति'),
        field: 'status',
        width: 105,
        cellRenderer: (p) => <Tag color={statusColor(p.value)}>{t(statusLabel(p.value))}</Tag>,
      },
      {
        headerName: t('एजेंट / योजना'),
        colId: 'agent',
        width: 160,
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          return (
            <div style={{ lineHeight: 1.3 }}>
              <div>{m.agentName || t('सीधे जोड़ा गया')}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>{m.programName || '—'}</Text>
            </div>
          );
        },
      },
      {
        headerName: t('जुड़ा'),
        field: 'joinDateMs',
        width: 105,
        valueFormatter: (p) => hiDate(p.value),
      },
      {
        /**
         * The joining fee, shown as what is left rather than a tick.
         *
         * A member can owe nothing on closings and still owe most of their
         * enrolment fee; this is the column that makes that visible in the
         * list instead of only inside their record.
         */
        headerName: t('शुल्क बाकी'),
        field: 'joinFeesDue',
        width: 125,
        type: 'rightAligned',
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          const left = m.joinFeesDue ?? 0;
          if (left <= 0) {
            return (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {(m.joinFees ?? 0) > 0 ? t('जमा') : '—'}
              </Text>
            );
          }
          return (
            <div style={{ lineHeight: 1.3, textAlign: 'right' }}>
              <div style={{ color: 'var(--warn)', fontWeight: 600 }}>{inr(left)}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {(m.joinFeesPaid ?? 0) > 0
                  ? t('{p} जमा / {t}', { p: inr(m.joinFeesPaid), t: inr(m.joinFees) })
                  : t('कुल {t}', { t: inr(m.joinFees) })}
              </Text>
            </div>
          );
        },
      },
      {
        headerName: t('बकाया'),
        field: 'dueAmount',
        width: 125,
        type: 'rightAligned',
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          const due = m.dueAmount ?? 0;
          return (
            <div style={{ lineHeight: 1.3, textAlign: 'right' }}>
              <div style={{ color: due > 0 ? 'var(--due)' : '#999', fontWeight: due > 0 ? 600 : 400 }}>
                {due > 0 ? inr(due) : '—'}
              </div>
              {due > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {m.dueCount} {t('क्लोजिंग')}
                </Text>
              )}
            </div>
          );
        },
      },
      {
        /**
         * What this member has handed over — all of it.
         *
         * `paidAmount` alone is the closings total, so a member who paid only
         * towards their joining fee showed ₹0 in a column headed "जमा". The
         * fee is named underneath rather than folded in silently, because the
         * two are reconciled against different things.
         */
        headerName: t('जमा'),
        field: 'paidAmount',
        width: 130,
        type: 'rightAligned',
        valueGetter: (p) =>
          (p.data?.paidAmount ?? 0) + (p.data?.joinFeesPaid ?? 0),
        cellRenderer: (p) => {
          const m = p.data;
          if (!m) return null;
          const closings = m.paidAmount ?? 0;
          const fee = m.joinFeesPaid ?? 0;
          if (closings + fee <= 0) return <Text type="secondary">—</Text>;
          return (
            <div style={{ lineHeight: 1.3, textAlign: 'right' }}>
              <div style={{ color: 'var(--paid)', fontWeight: 600 }}>
                {inr(closings + fee)}
              </div>
              {fee > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {closings > 0
                    ? t('क्लोजिंग {c} · शुल्क {f}', { c: inr(closings), f: inr(fee) })
                    : t('शुल्क {f}', { f: inr(fee) })}
                </Text>
              )}
            </div>
          );
        },
      },
      {
        headerName: '',
        colId: 'actions',
        pinned: 'right',
        width: 128,
        sortable: false,
        filter: false,
        cellRenderer: (p) => <RowActions member={p.data} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <>
      <PageHeader
        title={t('सदस्य')}
        subtitle={
          query.isLoading
            ? t('लोड हो रहा है…')
            : `${num(totals.count)} ${t('सदस्य')}` +
              (query.data?.indexed && totals.count !== query.data.indexed
                ? ` · ${t('कुल {n} में से', { n: num(query.data.indexed) })}`
                : '')
        }
        error={query.error}
        extra={
          <>
            <Tooltip title={t('ताज़ा करें')}>
              <Button icon={<ReloadOutlined />} loading={query.isFetching}
                onClick={() => query.refetch()} />
            </Tooltip>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('नया सदस्य')}
            </Button>
          </>
        }
      />

      {/* ── summary — totals for the WHOLE filtered set ─────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} lg={6}>
          <StatCard icon={<TeamOutlined />} color="var(--brand)" label={t('सदस्य')}
            value={num(totals.count)} hint={t('मौजूदा फ़िल्टर पर')} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard icon={<ArrowDownOutlined />} color="var(--due)" label={t('कुल बकाया')}
            value={inr(totals.dueAmount)} hint={t('{n} सदस्यों पर', { n: num(totals.withDue) })} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard icon={<RiseOutlined />} color="var(--paid)" label={t('कुल जमा')}
            value={inr((totals.paidAmount ?? 0) + (totals.feePaidAmount ?? 0))}
            hint={
              totals.feePaidAmount
                ? t('क्लोजिंग {c} · शुल्क {f}', {
                    c: inr(totals.paidAmount),
                    f: inr(totals.feePaidAmount),
                  })
                : t('अब तक')
            } />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard icon={<ExclamationCircleOutlined />} color="var(--warn)" label={t('नामांकन शुल्क बाकी')}
            value={inr(totals.feeDueAmount)}
            hint={
              totals.feePartial
                ? t('{n} सदस्यों पर · {p} आंशिक', {
                    n: num(totals.feePending),
                    p: num(totals.feePartial),
                  })
                : t('{n} सदस्यों पर', { n: num(totals.feePending) })
            } />
        </Col>
      </Row>

      {/* ── toolbar ──────────────────────────────────────────────────────── */}
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Space wrap size={8} style={{ width: '100%' }}>
          {/* Local as you type, and picking a result opens that member —
              which is what someone searching by name is usually after. The
              text still narrows the grid, for the times they are not. */}
          <MemberSearchBox
            value={search}
            onTermChange={setSearch}
            onPick={(member) => {
              setSearch('');
              setDetailsId(member.id);
            }}
            allPrograms={filters.allPrograms}
          />

          <Segmented
            options={QUICK.map((q) => ({ ...q, label: t(q.label) }))}
            value={quick}
            onChange={applyQuick}
          />

          <Badge count={activeCount} size="small">
            <Button
              size="large"
              icon={<FilterOutlined />}
              type={activeCount ? 'primary' : 'default'}
              onClick={() => setFiltersOpen(true)}
            >
              {t('फ़िल्टर')}
            </Button>
          </Badge>

          <Select
            value={sort}
            onChange={setSort}
            size="large"
            style={{ width: 190 }}
            options={SORTS.map((o) => ({ ...o, label: t(o.label) }))}
          />

          {/*
            Pinned to the far right of the toolbar.

            It used to sit at the end of the same run as the search box, the
            quick tabs, the filter button and the sort — and adding one more
            quick tab was enough to push it past the edge on a laptop, where it
            simply looked like there was no export at all. An action people go
            looking for needs a fixed place, not whatever space is left over.
          */}
          <div style={{ marginInlineStart: 'auto' }}>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'csv',
                    icon: <FileExcelOutlined />,
                    label: t('CSV (Excel में खुलेगी)'),
                    onClick: () => download('csv'),
                  },
                  {
                    key: 'pdf',
                    icon: <FilePdfOutlined />,
                    label: t('PDF (छपाई के लिए)'),
                    onClick: () => download('pdf'),
                  },
                ],
              }}
            >
              <Button
                size="large"
                type="primary"
                ghost
                icon={<DownloadOutlined />}
                loading={Boolean(exporting)}
              >
                {t('डाउनलोड')}
              </Button>
            </Dropdown>
          </div>
        </Space>

        {/* Applied filters, each removable on its own. Without this the only
            way to undo one choice is to clear everything and start again. */}
        {chips.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {chips.map((chip) => (
              <Tag
                key={chip.key}
                closable
                onClose={(e) => {
                  e.preventDefault();
                  setFilters((f) => ({ ...f, ...chip.clear }));
                }}
                style={{ marginInlineEnd: 0 }}
              >
                {chip.label}
              </Tag>
            ))}
            <Button
              type="link"
              size="small"
              onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}
            >
              {t('सब हटाएँ')}
            </Button>
          </div>
        )}
      </Card>

      {/* ── the grid ─────────────────────────────────────────────────────── */}
      <DataGrid
        rows={rows}
        columns={columns}
        loading={query.isLoading}
        rowHeight={52}
        getRowId={(p) => p.data.id}
        onRowClick={(row) => setDetailsId(row.id)}
        emptyText={
          activeCount > 0 || search
            ? t('इन फ़िल्टरों पर कोई सदस्य नहीं मिला — कुछ फ़िल्टर हटाकर देखें')
            : t('अभी कोई सदस्य नहीं — ऊपर “नया सदस्य” से शुरू करें')
        }
      />

      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {query.data?.indexed
            ? t('{n} सदस्यों की अनुक्रमणिका से — फ़िल्टर लगाने का कोई अतिरिक्त खर्च नहीं', { n: num(query.data.indexed) })
            : ''}
        </Text>
        <Pagination
          showQuickJumper
          responsive
          current={query.data?.page ?? 1}
          total={totals.count ?? 0}
          pageSize={pageSize}
          onChange={(p, size) => {
            setPage(p);
            if (size !== pageSize) setPageSize(size);
          }}
          showSizeChanger
          pageSizeOptions={[25, 50, 100]}
          showTotal={(t, [from, to]) => `${from}–${to} / ${num(t)}`}
        />
      </div>

      {/* ── panels ───────────────────────────────────────────────────────── */}
      <MemberFilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        facets={facets}
        resultCount={totals.count}
        loading={query.isFetching}
      />

      <MemberForm
        open={formOpen}
        member={editing}
        onClose={() => setFormOpen(false)}
      />

      <MemberDetailsDrawer
        memberId={detailsId}
        open={Boolean(detailsId)}
        onClose={() => setDetailsId(null)}
        onEdit={(member) => {
          setDetailsId(null);
          openEdit(member);
        }}
      />
    </>
  );
}

/* ── bits ────────────────────────────────────────────────────────────────── */

const num = (n) => Number(n ?? 0).toLocaleString('en-IN');

/**
 * Filters → query string, matching what `lib/api.js` does.
 *
 * The export is fetched directly rather than through `api`, because it returns
 * a file rather than JSON — but it must be filtered identically, so the
 * encoding has to match.
 */
function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
