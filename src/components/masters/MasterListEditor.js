'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, Input, Select, Space, Switch, Typography, App, Alert, Popconfirm,
  Tooltip, Tag, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, ArrowUpOutlined,
  ArrowDownOutlined, SearchOutlined,
} from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { MASTER_TYPES } from '../../config/constants.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * Edit one reference list.
 *
 * The whole list is held in local state and saved in one go. That matches how
 * the work actually happens — you add three districts, fix a spelling and
 * reorder two rows, then save once — and it means reordering is a local
 * operation rather than a round trip per row.
 *
 * The stored `value` of an existing row is never editable. It is what sits on
 * every member who picked that entry; changing it would not rename anything,
 * it would orphan them. The label is what people see and it can be corrected
 * freely.
 */
export default function MasterListEditor({ type }) {
  const def = MASTER_TYPES[type];
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [parentFilter, setParentFilter] = useState();

  const all = useQuery({ queryKey: keys.masters, queryFn: () => api.masters.all() });

  const parentItems = def?.parent ? (all.data?.masters?.[def.parent] ?? []) : null;

  useEffect(() => {
    const items = all.data?.masters?.[type];
    if (!items) return;
    setRows(items.map((i) => ({ ...i, key: i.value })));
    setDirty(false);
  }, [all.data, type]);

  const save = useMutation({
    mutationFn: () =>
      api.masters.save(
        type,
        rows.map(({ key, ...r }) => r),
      ),
    onSuccess: (res) => {
      message.success(t('{label} सहेज दी गई', { label: def.label }));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: keys.masters });

      if (res.orphans?.length) {
        message.warning(
          t('{n} प्रविष्टियाँ अब किसी मौजूद {list} से नहीं जुड़ीं', {
            n: res.orphans.length,
            list: MASTER_TYPES[def.parent]?.label ?? t('ऊपरी सूची'),
          }),
          6,
        );
      }
    },
    onError: (err) => message.error(err.message),
  });

  function patch(key, changes) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...changes } : row)));
    setDirty(true);
  }

  function addRow() {
    // A brand-new row has no `value` — the server generates one on save, so
    // the machine value and the label are decided in the same place.
    const key = `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setRows((r) => [
      ...r,
      { key, label: '', labelEn: '', parent: parentFilter ?? null, active: true },
    ]);
    setDirty(true);
  }

  function move(key, by) {
    setRows((r) => {
      const at = r.findIndex((row) => row.key === key);
      const to = at + by;
      if (at < 0 || to < 0 || to >= r.length) return r;
      const next = [...r];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
    setDirty(true);
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (parentFilter && r.parent !== parentFilter) return false;
      if (!q) return true;
      return (
        String(r.label).toLowerCase().includes(q) ||
        String(r.labelEn ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, parentFilter]);

  const parentLabel = (value) =>
    parentItems?.find((p) => p.value === value)?.label ?? value ?? '—';

  return (
    <>
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t(`यह सूची फ़ॉर्म के dropdown में दिखती है। पहले ये कोड में लिखी थीं — अब
डेटा हैं, तो नया ज़िला जोड़ने के लिए deploy नहीं करना पड़ता।`)}
      </Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('इस सूची में खोजें')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />

        {parentItems && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('{label} चुनें', { label: MASTER_TYPES[def.parent].label })}
            style={{ width: 220 }}
            value={parentFilter}
            onChange={setParentFilter}
            options={parentItems.map((p) => ({ value: p.value, label: p.label }))}
          />
        )}

        <Button icon={<PlusOutlined />} onClick={addRow}>
          {t('नई पंक्ति')}
        </Button>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('सहेजें')}
        </Button>

        {dirty && <Tag color="orange">{t('सहेजा नहीं गया')}</Tag>}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('{n} प्रविष्टियाँ', { n: rows.length })}
          {visible.length !== rows.length ? t(' · {n} दिख रही हैं', { n: visible.length }) : ''}
        </Text>
      </Space>

      {def?.parent && !parentItems?.length && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('पहले {label} की सूची भरें', { label: MASTER_TYPES[def.parent].label })}
          description={t('हर प्रविष्टि किसी न किसी ऊपरी सूची से जुड़ी होनी चाहिए।')}
        />
      )}

      <Table
        rowKey="key"
        size="small"
        dataSource={visible}
        pagination={{ pageSize: 50, size: 'small', showSizeChanger: false }}
        loading={all.isLoading}
        locale={{ emptyText: <Empty description={t('कोई प्रविष्टि नहीं')} /> }}
        columns={[
          {
            title: t('नाम (हिन्दी)'),
            dataIndex: 'label',
            render: (v, row) => (
              <Input
                value={v}
                placeholder={t('नाम')}
                onChange={(e) => patch(row.key, { label: e.target.value })}
              />
            ),
          },
          {
            title: 'Name (English)',
            dataIndex: 'labelEn',
            width: 200,
            render: (v, row) => (
              <Input
                value={v}
                placeholder="optional"
                onChange={(e) => patch(row.key, { labelEn: e.target.value })}
              />
            ),
          },
          ...(parentItems
            ? [{
                title: MASTER_TYPES[def.parent].label,
                dataIndex: 'parent',
                width: 190,
                render: (v, row) => (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%' }}
                    value={v ?? undefined}
                    placeholder={t('चुनें')}
                    onChange={(x) => patch(row.key, { parent: x })}
                    options={parentItems.map((p) => ({ value: p.value, label: p.label }))}
                  />
                ),
              }]
            : []),
          {
            title: t('चालू'),
            dataIndex: 'active',
            width: 80,
            align: 'center',
            render: (v, row) => (
              <Tooltip title={t('बंद करने पर नए फ़ॉर्म में नहीं दिखेगी — पुराने रिकॉर्ड वैसे ही रहेंगे')}>
                <Switch
                  size="small"
                  checked={v !== false}
                  onChange={(x) => patch(row.key, { active: x })}
                />
              </Tooltip>
            ),
          },
          {
            title: '',
            width: 110,
            render: (_, row) => (
              <Space size={2}>
                <Button size="small" type="text" icon={<ArrowUpOutlined />}
                  onClick={() => move(row.key, -1)} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />}
                  onClick={() => move(row.key, 1)} />
                <Popconfirm
                  title={t('हटाएँ?')}
                  description={t('जिन रिकॉर्ड में यह पहले से चुनी है, उन पर असर नहीं पड़ेगा।')}
                  okText={t('हटाएँ')}
                  cancelText={t('रद्द')}
                  onConfirm={() => {
                    setRows((r) => r.filter((x) => x.key !== row.key));
                    setDirty(true);
                  }}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
