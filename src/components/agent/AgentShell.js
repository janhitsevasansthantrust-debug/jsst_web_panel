'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HomeOutlined, TeamOutlined, HeartOutlined, UserAddOutlined, PercentageOutlined, DesktopOutlined,
} from '@ant-design/icons';

import MobileShell, { Chips } from '../mobile/MobileShell.js';
import { api, keys } from '../../lib/api.js';
import { useActiveProgramId, setActiveProgramId, getActiveProgramId } from '../../lib/activeProgram.js';
import { useT } from '../../i18n/index.js';

/**
 * The agent app's overview, shared by every agent screen: who the agent is,
 * which योजना is open, and the counts behind the tab badges.
 *
 * The first load adopts the योजना the server answered for (the agent's own,
 * from their login) when the phone has not picked one yet.
 */
export function useAgentOverview() {
  const programId = useActiveProgramId();
  const query = useQuery({
    queryKey: keys.agentOverview(programId),
    queryFn: () => api.agentApp.overview(),
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (query.data?.programId && !getActiveProgramId()) setActiveProgramId(query.data.programId);
  }, [query.data?.programId]);
  return query;
}

export default function AgentShell({ children, ...props }) {
  const t = useT();
  const { data } = useAgentOverview();
  const rejected = data?.requests?.rejected ?? 0;

  return (
    <MobileShell
      loginPath="/agent/login"
      subtitle={props.subtitle ?? (props.title ? data?.agent?.displayName : t('एजेंट ऐप'))}
      title={props.title ?? data?.agent?.displayName}
      extraMenu={[{
        key: 'panel',
        icon: <DesktopOutlined />,
        label: <a href="/dashboard">{t('पूरा पैनल (कंप्यूटर)')}</a>,
      }]}
      tabs={[
        { href: '/agent', icon: <HomeOutlined />, label: 'होम' },
        { href: '/agent/members', icon: <TeamOutlined />, label: 'सदस्य' },
        { href: '/agent/closings', icon: <HeartOutlined />, label: 'क्लोजिंग' },
        { href: '/agent/requests', icon: <UserAddOutlined />, label: 'अनुरोध', badge: rejected },
        { href: '/agent/commission', icon: <PercentageOutlined />, label: 'कमीशन' },
      ]}
      {...props}
    >
      {children}
    </MobileShell>
  );
}

/** योजना chips, shown only when the agent has more than one to choose from. */
export function ProgramChips() {
  const t = useT();
  const queryClient = useQueryClient();
  const activeId = useActiveProgramId();
  const { data } = useAgentOverview();
  const programs = data?.programs ?? [];
  if (programs.length < 2) return null;
  const current = activeId ?? data?.programId;

  return (
    <Chips
      value={current}
      onChange={(id) => {
        if (id === current) return;
        setActiveProgramId(id);
        // Everything cached belongs to the योजना it was read under.
        queryClient.removeQueries({ queryKey: ['agent-app'] });
        queryClient.removeQueries({ queryKey: ['members'] });
      }}
      options={programs.map((p) => ({ value: p.id, label: p.hiname || p.name, count: p.members }))}
      aria-label={t('योजना')}
    />
  );
}
