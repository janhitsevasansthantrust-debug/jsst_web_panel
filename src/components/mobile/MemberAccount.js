'use client';

import { useMemo, useState } from 'react';
import { Button } from 'antd';
import {
  PhoneOutlined, SafetyCertificateOutlined, FilePdfOutlined, FileTextOutlined,
  ClockCircleOutlined, CheckCircleOutlined,
} from '@ant-design/icons';

import { useT } from '../../i18n/index.js';
import { Avatar, Chips, Empty, Stat } from './MobileShell.js';
import { inr, dmy, num, pct, openPdf, STATUS_PILL } from './format.js';

/**
 * One member's whole account, for a phone — shared by the agent app and the
 * member app so the two can never show a family different numbers.
 *
 * `detail` is the server's `buildMemberDetail` result. `urls` builds the PDF
 * links, because the two apps reach them through different, differently
 * guarded routes:
 *   { certificate(), statement(mode), receipt(receipt) }
 */
export default function MemberAccount({ detail, urls }) {
  const t = useT();
  const [tab, setTab] = useState('closings');
  const [filter, setFilter] = useState('all');
  const m = detail.member;
  const s = detail.summary;
  const fee = detail.joinFee;
  const pill = STATUS_PILL[m.status] ?? { cls: 'm-pill--muted', label: m.status };

  const rows = useMemo(() => {
    const list = [...detail.timeline].reverse(); // newest first on a phone
    if (filter === 'pending') return list.filter((r) => r.remaining > 0);
    if (filter === 'paid') return list.filter((r) => r.status === 'paid');
    if (filter === 'late') return list.filter((r) => r.timing === 'late');
    if (filter === 'onTime') return list.filter((r) => r.timing === 'onTime');
    return list;
  }, [detail.timeline, filter]);

  const live = detail.receipts.filter((r) => r.status !== 'cancelled');

  return (
    <>
      {/* ── who ───────────────────────────────────────────────────────── */}
      <div className="m-card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar src={m.photoURL} name={m.displayName} size={58} />
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{m.displayName}</div>
            <div className="m-muted">
              {t('रजि.')} <b style={{ color: 'var(--ink)' }}>{m.registrationNumber}</b>
              {m.fatherName ? ` · ${m.fatherName}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span className={`m-pill ${pill.cls}`}>{t(pill.label)}</span>
              {m.programName ? <span className="m-pill m-pill--brand">{m.programName}</span> : null}
              {m.ageGroupRange ? <span className="m-pill m-pill--muted">{t('आयु')} {m.ageGroupRange}</span> : null}
            </div>
          </div>
          {m.phone ? (
            <a href={`tel:${m.phone}`} aria-label={t('कॉल करें')}>
              <Button shape="circle" size="large" icon={<PhoneOutlined />} />
            </a>
          ) : null}
        </div>
      </div>

      {/* ── the numbers people ask for ─────────────────────────────────── */}
      <div className="m-hero">
        <div className="m-hero__label">{t('कुल बकाया')}</div>
        <div className="m-hero__value">{inr(s.pendingAmount + (fee.due || 0))}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {t('{n} क्लोजिंग बाकी', { n: s.pendingCount })}
          {fee.due > 0 ? ` + ${t('नामांकन शुल्क')} ${inr(fee.due)}` : ''}
        </div>
        <div className="m-hero__row">
          <div className="m-hero__chip">{t('कुल जमा')}<b>{inr(s.paidAmount + (fee.paid || 0))}</b></div>
          <div className="m-hero__chip">{t('पात्र क्लोजिंग')}<b>{num(s.eligibleCount)}</b></div>
          <div className="m-hero__chip">{t('प्रति क्लोजिंग')}<b>{inr(m.payAmount)}</b></div>
        </div>
      </div>

      <div className="m-grid2">
        <Stat label={t('क्लोजिंग जमा')} value={inr(s.paidAmount)} hint={t('{n} क्लोजिंग', { n: s.paidCount })} tone="paid"
          onClick={() => { setTab('closings'); setFilter('paid'); }} />
        <Stat label={t('क्लोजिंग बकाया')} value={inr(s.pendingAmount)} hint={t('{n} क्लोजिंग', { n: s.pendingCount })} tone={s.pendingAmount ? 'due' : undefined}
          onClick={() => { setTab('closings'); setFilter('pending'); }} />
        <Stat label={t('समय पर जमा')} value={inr(s.onTimeAmount)} hint={t('{n} क्लोजिंग', { n: s.onTimeCount })} tone="paid"
          onClick={() => { setTab('closings'); setFilter('onTime'); }} />
        <Stat label={t('देर से जमा')} value={inr(s.lateAmount)} hint={t('{n} क्लोजिंग', { n: s.lateCount })} tone={s.lateCount ? 'warn' : undefined}
          onClick={() => { setTab('closings'); setFilter('late'); }} />
      </div>

      <div className="m-card">
        <div className="m-card__head">
          <div className="m-card__title">{t('नामांकन शुल्क')}</div>
          <span className={`m-pill ${fee.done ? 'm-pill--paid' : 'm-pill--due'}`}>
            {fee.done ? t('पूरा जमा') : t('बाकी')}
          </span>
        </div>
        <div className="m-grid3">
          <div><div className="m-muted">{t('कुल')}</div><b>{inr(fee.total)}</b></div>
          <div><div className="m-muted">{t('जमा')}</div><b className="m-paid">{inr(fee.paid)}</b></div>
          <div><div className="m-muted">{t('बाकी')}</div><b className={fee.due ? 'm-due' : ''}>{inr(fee.due)}</b></div>
        </div>
        <div className="m-progress"><span style={{ width: `${pct(fee.paid, fee.total || 1)}%` }} /></div>
        {s.overdueCount > 0 ? (
          <div className="m-muted" style={{ marginTop: 8, color: 'var(--due)' }}>
            <ClockCircleOutlined /> {t('{n} क्लोजिंग की अंतिम तिथि निकल चुकी है — {amt}', { n: s.overdueCount, amt: inr(s.overdueAmount) })}
          </div>
        ) : null}
      </div>

      {/* ── downloads ─────────────────────────────────────────────────── */}
      <div className="m-actions">
        <button type="button" className="m-action" onClick={() => openPdf(urls.certificate())}>
          <SafetyCertificateOutlined />{t('प्रमाण पत्र')}
        </button>
        <button type="button" className="m-action" onClick={() => openPdf(urls.statement('all'))}>
          <FileTextOutlined />{t('पूरा खाता')}
        </button>
        <button type="button" className="m-action" onClick={() => openPdf(urls.statement('pending'))}>
          <FilePdfOutlined />{t('बकाया PDF')}
        </button>
        <button type="button" className="m-action" onClick={() => openPdf(urls.statement('paid'))}>
          <CheckCircleOutlined />{t('जमा PDF')}
        </button>
      </div>

      {/* ── lists ─────────────────────────────────────────────────────── */}
      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'closings', label: t('क्लोजिंग सूची'), count: detail.timeline.length },
          { value: 'receipts', label: t('भुगतान इतिहास'), count: live.length },
          { value: 'details', label: t('विवरण') },
        ]}
      />

      {tab === 'closings' && (
        <>
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('सभी'), count: detail.timeline.length },
              { value: 'pending', label: t('बकाया'), count: s.pendingCount },
              { value: 'paid', label: t('जमा'), count: s.paidCount },
              { value: 'onTime', label: t('समय पर'), count: s.onTimeCount },
              { value: 'late', label: t('देर से'), count: s.lateCount },
            ]}
          />
          <div className="m-card m-card--flush">
            {rows.length === 0 ? <Empty>{t('इस सूची में कुछ नहीं')}</Empty> : rows.map((r) => (
              <div key={r.seq} className="m-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <div className="m-seq">{r.seq}</div>
                <div className="m-row__main">
                  <div className="m-row__title">{r.name}{r.regNo ? <span className="m-muted"> · {r.regNo}</span> : null}</div>
                  <div className="m-row__sub">{t('क्लोजिंग')} {dmy(r.dateMs)}{r.village ? ` · ${r.village}` : ''}</div>
                  <div className="m-row__sub">
                    {r.status === 'paid' && r.paidAtMs ? (
                      <>
                        {t('जमा')} {dmy(r.paidAtMs)}{r.receiptNo ? ` · ${r.receiptNo}` : ''}
                      </>
                    ) : r.status === 'paid' ? t('जमा (पुराना रिकॉर्ड)') : r.status === 'exempt' ? t('छूट') : (
                      <>{t('अंतिम तिथि')} {dmy(r.dueByMs)}</>
                    )}
                  </div>
                </div>
                <div className="m-row__side">
                  <b className={r.remaining > 0 ? 'm-due' : 'm-paid'}>{inr(r.remaining > 0 ? r.remaining : r.paid)}</b>
                  <TimingPill row={r} t={t} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'receipts' && (
        <div className="m-card m-card--flush">
          {detail.receipts.length === 0 ? <Empty>{t('अभी कोई रसीद नहीं')}</Empty> : detail.receipts.map((r) => (
            <button key={r.id} type="button" className="m-row" onClick={() => openPdf(urls.receipt(r))}>
              <div className="m-seq" style={{ fontSize: 18 }}><FilePdfOutlined /></div>
              <div className="m-row__main">
                <div className="m-row__title">{r.receiptNo}</div>
                <div className="m-row__sub">
                  {dmy(r.paidAtMs)} · {methodLabel(r.method, t)}
                  {r.itemCount ? ` · ${t('{n} क्लोजिंग', { n: r.itemCount })}` : ''}
                  {r.joinFeeAmount ? ` · ${t('शुल्क')} ${inr(r.joinFeeAmount)}` : ''}
                </div>
                {r.items.length ? (
                  <div className="m-row__sub">{r.items.map((i) => `#${i.seq} ${i.name}`).join(', ')}</div>
                ) : null}
              </div>
              <div className="m-row__side">
                <b className={r.status === 'cancelled' ? '' : 'm-paid'} style={r.status === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                  {inr(r.totalAmount)}
                </b>
                {r.status === 'cancelled' ? <span className="m-pill m-pill--due">{t('रद्द')}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'details' && (
        <div className="m-card">
          <dl className="m-kv" style={{ margin: 0 }}>
            <dt>{t('पिता / पति')}</dt><dd>{m.fatherName || '—'}</dd>
            {m.guardian ? <><dt>{t('संरक्षक')}</dt><dd>{m.guardian}{m.guardianRelation ? ` (${m.guardianRelation})` : ''}</dd></> : null}
            <dt>{t('मोबाइल')}</dt><dd>{m.phone || '—'}{m.phoneAlt ? `, ${m.phoneAlt}` : ''}</dd>
            {m.aadhaarNo ? <><dt>{t('आधार')}</dt><dd>{m.aadhaarNo}</dd></> : null}
            <dt>{t('जाति / गोत्र')}</dt><dd>{[m.jati, m.gotra].filter(Boolean).join(' / ') || '—'}</dd>
            <dt>{t('जन्म तिथि')}</dt><dd>{dmy(m.bobDateMs)}{m.age != null ? ` (${m.age})` : ''}</dd>
            <dt>{t('जुड़ने की तिथि')}</dt><dd>{dmy(m.joinDateMs)}</dd>
            {m.closingDateMs ? <><dt>{t('क्लोजिंग तिथि')}</dt><dd>{dmy(m.closingDateMs)}</dd></> : null}
            <dt>{t('पता')}</dt><dd>{[m.currentAddress, m.village, m.district, m.state, m.pinCode].filter(Boolean).join(', ') || '—'}</dd>
            <dt>{t('एजेंट')}</dt><dd>{m.agentName || t('कार्यालय')}{m.agentPhone ? ` · ${m.agentPhone}` : ''}</dd>
            <dt>{t('अंतिम भुगतान')}</dt><dd>{dmy(m.lastPaymentAt)}</dd>
          </dl>
          <div className="m-muted" style={{ marginTop: 12 }}>
            {t('समय पर = क्लोजिंग सूचना की अंतिम तिथि तक, या सूचना न हो तो क्लोजिंग के {n} दिन के भीतर जमा।', { n: detail.graceDays })}
          </div>
        </div>
      )}
    </>
  );
}

function TimingPill({ row, t }) {
  if (row.status === 'exempt') return <span className="m-pill m-pill--muted">{t('छूट')}</span>;
  if (row.status === 'partial') return <span className="m-pill m-pill--warn">{t('आंशिक')} {inr(row.paid)}</span>;
  if (row.status === 'pending') {
    return row.overdue
      ? <span className="m-pill m-pill--due">{t('{n} दिन देर', { n: row.overdueDays })}</span>
      : <span className="m-pill m-pill--warn">{t('बकाया')}</span>;
  }
  if (row.timing === 'late') return <span className="m-pill m-pill--warn">{t('देर से')} · {row.lateByDays}{t('दि')}</span>;
  if (row.timing === 'onTime') return <span className="m-pill m-pill--paid">{t('समय पर')}</span>;
  return <span className="m-pill m-pill--paid">{t('जमा')}</span>;
}

export function methodLabel(method, t) {
  return {
    cash: t('नकद'), upi: 'UPI', online: t('ऑनलाइन'), cheque: t('चेक'), bank: t('बैंक'),
  }[method] ?? (method || '—');
}
