'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Input, Skeleton, Alert } from 'antd';
import { SearchOutlined, FilePdfOutlined } from '@ant-design/icons';

import AgentShell, { ProgramChips } from '../../../../components/agent/AgentShell.js';
import { Avatar, Chips, Empty, Stat } from '../../../../components/mobile/MobileShell.js';
import { inr, num, openPdf, STATUS_PILL } from '../../../../components/mobile/format.js';
import { api } from '../../../../lib/api.js';
import { useActiveProgramId } from '../../../../lib/activeProgram.js';
import { useDebounced } from '../../../../lib/useDebounced.js';
import { useT } from '../../../../i18n/index.js';

/**
 * The agent's members. The list endpoint is already cut down to this agent on
 * the server, so every filter here is a filter over their own people only.
 */
const FILTERS = {
  all: {},
  due: { hasDue: 'true' },
  paid: { hasDue: 'false' },
  feeDue: { hasFeeDue: 'true' },
  feeDone: { hasFeeDue: 'false' },
  active: { status: 'accepted' },
  closed: { status: 'closed' },
  blocked: { status: 'blocked' },
};

export default function AgentMembersPage() {
  return (
    <Suspense>
      <Members />
    </Suspense>
  );
}

function Members() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const programId = useActiveProgramId();
  const f = FILTERS[params.get('f')] ? params.get('f') : 'all';
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);

  const query = useInfiniteQuery({
    queryKey: ['members', 'agent-app', programId, f, q],
    queryFn: ({ pageParam }) => api.members.list({
      ...FILTERS[f], q: q.length >= 2 ? q : undefined,
      sortBy: f === 'due' ? 'dueAmount' : 'registrationNumber',
      sortDir: f === 'due' ? 'desc' : 'asc',
      page: pageParam, limit: 50,
    }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    staleTime: 60 * 1000,
  });

  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.members), [query.data]);
  const first = query.data?.pages?.[0];
  const totals = first?.totals;

  const setFilter = (v) => router.replace(v === 'all' ? '/agent/members' : `/agent/members?f=${v}`);
  const pdfMode = f === 'feeDue' ? 'fee' : f === 'paid' ? 'paid' : 'pending';

  return (
    <AgentShell title={t('मेरे सदस्य')}>
      <ProgramChips />
      <div className="m-sticky-tools">
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('नाम, रजि. नंबर, मोबाइल, गाँव…')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Chips
          value={f}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('सभी') },
            { value: 'due', label: t('बकाया') },
            { value: 'paid', label: t('पूरा जमा') },
            { value: 'feeDue', label: t('शुल्क बाकी') },
            { value: 'feeDone', label: t('शुल्क जमा') },
            { value: 'active', label: t('सक्रिय') },
            { value: 'closed', label: t('बंद') },
            { value: 'blocked', label: t('ब्लॉक') },
          ]}
        />
      </div>

      {query.error ? <Alert type="error" showIcon message={query.error.message} /> : null}

      {totals ? (
        <div className="m-grid3">
          <Stat label={t('सदस्य')} value={num(first.total)} />
          {f === 'feeDue' || f === 'feeDone' ? (
            <>
              <Stat label={t('शुल्क बाकी')} value={inr(totals.feeDueAmount)} tone="due" />
              <Stat label={t('शुल्क जमा')} value={inr(totals.feePaidAmount)} tone="paid" />
            </>
          ) : (
            <>
              <Stat label={t('बकाया')} value={inr(totals.dueAmount)} tone="due" />
              <Stat label={t('जमा')} value={inr(totals.paidAmount)} tone="paid" />
            </>
          )}
        </div>
      ) : null}

      <Button icon={<FilePdfOutlined />} onClick={() => openPdf(api.agentApp.duesPdfUrl(pdfMode))}>
        {pdfMode === 'fee' ? t('शुल्क बाकी सूची PDF') : pdfMode === 'paid' ? t('जमा सूची PDF') : t('बकाया सूची PDF')}
      </Button>

      <div className="m-card m-card--flush">
        {query.isLoading ? <div style={{ padding: 14 }}><Skeleton active avatar paragraph={{ rows: 6 }} /></div> : null}
        {!query.isLoading && rows.length === 0 ? <Empty>{t('कोई सदस्य नहीं मिला')}</Empty> : null}
        {rows.map((m) => {
          const pill = STATUS_PILL[m.status];
          return (
            <Link key={m.id} href={`/agent/members/${m.id}`} className="m-row">
              <Avatar src={m.photoURL} name={m.displayName} />
              <div className="m-row__main">
                <div className="m-row__title">{m.displayName}</div>
                <div className="m-row__sub">
                  #{m.registrationNumber} · {m.fatherName || '—'} · {m.village || ''}
                </div>
                <div className="m-row__sub">
                  {pill && m.status !== 'accepted' ? <span className={`m-pill ${pill.cls}`} style={{ marginRight: 6 }}>{t(pill.label)}</span> : null}
                  {m.joinFeesDue > 0
                    ? <span className="m-pill m-pill--warn">{t('शुल्क बाकी')} {inr(m.joinFeesDue)}</span>
                    : <span className="m-pill m-pill--paid">{t('शुल्क जमा')}</span>}
                </div>
              </div>
              <div className="m-row__side">
                {m.dueAmount > 0 ? (
                  <><b className="m-due">{inr(m.dueAmount)}</b>{t('{n} बाकी', { n: m.dueCount })}</>
                ) : (
                  <><b className="m-paid">{inr(m.paidAmount)}</b>{t('जमा')}</>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {query.hasNextPage ? (
        <Button block size="large" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {t('और दिखाएँ')} ({num(rows.length)} / {num(first?.total)})
        </Button>
      ) : null}
    </AgentShell>
  );
}
