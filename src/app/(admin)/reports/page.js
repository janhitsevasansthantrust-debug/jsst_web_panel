'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  App, Button, Card, Col, DatePicker, Input, Row, Segmented, Select, Space, Tag,
  Tooltip, Typography,
} from 'antd';
import {
  FileExcelOutlined, FilePdfOutlined, FileTextOutlined, ProfileOutlined,
  ReloadOutlined, RiseOutlined, SearchOutlined, WalletOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import StatCard from '../../../components/ui/StatCard.js';
import DataGrid, { money, dateCell, inr } from '../../../components/ui/DataGrid.js';
import { api, keys } from '../../../lib/api.js';
import { useDebounced } from '../../../lib/useDebounced.js';
import { useT } from '../../../i18n/index.js';
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '../../../config/labels.js';
import { ROLE, ROLE_RANK } from '../../../config/constants.js';

const { Text } = Typography;

/**
 * रिपोर्ट / लेन-देन — the receipt register, filtered and exported.
 *
 * Three jobs in one place: decide which receipts belong in the answer, read
 * what that answer totals to, and take it away as a file or a printed sheet.
 *
 * The totals are a SEPARATE request from the rows, and that is the point. The
 * rows are one screenful, paginated; the totals are worked out over every
 * receipt the filter matches, server-side. Deriving them from whatever is
 * loaded would make the top of the page grow as the operator scrolls, and a
 * collection figure that moves is not a figure anybody can quote at a meeting.
 *
 * Every control feeds the same filter object, which is sent to BOTH requests —
 * so the grid, the four numbers and the downloaded file cannot disagree. An
 * export that quietly ignores a filter produces a file somebody then
 * reconciles by hand.
 */
export default function ReportsPage() {
  const t = useT();
  const { message } = App.useApp();

  const [range, setRange] = useState(null);
  const [agentId, setAgentId] = useState();
  const [method, setMethod] = useState();
  const [status, setStatus] = useState();
  const [term, setTerm] = useState('');
  const [exporting, setExporting] = useState(null);

  // Debounced, so a half-typed name does not start a read on every keystroke.
  const search = useDebounced(term, 300);

  /**
   * One object, used by everything on the page.
   *
   * `paidFromMs`/`paidToMs` are the days the money was taken, widened to the
   * ends of those days — a range typed as "1st to 30th" that stopped at
   * midnight would drop the thirtieth and look merely short, not wrong.
   */
  const filters = useMemo(
    () => ({
      paidFromMs: range?.[0]?.startOf('day').valueOf(),
      paidToMs: range?.[1]?.endOf('day').valueOf(),
      agentId: agentId || undefined,
      method: method || undefined,
      status: status || undefined,
      q: search?.trim() || undefined,
    }),
    [range, agentId, method, status, search],
  );

  const active = Boolean(
    range || filters.agentId || filters.method || filters.status || filters.q,
  );

  const session = useQuery({ queryKey: ['session', 'me'], queryFn: () => api.session.me() });
  // An agent is already scoped to their own collections server-side; offering
  // them an agent dropdown would be a control that selects something the
  // server then ignores.
  const canPickAgent = (ROLE_RANK[session.data?.user?.role] ?? 0) >= ROLE_RANK[ROLE.OPERATOR];

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: () => api.agents.list(),
    enabled: canPickAgent,
  });

  const rowsQuery = useInfiniteQuery({
    queryKey: keys.payments(filters),
    queryFn: ({ pageParam }) =>
      api.payments.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const totalsQuery = useQuery({
    queryKey: ['payments', 'report', filters],
    queryFn: () => api.payments.report(filters),
    // The previous figures stay on screen while the new ones are read, so the
    // four numbers do not flicker to zero on every filter change.
    placeholderData: keepPreviousData,
  });

  const totals = totalsQuery.data?.totals ?? {};
  const count = totals.count ?? 0;

  const rows = useMemo(
    () => (rowsQuery.data?.pages ?? []).flatMap((p) => p.payments),
    [rowsQuery.data],
  );

  // Keyed on the language, not on nothing.
  //
  // The first render of any page is the English hydration pass — `useLocale`
  // falls back to `DEFAULT_LOCALE` until React has caught up with
  // localStorage — so a memo with `[]` would compute the headers in English
  // once and hand a Hindi page an English grid forever. `t` itself is a fresh
  // function on every render, so depending on it would rebuild the columns on
  // every keystroke; `t.locale` is the one thing that actually changes.
  const locale = t.locale;
  const columns = useMemo(
    () => [
      { headerName: t('रसीद नं.'), field: 'receiptNo', width: 170, pinned: 'left' },
      { headerName: t('तिथि'), field: 'paidAtMs', width: 120, valueFormatter: dateCell },
      {
        headerName: t('सदस्य'),
        field: 'memberSnapshot.name',
        flex: 1,
        minWidth: 150,
        valueGetter: (p) => p.data?.memberSnapshot?.name,
      },
      {
        headerName: t('रजि.'),
        width: 95,
        valueGetter: (p) => p.data?.memberSnapshot?.regNo,
      },
      { headerName: t('क्लोजिंग'), field: 'itemCount', width: 95, type: 'rightAligned' },
      {
        headerName: t('क्लोजिंग राशि'),
        field: 'closingAmount',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
      },
      {
        headerName: t('नामांकन शुल्क'),
        field: 'joinFeeAmount',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
      },
      {
        headerName: t('कुल राशि'),
        field: 'totalAmount',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
        cellStyle: { color: 'var(--paid)', fontWeight: 600 },
      },
      {
        headerName: t('तरीका'),
        field: 'method',
        width: 100,
        valueFormatter: (p) => t(PAYMENT_METHOD_LABEL[p.value] ?? ''),
      },
      { headerName: t('एजेंट'), field: 'collectedByAgentName', width: 150 },
      {
        headerName: t('स्थिति'),
        field: 'status',
        width: 100,
        cellRenderer: (p) =>
          p.value === 'cancelled' ? (
            <Tag color="red">{t(PAYMENT_STATUS_LABEL[p.value])}</Tag>
          ) : (
            <Tag color="green">{t(PAYMENT_STATUS_LABEL[p.value] ?? '')}</Tag>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  /**
   * Take the file away.
   *
   * Through `fetch` rather than a plain link because the server answers a
   * failure as JSON even on this endpoint — "कोई योजना नहीं चुनी" is an answer,
   * "डाउनलोड नहीं हुआ (400)" is not.
   */
  async function download(format) {
    setExporting(format);
    try {
      const response = await fetch(api.payments.reportUrl(filters, format), {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? t('डाउनलोड नहीं हुआ ({code})', { code: response.status }));
      }

      const rowCount = Number(response.headers.get('X-Total-Rows') ?? 0);
      if (rowCount === 0) {
        message.warning(t('इन फ़िल्टरों पर कोई रसीद नहीं — फ़ाइल खाली रहेगी'));
      }

      const blob = await response.blob();
      const name =
        response.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ??
        `receipts.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (rowCount > 0) {
        message.success(t('{n} रसीदें डाउनलोड हो गईं', { n: rowCount.toLocaleString('en-IN') }));
      }
    } catch (error) {
      message.error(error.message);
    } finally {
      setExporting(null);
    }
  }

  const clear = () => {
    setRange(null);
    setAgentId(undefined);
    setMethod(undefined);
    setStatus(undefined);
    setTerm('');
  };

  return (
    <>
      <PageHeader
        title={t('रिपोर्ट / लेन-देन')}
        subtitle={
          totalsQuery.isLoading
            ? t('गिनती हो रही है…')
            : active
              ? t('इन फ़िल्टरों पर {n} रसीदें · {m} स्क्रीन पर', { n: count, m: rows.length })
              : t('पूरा लेन-देन · {n} रसीदें · {m} स्क्रीन पर', { n: count, m: rows.length })
        }
        error={rowsQuery.error ?? totalsQuery.error}
        extra={
          <>
            <Tooltip title={t('पूरी फ़िल्टर सूची — Excel के लिए')}>
              <Button
                icon={<FileExcelOutlined />}
                loading={exporting === 'csv'}
                onClick={() => download('csv')}
              >
                {t('CSV डाउनलोड')}
              </Button>
            </Tooltip>
            <Tooltip title={t('ट्रस्ट के लोगो और हेडर के साथ छपने लायक')}>
              <Button
                icon={<FilePdfOutlined />}
                loading={exporting === 'pdf'}
                onClick={() => download('pdf')}
              >
                {t('PDF रजिस्टर')}
              </Button>
            </Tooltip>
            <Tooltip title={t('दोबारा लाएँ')}>
              <Button
                icon={<ReloadOutlined />}
                loading={rowsQuery.isFetching || totalsQuery.isFetching}
                onClick={() => {
                  rowsQuery.refetch();
                  totalsQuery.refetch();
                }}
              />
            </Tooltip>
          </>
        }
      />

      {/* ── the filter bar ──────────────────────────────────────────────
          Every control here feeds ONE object that goes to the rows request,
          the totals request and both downloads. A second filter state for the
          export would be the mechanism by which a file silently disagrees with
          the screen it was downloaded from. */}
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { padding: '14px 16px' } }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <span>{t('रसीद की तिथि')}</span>
            <DatePicker.RangePicker
              value={range}
              onChange={setRange}
              format="DD-MM-YYYY"
              allowEmpty={[true, true]}
              style={{ width: 250 }}
            />
          </div>

          {canPickAgent && (
            <div className="field">
              <span>{t('एजेंट')}</span>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('सभी एजेंट')}
                style={{ width: 210 }}
                value={agentId}
                onChange={setAgentId}
                loading={agents.isLoading}
                options={(agents.data?.agents ?? []).map((a) => ({
                  label: a.displayName,
                  value: a.id,
                }))}
              />
            </div>
          )}

          <div className="field">
            <span>{t('तरीका')}</span>
            <Select
              allowClear
              placeholder={t('सभी')}
              style={{ width: 150 }}
              value={method}
              onChange={setMethod}
              options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({
                label: t(label),
                value,
              }))}
            />
          </div>

          <div className="field">
            <span>{t('स्थिति')}</span>
            <Segmented
              value={status ?? 'all'}
              onChange={(v) => setStatus(v === 'all' ? undefined : v)}
              options={[
                { label: t('सभी'), value: 'all' },
                { label: t('जमा'), value: 'completed' },
                { label: t('रद्द'), value: 'cancelled' },
              ]}
            />
          </div>

          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span>{t('खोजें')}</span>
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--muted)' }} />}
              placeholder={t('रसीद नं., सदस्य, रजि., एजेंट, टिप्पणी…')}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>

          {active && (
            <Button onClick={clear}>{t('फ़िल्टर हटाएँ')}</Button>
          )}
        </div>
      </Card>

      {/* ── the four numbers ─────────────────────────────────────────────
          Scoped by the filter above and nothing else, so their meaning never
          depends on which control the operator last touched. The caption under
          them says what the scope is. */}
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <StatCard
            icon={<FileTextOutlined />}
            color="var(--brand)"
            label={t('रसीदें')}
            value={count.toLocaleString('en-IN')}
            hint={
              (totals.cancelled ?? 0) > 0
                ? t('उनमें रद्द {n}', { n: totals.cancelled })
                : undefined
            }
          />
        </Col>

        <Col xs={12} lg={6}>
          <StatCard
            icon={<WalletOutlined />}
            color="var(--accent)"
            label={t('कुल जमा')}
            value={inr(totals.collected)}
            hint={
              (totals.cancelledAmount ?? 0) > 0
                ? t('रद्द {amt} इसमें नहीं', { amt: inr(totals.cancelledAmount) })
                : t('{n} सदस्यों से', { n: totals.members ?? 0 })
            }
          />
        </Col>

        <Col xs={12} lg={6}>
          <StatCard
            icon={<RiseOutlined />}
            label={t('क्लोजिंग जमा')}
            value={inr(totals.closingAmount)}
            hint={t('किस्तों के खिलाफ़')}
          />
        </Col>

        <Col xs={12} lg={6}>
          <StatCard
            icon={<ProfileOutlined />}
            label={t('नामांकन शुल्क')}
            value={inr(totals.joinFeeAmount)}
            hint={t('क्लोजिंग के अलावा')}
          />
        </Col>
      </Row>

      <Text
        type="secondary"
        style={{ display: 'block', margin: '14px 0 10px', fontSize: 12.5 }}
      >
        {active
          ? t('ये चारों आँकड़े सिर्फ़ ऊपर चुने गए फ़िल्टरों पर हैं — पूरे ट्रस्ट के नहीं')
          : t('ये चारों आँकड़े पूरे लेन-देन के हैं')}
      </Text>

      <DataGrid
        rows={rows}
        columns={columns}
        loading={rowsQuery.isLoading}
        getRowId={(p) => p.data.id}
        emptyText={active ? t('इन फ़िल्टरों पर कोई रसीद नहीं') : t('अभी कोई रसीद नहीं')}
      />

      {rowsQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => rowsQuery.fetchNextPage()} loading={rowsQuery.isFetchingNextPage}>
            {t('और 50 लोड करें')}
          </Button>
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Space size={6} wrap>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            {t('पूरी सूची एक बार में')}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {t('CSV और PDF में वही रसीदें जाती हैं जो ऊपर फ़िल्टर से चुनी गई हैं — पन्ने की सीमा नहीं')}
          </Text>
        </Space>
      </div>
    </>
  );
}
