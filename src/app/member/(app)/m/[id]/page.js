'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton } from 'antd';

import MemberShell from '../../../../../components/member/MemberShell.js';
import MemberAccount from '../../../../../components/mobile/MemberAccount.js';
import { api, keys } from '../../../../../lib/api.js';
import { useT } from '../../../../../i18n/index.js';

/** One family member's whole account: closings, payments, on time / late, PDFs. */
export default function MemberAccountPage({ params }) {
  const { id } = use(params);
  const t = useT();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.portalMember(id),
    queryFn: () => api.portal.member(id),
    staleTime: 30 * 1000,
  });

  return (
    <MemberShell
      back="/member"
      title={data?.member?.displayName ?? t('सदस्य')}
      subtitle={data ? `${t('रजि.')} ${data.member.registrationNumber} · ${data.member.programName}` : ''}
    >
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading ? <Skeleton active avatar paragraph={{ rows: 10 }} /> : null}
      {data ? (
        <MemberAccount
          detail={data}
          urls={{
            certificate: () => api.portal.pdfUrl(id, 'certificate'),
            statement: (mode) => api.portal.pdfUrl(id, 'statement', mode),
            receipt: (r) => api.portal.receiptUrl(r.id, id),
          }}
        />
      ) : null}
    </MemberShell>
  );
}
