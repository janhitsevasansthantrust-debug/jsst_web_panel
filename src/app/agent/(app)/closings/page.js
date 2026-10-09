'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Input, Skeleton } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

import AgentShell, { ProgramChips } from '../../../../components/agent/AgentShell.js';
import { Chips, Empty, Stat } from '../../../../components/mobile/MobileShell.js';
import { inr, num, pct, dmy } from '../../../../components/mobile/format.js';
import { api, keys } from '../../../../lib/api.js';
import { useActiveProgramId } from '../../../../lib/activeProgram.js';
import { useT } from '../../../../i18n/index.js';

/**
 * Every closing, with how many of this agent's members have paid it and how
 * much is still out. Tap one for the member list and the PDF.
 */
export default function AgentClosingsPage() {
  const t = useT();
  const programId = useActiveProgramId();
  const [f, setF] = useState('pending');
  const [text, setText] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: keys.agentClosings(programId),
    queryFn: () => api.agentApp.closings(),
    staleTime: 60 * 1000,
  });

  const all = data?.closings ?? [];
  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return all
      .filter((c) => (f === 'pending' ? c.pendingCount > 0 : f === 'done' ? c.pendingCount === 0 : true))
      .filter((c) => !q || [c.name, c.regNo, c.village, String(c.seq)].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [all, f, text]);
  const tot = data?.totals;

  return (
    <AgentShell title={t('क्लोजिंग सूची')}>
      <ProgramChips />
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {tot ? (
        <div className="m-grid3">
          <Stat label={t('क्लोजिंग')} value={num(tot.closings)} hint={t('{n} सदस्य', { n: data.members })} />
          <Stat label={t('बाकी')} value={inr(tot.pendingAmount)} hint={t('{n} किस्तें', { n: num(tot.pendingCount) })} tone="due" />
          <Stat label={t('जमा')} value={inr(tot.paidAmount)} hint={t('{n} किस्तें', { n: num(tot.paidCount) })} tone="paid" />
        </div>
      ) : null}
      <div className="m-sticky-tools">
        <Input size="large" allowClear prefix={<SearchOutlined />} placeholder={t('नाम, रजि., गाँव, क्रमांक…')} value={text} onChange={(e) => setText(e.target.value)} />
        <Chips
          value={f}
          onChange={setF}
          options={[
            { value: 'pending', label: t('बकाया वाली'), count: all.filter((c) => c.pendingCount > 0).length },
            { value: 'done', label: t('पूरी जमा'), count: all.filter((c) => c.pendingCount === 0).length },
            { value: 'all', label: t('सभी'), count: all.length },
          ]}
        />
      </div>
      <div className="m-card m-card--flush">
        {isLoading ? <div style={{ padding: 14 }}><Skeleton active paragraph={{ rows: 6 }} /></div> : null}
        {!isLoading && !rows.length ? <Empty>{t('कोई क्लोजिंग नहीं')}</Empty> : null}
        {rows.map((c) => (
          <Link key={c.seq} href={`/agent/closings/${c.closingId}`} className="m-row">
            <div className="m-seq">{c.seq}</div>
            <div className="m-row__main">
              <div className="m-row__title">{c.name}{c.regNo ? <span className="m-muted"> · {c.regNo}</span> : null}</div>
              <div className="m-row__sub">{dmy(c.dateMs)}{c.village ? ` · ${c.village}` : ''}</div>
              <div className="m-row__sub">{t('जमा {a}/{b} सदस्य', { a: c.paidCount, b: c.eligibleCount })} · {inr(c.paidAmount)}</div>
              <div className="m-progress"><span style={{ width: `${pct(c.paidCount, c.eligibleCount)}%` }} /></div>
            </div>
            <div className="m-row__side">
              <b className={c.pendingAmount ? 'm-due' : 'm-paid'}>{inr(c.pendingAmount)}</b>
              {c.pendingCount ? t('{n} बाकी', { n: c.pendingCount }) : t('पूरी जमा')}
            </div>
          </Link>
        ))}
      </div>
    </AgentShell>
  );
}
