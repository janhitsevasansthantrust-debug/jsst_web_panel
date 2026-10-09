'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton } from 'antd';

import AgentShell from '../../../../../components/agent/AgentShell.js';
import MemberAccount from '../../../../../components/mobile/MemberAccount.js';
import { api, apiUrl, keys } from '../../../../../lib/api.js';
import { useT } from '../../../../../i18n/index.js';

/** One of the agent's members: dues, payments, joining fee, downloads. */
export default function AgentMemberPage({ params }) {
  const { id } = use(params);
  const t = useT();
  const { data, isLoading, error } = useQuery({
    queryKey: keys.agentMember(id),
    queryFn: () => api.agentApp.member(id),
    staleTime: 30 * 1000,
  });
  const pid = data?.member?.programId;

  return (
    <AgentShell back="/agent/members" title={data?.member?.displayName ?? t('सदस्य')} subtitle={data ? `${t('रजि.')} ${data.member.registrationNumber}` : ''}>
      {error ? <Alert type="error" showIcon message={error.message} /> : null}
      {isLoading ? <Skeleton active avatar paragraph={{ rows: 10 }} /> : null}
      {data ? (
        <MemberAccount
          detail={data}
          urls={{
            certificate: () => api.agentApp.certificateUrl(id, pid),
            statement: (mode) => api.agentApp.memberPdfUrl(id, mode, pid),
            receipt: (r) => apiUrl(`/payments/${r.id}/receipt?programId=${encodeURIComponent(pid)}`),
          }}
        />
      ) : null}
    </AgentShell>
  );
}
