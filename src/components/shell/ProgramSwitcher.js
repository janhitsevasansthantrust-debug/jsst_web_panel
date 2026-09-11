'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, Space, Typography, Tooltip } from 'antd';
import { ProjectOutlined } from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { useActiveProgramId,
  setActiveProgramId,
  getActiveProgramId,
} from '../../lib/activeProgram.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;

/**
 * The योजना switcher that sits in the header.
 *
 * Every program-scoped screen in the app reads whatever is chosen here, because
 * `lib/api.js` attaches it to every request. That is the whole point: before
 * this existed, each screen silently inherited the program baked into the
 * session cookie at user-creation time, so a member added to a newly created
 * योजना vanished from a list that was still reading the original one.
 */
export default function ProgramSwitcher({ compact = false }) {
  const t = useT();
  const queryClient = useQueryClient();
  const activeId = useActiveProgramId();

  const { data, isLoading } = useQuery({
    queryKey: keys.programs,
    queryFn: () => api.programs.list(),
    staleTime: 5 * 60 * 1000,
  });

  const programs = data?.programs ?? [];

  // First load, nothing remembered: adopt the program marked as active in the
  // database (`isSelected`), falling back to the first one.
  useEffect(() => {
    if (getActiveProgramId() || !programs.length) return;

    const preferred = programs.find((p) => p.isSelected) ?? programs[0];
    setActiveProgramId(preferred.id);
    queryClient.invalidateQueries();
  }, [programs, queryClient]);

  // A remembered program that has since been removed: fall back rather than
  // leaving every request pointing at something that no longer exists.
  useEffect(() => {
    if (!activeId || !programs.length) return;
    if (programs.some((p) => p.id === activeId)) return;

    setActiveProgramId((programs.find((p) => p.isSelected) ?? programs[0]).id);
    queryClient.clear();
  }, [activeId, programs, queryClient]);

  function handleChange(id) {
    setActiveProgramId(id);
    // Everything cached — members, closings, stats, agents, receipts — belongs
    // to the program it was fetched under. Dropping the lot is the only honest
    // option; showing one program's rows under another program's name is how a
    // payment gets posted against the wrong book.
    queryClient.clear();
  }

  if (!isLoading && !programs.length) {
    return (
      <Tooltip title={t('कोई योजना नहीं है — पहले एक योजना बनाएँ')}>
        <Link href="/yojna">
          <Text type="danger">
            <ProjectOutlined /> {t('योजना बनाएँ')}
          </Text>
        </Link>
      </Tooltip>
    );
  }

  return (
    <Space size={6}>
      {!compact && <Text type="secondary">{t('योजना:')}</Text>}
      <Select
        value={activeId ?? undefined}
        onChange={handleChange}
        loading={isLoading}
        placeholder={t('योजना चुनें')}
        style={{ minWidth: compact ? 150 : 230 }}
        popupMatchSelectWidth={false}
        options={programs.map((p) => ({
          value: p.id,
          label: p.hiname || p.name,
        }))}
        optionRender={(opt) => {
          const program = programs.find((p) => p.id === opt.value);
          return (
            <div>
              <div>{program?.hiname || program?.name}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('{n} सदस्य', { n: (program?.stats?.members ?? 0).toLocaleString('en-IN') })}
                {program?.isSelected ? t(' · मुख्य') : ''}
              </Text>
            </div>
          );
        }}
      />
    </Space>
  );
}
