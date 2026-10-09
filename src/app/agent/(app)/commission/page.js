'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton } from 'antd';

import AgentShell, { ProgramChips, useAgentOverview } from '../../../../components/agent/AgentShell.js';
import { Chips, Empty, Stat } from '../../../../components/mobile/MobileShell.js';
import { inr, dmy, num } from '../../../../components/mobile/format.js';
import { api, keys } from '../../../../lib/api.js';
import { useActiveProgramId } from '../../../../lib/activeProgram.js';
import { useT } from '../../../../i18n/index.js';

const TYPE = { join_fee: 'नामांकन शुल्क', collection: 'वसूली', bonus: 'बोनस', adjustment: 'समायोजन' };
const STATUS = {
  earned: { cls: 'm-pill--warn', label: 'मिलना बाकी' },
  approved: { cls: 'm-pill--brand', label: 'भुगतान हेतु स्वीकृत' },
  paid: { cls: 'm-pill--paid', label: 'मिल गया' },
  cancelled: { cls: 'm-pill--muted', label: 'रद्द' },
};

/**
 * The agent's earnings: every commission entry (one per receipt that earned
 * something) and every payout the office has made.
 */
export default function AgentCommissionPage() {
  const t = useT();
  const programId = useActiveProgramId();
  const overview = useAgentOverview();
  const [tab, setTab] = useState('due');
  const { data, isLoading, error } = useQuery({
    queryKey: keys.agentCommission(programId),
    queryFn: () => api.agentApp.commission(),
    staleTime: 60 * 1000,
  });
  const a = overview.data?.agent;
  const entries = data?.entries ?? [];
  const net = (e) => Math.max(0, (e.amount || 0) - (e.reversedAmount || 0));

  const sums = useMemo(() => {
    const s = { joinFee: 0, collection: 0, due: 0, paid: 0, dueCount: 0 };
    for (const e of entries) {
      if (e.status === 'cancelled') continue;
      if (e.type === 'join_fee') s.joinFee += net(e); else s.collection += net(e);
      if (e.status === 'paid') s.paid += net(e); else { s.due += net(e); s.dueCount += 1; }
    }
    return s;
  }, [entries]);

  const shown = entries.filter((e) => (
    tab === 'due' ? ['earned', 'approved'].includes(e.status)
      : tab === 'paid' ? e.status === 'paid' : true
  ));

  return (
    <AgentShell title={t('मेरा कमीशन')}>
      <ProgramChips />
      {a ? (
        <div className="m-hero">
          <div className="m-hero__label">{t('मिलना बाकी (सभी योजनाएँ)')}</div>
          <div className="m-hero__value">{inr(a.dueTotal)}</div>
          <div className="m-hero__row">
            <div className="m-hero__chip">{t('कुल कमाया')}<b>{inr(a.earnedTotal)}</b></div>
            <div className="m-hero__chip">{t('मिल चुका')}<b>{inr(a.paidTotal)}</b></div>
            <div className="m-hero__chip">{t('कुल वसूली')}<b>{inr(a.collectedAmount)}</b></div>
          </div>
        </div>
      ) : null}

      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
        <>
          <div className="m-section-title">{t('इस योजना में')}</div>
          <div className="m-grid2">
            <Stat label={t('नामांकन शुल्क से')} value={inr(sums.joinFee)} />
            <Stat label={t('क्लोजिंग वसूली से')} value={inr(sums.collection)} />
            <Stat label={t('मिलना बाकी')} value={inr(sums.due)} hint={t('{n} एंट्री', { n: sums.dueCount })} tone="warn" />
            <Stat label={t('मिल चुका')} value={inr(sums.paid)} tone="paid" />
          </div>

          <Chips
            value={tab}
            onChange={setTab}
            options={[
              { value: 'due', label: t('मिलना बाकी') },
              { value: 'paid', label: t('मिल गया') },
              { value: 'all', label: t('सभी'), count: entries.length },
              { value: 'payouts', label: t('भुगतान मिले'), count: data?.payouts?.length },
            ]}
          />

          {tab === 'payouts' ? (
            <div className="m-card m-card--flush">
              {!data?.payouts?.length ? <Empty>{t('अभी कोई भुगतान नहीं')}</Empty> : data.payouts.map((p) => (
                <div key={p.id} className="m-row" style={{ cursor: 'default' }}>
                  <div className="m-row__main">
                    <div className="m-row__title">{p.payoutNo}</div>
                    <div className="m-row__sub">{dmy(p.paidAtMs)} · {t('{n} एंट्री', { n: p.entryCount })} · {p.method}</div>
                  </div>
                  <div className="m-row__side"><b className="m-paid">{inr(p.netTotal)}</b></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="m-card m-card--flush">
              {!shown.length ? <Empty>{t('कोई एंट्री नहीं')}</Empty> : shown.map((e) => {
                const st = STATUS[e.status] ?? STATUS.earned;
                return (
                  <div key={e.id} className="m-row" style={{ cursor: 'default' }}>
                    <div className="m-row__main">
                      <div className="m-row__title">{e.memberName || '—'} <span className="m-muted">#{e.memberRegNo}</span></div>
                      <div className="m-row__sub">
                        {t(TYPE[e.type] ?? e.type)} · {dmy(e.earnedAtMs)}{e.receiptNo ? ` · ${e.receiptNo}` : ''}
                      </div>
                      <div className="m-row__sub">
                        {inr(e.baseAmount)} {e.rateMode === 'percent' ? `× ${e.rateValue}%` : `· ${inr(e.rateValue)}`}
                        {e.reversedAmount ? ` · ${t('वापस')} ${inr(e.reversedAmount)}` : ''}
                      </div>
                    </div>
                    <div className="m-row__side">
                      <b>{inr(net(e))}</b>
                      <span className={`m-pill ${st.cls}`}>{t(st.label)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="m-muted" style={{ textAlign: 'center' }}>
            {t('हर रसीद के साथ कमीशन उसी समय जुड़ता है। रसीद रद्द होने पर वापस होता है।')} ({num(entries.length)})
          </div>
        </>
      )}
    </AgentShell>
  );
}
