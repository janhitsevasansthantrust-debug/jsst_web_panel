'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton } from 'antd';
import { FilePdfOutlined, PhoneOutlined } from '@ant-design/icons';

import AgentShell from '../../../../../components/agent/AgentShell.js';
import { Avatar, Chips, Empty, Stat } from '../../../../../components/mobile/MobileShell.js';
import { inr, num, dmy, openPdf } from '../../../../../components/mobile/format.js';
import { api, keys } from '../../../../../lib/api.js';
import { useT } from '../../../../../i18n/index.js';

/** One closing: which of the agent's members have paid it and who still owes. */
export default function AgentClosingPage({ params }) {
  const { id } = use(params);
  const t = useT();
  const [f, setF] = useState('pending');
  const { data, isLoading, error } = useQuery({
    queryKey: keys.agentClosing(id),
    queryFn: () => api.agentApp.closing(id),
    staleTime: 30 * 1000,
  });

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (
    f === 'pending' ? r.remaining > 0 : f === 'paid' ? r.remaining <= 0 : true
  )), [data, f]);
  const c = data?.closing;
  const tot = data?.totals;

  return (
    <AgentShell back="/agent/closings" title={c ? `#${c.seq} ${c.name}` : t('क्लोजिंग')} subtitle={c ? `${t('क्लोजिंग')} ${dmy(c.dateMs)}${c.village ? ` · ${c.village}` : ''}` : ''}>
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {data ? (
        <>
          <div className="m-grid3">
            <Stat label={t('आपके सदस्य')} value={num(tot.members)} hint={inr(tot.amount)} />
            <Stat label={t('बाकी')} value={inr(tot.pendingAmount)} hint={t('{n} सदस्य', { n: tot.pendingCount })} tone="due" onClick={() => setF('pending')} />
            <Stat label={t('जमा')} value={inr(tot.paidAmount)} hint={t('{n} सदस्य', { n: tot.paidCount })} tone="paid" onClick={() => setF('paid')} />
          </div>

          <div className="m-grid2">
            <Button size="large" icon={<FilePdfOutlined />} onClick={() => openPdf(api.agentApp.closingPdfUrl(id, 'pending'))}>{t('बकाया PDF')}</Button>
            <Button size="large" icon={<FilePdfOutlined />} onClick={() => openPdf(api.agentApp.closingPdfUrl(id, 'paid'))}>{t('जमा PDF')}</Button>
          </div>

          <Chips
            value={f}
            onChange={setF}
            options={[
              { value: 'pending', label: t('बकाया'), count: tot.pendingCount },
              { value: 'paid', label: t('जमा'), count: tot.paidCount },
              { value: 'all', label: t('सभी'), count: tot.members },
            ]}
          />

          <div className="m-card m-card--flush">
            {!rows.length ? <Empty>{f === 'pending' ? t('सबने जमा कर दिया 🎉') : t('कोई नहीं')}</Empty> : null}
            {rows.map((r) => (
              <div key={r.id} className="m-row" style={{ cursor: 'default' }}>
                <Link href={`/agent/members/${r.id}`} style={{ display: 'flex', gap: 11, alignItems: 'center', flex: 1, minWidth: 0, color: 'inherit' }}>
                  <Avatar src={r.photoURL} name={r.displayName} />
                  <div className="m-row__main">
                    <div className="m-row__title">{r.displayName}</div>
                    <div className="m-row__sub">#{r.registrationNumber} · {r.fatherName || '—'} · {r.village}</div>
                    {r.totalDueAmount > r.remaining ? (
                      <div className="m-row__sub">{t('कुल बकाया')} {inr(r.totalDueAmount)} ({t('{n} क्लोजिंग', { n: r.totalDueCount })})</div>
                    ) : null}
                  </div>
                </Link>
                <div className="m-row__side">
                  {r.remaining > 0
                    ? <><b className="m-due">{inr(r.remaining)}</b>{r.status === 'partial' ? `${t('आंशिक')} ${inr(r.paid)}` : t('बाकी')}</>
                    : <><b className="m-paid">{inr(r.paid)}</b>{t('जमा')}</>}
                </div>
                {r.phone && r.remaining > 0 ? (
                  <a href={`tel:${r.phone}`} aria-label={t('कॉल करें')} style={{ marginLeft: 4 }}>
                    <Button shape="circle" icon={<PhoneOutlined />} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </AgentShell>
  );
}
