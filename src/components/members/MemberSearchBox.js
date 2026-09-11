'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AutoComplete, Input, Typography, Tag, Space, Avatar, Tooltip } from 'antd';
import { SearchOutlined, UserOutlined, ThunderboltOutlined } from '@ant-design/icons';

import { api } from '../../lib/api.js';
import { useMemberSearch } from '../../lib/useMemberSearch.js';
import { statusLabel, statusColor } from '../../lib/memberStatus.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;

/**
 * The search box that finds a member as you type.
 *
 * Local when it can be: the searchable list is downloaded once and matched in
 * the browser, so results appear on the keystroke rather than a round trip
 * later. For a trust too large for that, it falls back to the API — the same
 * matching code runs there, so the answers are identical either way and only
 * the timing differs.
 *
 * `onPick` gets the member. `onTermChange` gets the raw text, for a caller
 * that also wants to filter a grid by it.
 */
export default function MemberSearchBox({
  value,
  onTermChange,
  onPick,
  placeholder,
  width = 340,
  size = 'large',
  allPrograms = false,
  autoFocus = false,
}) {
  const [term, setTerm] = useState(value ?? '');
  const t = useT();
  const index = useMemberSearch({ allPrograms });

  const text = value ?? term;

  // Local search runs on every render; there is nothing to debounce because
  // there is nothing to wait for.
  const localHits = useMemo(
    () => (text.trim().length >= 1 ? index.search(text) : []),
    [text, index],
  );

  // Only used when the trust is too large to search locally.
  const remote = useQuery({
    queryKey: ['members', 'search', text, allPrograms],
    queryFn: ({ signal }) =>
      api.members.search(text, { allPrograms: allPrograms || undefined }, signal),
    enabled: !index.local && index.ready && text.trim().length >= 2,
    staleTime: 30 * 1000,
  });

  const hits = index.local
    ? (localHits ?? [])
    : (remote.data?.members ?? []).map((m) => ({
        id: m.id,
        reg: m.registrationNumber,
        name: m.displayName,
        father: m.fatherName,
        phone: m.phone,
        village: m.village,
        status: m.status,
      }));

  const options = hits.map((m) => ({
    value: m.id,
    label: <Row member={m} />,
    member: m,
  }));

  function handleChange(next) {
    setTerm(next);
    onTermChange?.(next);
  }

  return (
    <AutoComplete
      value={text}
      options={options}
      onChange={handleChange}
      onSelect={(id, option) => {
        onPick?.(option.member);
        // The picker is for jumping to someone; leaving their name in the box
        // afterwards would silently keep the list filtered to one person.
        if (onPick) handleChange('');
      }}
      style={{ width }}
      popupMatchSelectWidth={Math.max(width, 420)}
      notFoundContent={
        text.trim() ? <Text type="secondary">{t('कोई सदस्य नहीं मिला')}</Text> : null
      }
    >
      <Input
        allowClear
        size={size}
        autoFocus={autoFocus}
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        suffix={
          index.local && index.count > 0 ? (
            <Tooltip title={t('{n} सदस्य इसी डिवाइस पर — बिना इंटरनेट भी खोज चलेगी', { n: index.count.toLocaleString('en-IN') })}>
              <ThunderboltOutlined style={{ color: 'var(--paid)' }} />
            </Tooltip>
          ) : null
        }
        placeholder={placeholder ?? t('नाम, रजि. नं., मोबाइल, पिता, गाँव…')}
      />
    </AutoComplete>
  );
}

/** One result: enough to be sure it is the right person, and no more. */
function Row({ member }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
      <Avatar size={28} icon={<UserOutlined />} />
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.35 }}>
        <Space size={6}>
          <Text strong>{member.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>#{member.reg}</Text>
        </Space>
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {[member.father, member.village, member.phone].filter(Boolean).join(' · ')}
          </Text>
        </div>
      </div>
      {member.status && member.status !== 'accepted' && (
        <Tag color={statusColor(member.status)} style={{ marginInlineEnd: 0 }}>
          {statusLabel(member.status)}
        </Tag>
      )}
    </div>
  );
}
