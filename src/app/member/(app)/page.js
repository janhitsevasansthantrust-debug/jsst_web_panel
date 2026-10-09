'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton } from 'antd';
import { RightOutlined } from '@ant-design/icons';

import MemberShell from '../../../components/member/MemberShell.js';
import { Avatar } from '../../../components/mobile/MobileShell.js';
import { inr, dmy, STATUS_PILL } from '../../../components/mobile/format.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

/**
 * The member app's home: everyone on this mobile number, योजना by योजना,
 * with what each owes and has paid. Tap a member for their full account.
 */
export default function MemberHome() {
  const t = useT();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.portalHome,
    queryFn: () => api.portal.home(),
    staleTime: 60 * 1000,
  });

  const groups = (data?.programs ?? [])
    .map((p) => ({ ...p, members: (data?.members ?? []).filter((m) => m.programId === p.id) }))
    .filter((g) => g.members.length);
  const orphans = (data?.members ?? []).filter((m) => !(data?.programs ?? []).some((p) => p.id === m.programId));
  if (orphans.length) groups.push({ id: '_', name: t('अन्य'), members: orphans });

  return (
    <MemberShell title={data ? `${t('नमस्ते')}, ${data.self.displayName}` : undefined} subtitle={data ? `${t('रजि.')} ${data.self.registrationNumber} · ${data.self.phone}` : undefined}>
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading ? <Skeleton active avatar paragraph={{ rows: 8 }} /> : null}
      {data ? (
        <>
          <div className="m-hero">
            <div className="m-hero__label">{t('परिवार का कुल बकाया')}</div>
            <div className="m-hero__value">{inr(data.totals.dueAmount + data.totals.feeDue)}</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>
              {t('इस मोबाइल नंबर पर {n} सदस्य', { n: data.totals.members })}
              {data.totals.feeDue ? ` · ${t('शुल्क बाकी')} ${inr(data.totals.feeDue)}` : ''}
            </div>
            <div className="m-hero__row">
              <div className="m-hero__chip">{t('क्लोजिंग बकाया')}<b>{inr(data.totals.dueAmount)}</b></div>
              <div className="m-hero__chip">{t('कुल जमा')}<b>{inr(data.totals.paidAmount)}</b></div>
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="m-section-title">
                <span>{g.hiname || g.name}</span>
                <span style={{ textTransform: 'none' }}>{t('{n} सदस्य', { n: g.members.length })}</span>
              </div>
              <div className="m-card m-card--flush">
                {g.members.map((m) => {
                  const pill = STATUS_PILL[m.status];
                  return (
                    <Link key={m.id} href={`/member/m/${m.id}`} className="m-row">
                      <Avatar src={m.photoURL} name={m.displayName} size={44} />
                      <div className="m-row__main">
                        <div className="m-row__title">
                          {m.displayName}{m.isSelf ? <span className="m-pill m-pill--brand" style={{ marginLeft: 6 }}>{t('आप')}</span> : null}
                        </div>
                        <div className="m-row__sub">{t('रजि.')} {m.registrationNumber} · {m.fatherName || '—'}</div>
                        <div className="m-row__sub">
                          {pill ? <span className={`m-pill ${pill.cls}`} style={{ marginRight: 6 }}>{t(pill.label)}</span> : null}
                          {t('जुड़े')} {dmy(m.joinDateMs)}
                          {m.joinFeesDue > 0 ? <span className="m-pill m-pill--warn" style={{ marginLeft: 6 }}>{t('शुल्क बाकी')} {inr(m.joinFeesDue)}</span> : null}
                        </div>
                      </div>
                      <div className="m-row__side">
                        {m.dueAmount > 0
                          ? <><b className="m-due">{inr(m.dueAmount)}</b>{t('{n} बाकी', { n: m.dueCount })}</>
                          : <><b className="m-paid">{inr(m.paidAmount)}</b>{t('सब जमा')}</>}
                        <RightOutlined style={{ fontSize: 10, color: 'var(--muted)' }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="m-muted" style={{ textAlign: 'center', padding: '0 10px' }}>
            {t('इस सूची में वे सब सदस्य हैं जिनका मोबाइल नंबर आपके नंबर से मिलता है। कोई गलत या छूटा हो तो अपने एजेंट या कार्यालय को बताएँ।')}
          </div>
        </>
      ) : null}
    </MemberShell>
  );
}
