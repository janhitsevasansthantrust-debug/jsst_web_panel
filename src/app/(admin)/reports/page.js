'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, Space, Tag, Alert, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import DataGrid, { money, dateCell } from '../../../components/ui/DataGrid.js';
import { api } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Paragraph } = Typography;

/**
 * The receipt register (लेन-देन).
 *
 * Paginated over receipts — a few thousand documents at most, because a
 * receipt is created only when money actually moves. The old system's
 * equivalent screen paged over millions of obligation rows.
 *
 * PDF export lands here next: server-side @react-pdf with the trust's own
 * logo and header pulled from the database.
 */
export default function ReportsPage() {
  const [params] = useState({ limit: 50 });
  const t = useT();

  const query = useInfiniteQuery({
    queryKey: ['payments', params],
    queryFn: ({ pageParam }) => api.payments.list({ ...params, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.payments),
    [query.data],
  );

  const columns = useMemo(
    () => [
      { headerName: t('रसीद नं.'), field: 'receiptNo', width: 170, pinned: 'left' },
      { headerName: t('तिथि'), field: 'paidAtMs', width: 120, valueFormatter: dateCell },
      {
        headerName: t('सदस्य'),
        field: 'memberSnapshot.name',
        flex: 1,
        minWidth: 160,
        valueGetter: (p) => p.data?.memberSnapshot?.name,
      },
      {
        headerName: t('रजि.'),
        width: 100,
        valueGetter: (p) => p.data?.memberSnapshot?.regNo,
      },
      { headerName: t('क्लोजिंग'), field: 'itemCount', width: 100, type: 'rightAligned' },
      {
        headerName: t('राशि'),
        field: 'totalAmount',
        width: 130,
        type: 'rightAligned',
        valueFormatter: money,
        cellStyle: { color: 'var(--paid)', fontWeight: 600 },
      },
      { headerName: t('तरीका'), field: 'method', width: 100 },
      { headerName: t('एजेंट'), field: 'collectedByAgentName', width: 150 },
      {
        headerName: t('स्थिति'),
        field: 'status',
        width: 100,
        cellRenderer: (p) =>
          p.value === 'cancelled' ? <Tag color="red">{t('रद्द')}</Tag> : <Tag color="green">{t('जमा')}</Tag>,
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title={t('रिपोर्ट / लेन-देन')}
        subtitle={t('{n} रसीदें लोड हुईं', { n: rows.length })}
        error={query.error}
        extra={<Button icon={<ReloadOutlined />} onClick={() => query.refetch()} />}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('PDF एक्सपोर्ट अगले चरण में')}
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            {t(`रसीद, सदस्य सूची, बकाया सूची, क्लोजिंग रिपोर्ट और एजेंट स्टेटमेंट —
सब server-side बनेंगे, ट्रस्ट का अपना लोगो और हेडर डेटाबेस से लेकर।
बड़ी सूचियाँ background job में बनेंगी, ताकि browser 5000 rows पर अटके नहीं।`)}
          </Paragraph>
        }
      />

      <DataGrid
        rows={rows}
        columns={columns}
        loading={query.isLoading}
        getRowId={(p) => p.data.id}
        emptyText={t('अभी कोई रसीद नहीं')}
      />

      {query.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            {t('और 50 लोड करें')}
          </Button>
        </div>
      )}
    </>
  );
}
