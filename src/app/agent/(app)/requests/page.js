'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Skeleton } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons';

import AgentShell from '../../../../components/agent/AgentShell.js';
import { Avatar, Chips, Empty } from '../../../../components/mobile/MobileShell.js';
import { inr, dmy, REQUEST_PILL } from '../../../../components/mobile/format.js';
import { api, keys } from '../../../../lib/api.js';
import { useT } from '../../../../i18n/index.js';


/** The agent's "add member" requests and what the office decided. */
export default function AgentRequestsPage() {
  return <Suspense><Requests /></Suspense>;
}

function Requests() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(params.get('s') || 'all');
  const [open, setOpen] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: keys.memberRequests({ mine: true }),
    queryFn: () => api.memberRequests.list(),
    staleTime: 30 * 1000,
  });
  const all = data?.requests ?? [];
  const rows = status === 'all' ? all : all.filter((r) => r.status === status);

  const withdraw = useMutation({
    mutationFn: (id) => api.memberRequests.remove(id),
    onSuccess: () => {
      message.success(t('अनुरोध हटा दिया गया'));
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: ['member-requests'] });
      queryClient.invalidateQueries({ queryKey: ['agent-app'] });
    },
    onError: (e) => message.error(e.message),
  });

  return (
    <AgentShell title={t('सदस्य अनुरोध')}>
      <div className="m-muted" style={{ background: 'var(--accent-wash)', borderRadius: 10, padding: '8px 10px' }}>
        {t('नया सदस्य जोड़ने का अनुरोध भेजें — कार्यालय जाँच कर स्वीकार करेगा, तब रजिस्ट्रेशन नंबर मिलेगा।')}
      </div>
      <Chips
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: t('सभी'), count: all.length },
          { value: 'pending', label: t('लंबित'), count: data?.counts?.pending },
          { value: 'approved', label: t('स्वीकार हुए'), count: data?.counts?.approved },
          { value: 'rejected', label: t('अस्वीकृत'), count: data?.counts?.rejected },
        ]}
      />
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      <div className="m-card m-card--flush">
        {isLoading ? <div style={{ padding: 14 }}><Skeleton active avatar /></div> : null}
        {!isLoading && !rows.length ? <Empty>{t('कोई अनुरोध नहीं')}</Empty> : null}
        {rows.map((r) => {
          const pill = REQUEST_PILL[r.status] ?? { cls: 'm-pill--muted', label: r.status };
          return (
            <button key={r.id} type="button" className="m-row" onClick={() => setOpen(r)}>
              <Avatar src={r.photoURL} name={r.displayName} />
              <div className="m-row__main">
                <div className="m-row__title">{r.displayName}</div>
                <div className="m-row__sub">{r.fatherName || '—'} · {r.village || ''} · {r.programName}</div>
                <div className="m-row__sub">
                  {t('भेजा')} {dmy(r.createdAtMs)}
                  {r.status === 'approved' && r.registrationNumber ? ` · ${t('रजि.')} ${r.registrationNumber}` : ''}
                </div>
                {r.status === 'rejected' && r.rejectReason ? (
                  <div className="m-row__sub" style={{ color: 'var(--due)', whiteSpace: 'normal' }}>{t('कारण')}: {r.rejectReason}</div>
                ) : null}
              </div>
              <div className="m-row__side"><span className={`m-pill ${pill.cls}`}>{t(pill.label)}</span></div>
            </button>
          );
        })}
      </div>

      <Link href="/agent/requests/new" className="m-fab">
        <Button type="primary" shape="round" size="large" icon={<PlusOutlined />}>{t('नया सदस्य')}</Button>
      </Link>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        placement="bottom"
        height="85%"
        title={open?.displayName}
        styles={{ body: { padding: 14 } }}
      >
        {open ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar src={open.photoURL} name={open.displayName} size={56} />
              <div>
                <span className={`m-pill ${(REQUEST_PILL[open.status] ?? {}).cls ?? 'm-pill--muted'}`}>{t((REQUEST_PILL[open.status] ?? {}).label ?? open.status)}</span>
                <div className="m-muted">{t('भेजा')} {dmy(open.createdAtMs)}{open.reviewedAtMs ? ` · ${t('निर्णय')} ${dmy(open.reviewedAtMs)}` : ''}</div>
              </div>
            </div>
            {open.status === 'rejected' ? (
              <Alert type="error" showIcon message={t('अस्वीकार का कारण')} description={open.rejectReason || '—'} />
            ) : null}
            {open.status === 'approved' ? (
              <Alert type="success" showIcon message={t('सदस्य बन गया — रजि. नंबर {n}', { n: open.registrationNumber })} />
            ) : null}
            <dl className="m-kv" style={{ margin: 0 }}>
              <dt>{t('योजना')}</dt><dd>{open.programName}</dd>
              <dt>{t('पिता / पति')}</dt><dd>{open.fatherName || '—'}</dd>
              <dt>{t('मोबाइल')}</dt><dd>{open.phone}{open.phoneAlt ? `, ${open.phoneAlt}` : ''}</dd>
              <dt>{t('जन्म तिथि')}</dt><dd>{dmy(open.bobDateMs)}{open.age != null ? ` (${open.age})` : ''}</dd>
              <dt>{t('जुड़ने की तिथि')}</dt><dd>{dmy(open.joinDateMs)}</dd>
              <dt>{t('आयु समूह')}</dt><dd>{open.ageGroupRange || '—'}</dd>
              <dt>{t('प्रति क्लोजिंग')}</dt><dd>{inr(open.payAmount)}</dd>
              <dt>{t('नामांकन शुल्क')}</dt><dd>{inr(open.joinFees)} · {t('लिया')} {inr(open.joinFeesCollected)}</dd>
              <dt>{t('पता')}</dt><dd>{[open.village, open.district, open.state].filter(Boolean).join(', ') || '—'}</dd>
              {open.note ? <><dt>{t('नोट')}</dt><dd>{open.note}</dd></> : null}
            </dl>
            {open.status === 'approved' && open.memberId ? (
              <Button type="primary" size="large" icon={<UserOutlined />} onClick={() => router.push(`/agent/members/${open.memberId}`)}>
                {t('सदस्य खोलें')}
              </Button>
            ) : null}
            {['pending', 'rejected'].includes(open.status) ? (
              <div className="m-grid2">
                <Button size="large" icon={<EditOutlined />} onClick={() => router.push(`/agent/requests/new?from=${open.id}`)}>
                  {open.status === 'rejected' ? t('सुधार कर दोबारा भेजें') : t('बदलें')}
                </Button>
                <Button
                  size="large"
                  danger
                  icon={<DeleteOutlined />}
                  loading={withdraw.isPending}
                  onClick={() => modal.confirm({
                    title: t('यह अनुरोध हटाएँ?'),
                    okText: t('हटाएँ'),
                    cancelText: t('रद्द करें'),
                    okButtonProps: { danger: true },
                    onOk: () => withdraw.mutateAsync(open.id),
                  })}
                >
                  {t('हटाएँ')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </AgentShell>
  );
}
