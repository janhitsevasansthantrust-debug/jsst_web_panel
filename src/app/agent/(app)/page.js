'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Skeleton, Alert } from 'antd';
import {
  UserAddOutlined, FilePdfOutlined, CheckCircleOutlined, WalletOutlined, RightOutlined,
} from '@ant-design/icons';

import AgentShell, { ProgramChips, useAgentOverview } from '../../../components/agent/AgentShell.js';
import { Stat } from '../../../components/mobile/MobileShell.js';
import { inr, num, pct, dmy, openPdf } from '../../../components/mobile/format.js';
import { api, keys } from '../../../lib/api.js';
import { useActiveProgramId } from '../../../lib/activeProgram.js';
import { useT } from '../../../i18n/index.js';

/** The agent's home: their members' money at a glance, and what to do next. */
export default function AgentHome() {
  const t = useT();
  const router = useRouter();
  const programId = useActiveProgramId();
  const { data, isLoading, error } = useAgentOverview();
  const closings = useQuery({
    queryKey: keys.agentClosings(programId),
    queryFn: () => api.agentApp.closings(),
    staleTime: 60 * 1000,
  });

  const c = data?.current;
  const a = data?.agent;
  const program = data?.programs?.find((p) => p.id === (programId ?? data?.programId));

  return (
    <AgentShell>
      <ProgramChips />
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading || !data ? <Skeleton active paragraph={{ rows: 8 }} /> : (
        <>
          <div className="m-hero">
            <div className="m-hero__label">
              {t('नमस्ते')}, {a.displayName} · {program?.hiname || program?.name}
            </div>
            <div className="m-hero__value">{inr(c.dueAmount)}</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>
              {t('आपके {n} सदस्यों पर क्लोजिंग बकाया', { n: num(c.withDue) })}
            </div>
            <div className="m-hero__row">
              <div className="m-hero__chip">{t('सदस्य')}<b>{num(c.members)}</b></div>
              <div className="m-hero__chip">{t('कुल जमा')}<b>{inr(c.paidAmount)}</b></div>
              <div className="m-hero__chip">{t('शुल्क बाकी')}<b>{inr(c.feeDue)}</b></div>
            </div>
          </div>

          <div className="m-actions">
            <Link className="m-action" href="/agent/requests/new"><UserAddOutlined />{t('नया सदस्य')}</Link>
            <button type="button" className="m-action" onClick={() => openPdf(api.agentApp.duesPdfUrl('pending'))}>
              <FilePdfOutlined />{t('बकाया सूची')}
            </button>
            <button type="button" className="m-action" onClick={() => openPdf(api.agentApp.duesPdfUrl('paid'))}>
              <CheckCircleOutlined />{t('जमा सूची')}
            </button>
            <button type="button" className="m-action" onClick={() => openPdf(api.agentApp.duesPdfUrl('fee'))}>
              <WalletOutlined />{t('शुल्क बाकी सूची')}
            </button>
          </div>

          <div className="m-section-title">{t('सदस्य')}</div>
          <div className="m-grid2">
            <Stat label={t('सक्रिय सदस्य')} value={num(c.accepted)} hint={t('बंद {a} · ब्लॉक {b}', { a: c.closed, b: c.blocked })}
              onClick={() => router.push('/agent/members')} />
            <Stat label={t('बकायादार सदस्य')} value={num(c.withDue)} hint={t('{n} क्लोजिंग बाकी', { n: num(c.dueCount) })} tone="due"
              onClick={() => router.push('/agent/members?f=due')} />
            <Stat label={t('नामांकन शुल्क बाकी')} value={inr(c.feeDue)} hint={t('{n} सदस्यों पर', { n: c.feePendingMembers })} tone={c.feeDue ? 'warn' : undefined}
              onClick={() => router.push('/agent/members?f=feeDue')} />
            <Stat label={t('नामांकन शुल्क जमा')} value={inr(c.feePaid)} hint={t('कुल शुल्क {amt}', { amt: inr(c.feeTotal) })} tone="paid"
              onClick={() => router.push('/agent/members?f=feeDone')} />
          </div>

          <div className="m-section-title">{t('कमीशन')}</div>
          <Link href="/agent/commission" className="m-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            <div className="m-grid3">
              <div><div className="m-muted">{t('कुल कमाया')}</div><b>{inr(a.earnedTotal)}</b></div>
              <div><div className="m-muted">{t('मिल चुका')}</div><b className="m-paid">{inr(a.paidTotal)}</b></div>
              <div><div className="m-muted">{t('मिलना बाकी')}</div><b className="m-warn">{inr(a.dueTotal)}</b></div>
            </div>
            <div className="m-muted" style={{ marginTop: 6 }}>
              {t('कुल वसूली')} {inr(a.collectedAmount)} <RightOutlined style={{ fontSize: 10 }} />
            </div>
          </Link>

          <div className="m-section-title">
            <span>{t('सदस्य अनुरोध')}</span>
            <Link href="/agent/requests" style={{ textTransform: 'none' }}>{t('सब देखें')}</Link>
          </div>
          <div className="m-grid3">
            <Stat label={t('लंबित')} value={num(data.requests.pending)} tone="warn" onClick={() => router.push('/agent/requests?s=pending')} />
            <Stat label={t('स्वीकार हुए')} value={num(data.requests.approved)} tone="paid" onClick={() => router.push('/agent/requests?s=approved')} />
            <Stat label={t('अस्वीकृत')} value={num(data.requests.rejected)} tone={data.requests.rejected ? 'due' : undefined} onClick={() => router.push('/agent/requests?s=rejected')} />
          </div>

          <div className="m-section-title">
            <span>{t('हाल की क्लोजिंग')}</span>
            <Link href="/agent/closings" style={{ textTransform: 'none' }}>{t('सब देखें')}</Link>
          </div>
          <div className="m-card m-card--flush">
            {closings.isLoading ? <div style={{ padding: 14 }}><Skeleton active /></div> : (closings.data?.closings ?? []).slice(0, 4).map((cl) => (
              <Link key={cl.seq} href={`/agent/closings/${cl.closingId}`} className="m-row">
                <div className="m-seq">{cl.seq}</div>
                <div className="m-row__main">
                  <div className="m-row__title">{cl.name}</div>
                  <div className="m-row__sub">{dmy(cl.dateMs)} · {t('जमा {a}/{b}', { a: cl.paidCount, b: cl.eligibleCount })}</div>
                  <div className="m-progress"><span style={{ width: `${pct(cl.paidCount, cl.eligibleCount)}%` }} /></div>
                </div>
                <div className="m-row__side">
                  <b className={cl.pendingAmount ? 'm-due' : 'm-paid'}>{inr(cl.pendingAmount)}</b>
                  {t('{n} बाकी', { n: cl.pendingCount })}
                </div>
              </Link>
            ))}
            {closings.data && !closings.data.closings.length ? <div className="m-empty">{t('अभी कोई क्लोजिंग नहीं')}</div> : null}
          </div>
        </>
      )}
    </AgentShell>
  );
}
