'use client';

import {
  Drawer, Select, DatePicker, InputNumber, Radio, Switch, Space, Typography,
  Button, Divider, Row, Col, Tag, Badge,
} from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import {
  EMPTY_FILTERS, GENDER_LABEL, facetOptions,
} from '../../lib/memberFilters.js';
import { statusLabel } from '../../lib/memberStatus.js';
import { useT } from '../../i18n/index.js';

const { Text } = Typography;
const { RangePicker } = DatePicker;

/**
 * Every way to narrow the members list, in one panel.
 *
 * Two decisions worth knowing about:
 *
 * 1. Changes apply immediately — there is no "Apply" button. The drawer sits
 *    beside the grid, not on top of it, and the footer shows the live result
 *    count, so you watch the number move as you pick. A draft-then-apply flow
 *    would hide exactly the feedback that tells you whether the filter was
 *    worth setting.
 *
 * 2. Every option carries its member count, taken from the same index load
 *    that produced the rows. That is what makes this usable at 5,000 members:
 *    "मालपुरा (412)" tells you the answer before you ask, and a value nobody
 *    matches is never offered in the first place.
 */
export default function MemberFilterDrawer({
  open, onClose, filters, onChange, facets = {}, resultCount, loading,
}) {
  const t = useT();
  const set = (patch) => onChange({ ...filters, ...patch });

  const presets = [
    { label: t('इस महीने'), from: dayjs().startOf('month'), to: dayjs().endOf('day') },
    { label: t('पिछले 3 महीने'), from: dayjs().subtract(3, 'month'), to: dayjs().endOf('day') },
    { label: t('इस साल'), from: dayjs().startOf('year'), to: dayjs().endOf('day') },
  ];

  return (
    <Drawer
      title={t('फ़िल्टर')}
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      maskClosable
      extra={
        <Button
          size="small"
          icon={<ClearOutlined />}
          onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q })}
        >
          {t('सब हटाएँ')}
        </Button>
      }
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text type="secondary">
            {loading
              ? t('गिना जा रहा है…')
              : t('{n} सदस्य मिले', { n: Number(resultCount ?? 0).toLocaleString('en-IN') })}
          </Text>
          <Button type="primary" onClick={onClose}>{t('बंद करें')}</Button>
        </div>
      }
    >
      <Section label={t('स्थिति')}>
        <Picker
          value={filters.status}
          onChange={(v) => set({ status: v })}
          options={facetOptions(facets.statuses, (v) => t(statusLabel(v)))}
          placeholder={t('कोई भी स्थिति')}
        />
      </Section>

      <Section label={t('लिंग')}>
        <Picker
          value={filters.gender}
          onChange={(v) => set({ gender: v })}
          options={facetOptions(facets.genders, (g) => t(GENDER_LABEL[String(g).toLowerCase()] ?? g))}
          placeholder={t('कोई भी')}
        />
      </Section>

      <Section label={t('आयु समूह')}>
        <Picker
          value={filters.ageBand}
          onChange={(v) => set({ ageBand: v })}
          options={facetOptions(facets.ageBands)}
          placeholder={t('कोई भी आयु समूह')}
        />
      </Section>

      <Section label={t('उम्र')} hint={t('योजना के आयु समूह से अलग — असली उम्र')}>
        <Row gutter={8}>
          <Col span={12}>
            <InputNumber
              min={0} max={120} placeholder={t('से')} style={{ width: '100%' }}
              value={filters.ageMin}
              onChange={(v) => set({ ageMin: v ?? undefined })}
            />
          </Col>
          <Col span={12}>
            <InputNumber
              min={0} max={120} placeholder={t('तक')} style={{ width: '100%' }}
              value={filters.ageMax}
              onChange={(v) => set({ ageMax: v ?? undefined })}
            />
          </Col>
        </Row>
      </Section>

      <Divider style={{ margin: '4px 0 16px' }} />

      <Section label={t('गाँव')}>
        <Picker
          value={filters.village}
          onChange={(v) => set({ village: v })}
          options={facetOptions(facets.villages)}
          placeholder={t('कोई भी गाँव')}
        />
      </Section>

      <Section label={t('ज़िला')}>
        <Picker
          value={filters.district}
          onChange={(v) => set({ district: v })}
          options={facetOptions(facets.districts)}
          placeholder={t('कोई भी ज़िला')}
        />
      </Section>

      <Section label={t('एजेंट')}>
        <Picker
          value={filters.agentId}
          onChange={(v) => set({ agentId: v })}
          options={facetOptions(facets.agents)}
          placeholder={t('कोई भी एजेंट')}
        />
      </Section>

      <Divider style={{ margin: '4px 0 16px' }} />

      <Section label={t('जुड़ने की तिथि')}>
        <RangePicker
          style={{ width: '100%' }}
          format="DD-MM-YYYY"
          value={[
            filters.joinFrom ? dayjs(filters.joinFrom) : null,
            filters.joinTo ? dayjs(filters.joinTo) : null,
          ]}
          onChange={(range) =>
            set({
              joinFrom: range?.[0]?.startOf('day').valueOf(),
              joinTo: range?.[1]?.endOf('day').valueOf(),
            })
          }
        />
        <Space size={4} wrap style={{ marginTop: 8 }}>
          {presets.map((p) => (
            <Tag.CheckableTag
              key={p.label}
              checked={filters.joinFrom === p.from.startOf('day').valueOf()}
              onChange={() =>
                set({
                  joinFrom: p.from.startOf('day').valueOf(),
                  joinTo: p.to.valueOf(),
                })
              }
            >
              {p.label}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Section>

      <Section label={t('बकाया')}>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          size="small"
          value={filters.hasDue ?? 'any'}
          onChange={(e) =>
            set({ hasDue: e.target.value === 'any' ? undefined : e.target.value })
          }
          options={[
            { label: t('कोई भी'), value: 'any' },
            { label: t('बकाया है'), value: true },
            { label: t('कोई बकाया नहीं'), value: false },
          ]}
        />
      </Section>

      <Section label={t('जॉइनिंग फीस')}>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          size="small"
          value={filters.feeDone ?? 'any'}
          onChange={(e) =>
            set({ feeDone: e.target.value === 'any' ? undefined : e.target.value })
          }
          options={[
            { label: t('कोई भी'), value: 'any' },
            { label: t('जमा'), value: true },
            { label: t('बाकी'), value: false },
          ]}
        />
      </Section>

      <Divider style={{ margin: '4px 0 16px' }} />

      <Section
        label={t('सभी योजनाएँ')}
        hint={t('बंद रहने पर सिर्फ़ ऊपर चुनी हुई योजना के सदस्य दिखते हैं')}
      >
        <Switch
          checked={filters.allPrograms}
          onChange={(v) => set({ allPrograms: v })}
        />
      </Section>
    </Drawer>
  );
}

/* ── building blocks ─────────────────────────────────────────────────────── */

function Section({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 6 }}>
        <Text strong style={{ fontSize: 13 }}>{label}</Text>
        {hint && (
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>{hint}</Text>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * A multi-select whose options show how many members each one would match.
 *
 * The count sits on the right in grey rather than inside the label, so the
 * values still line up and stay scannable when there are forty villages.
 */
function Picker({ value, onChange, options, placeholder }) {
  return (
    <Select
      mode="multiple"
      allowClear
      showSearch
      maxTagCount="responsive"
      placeholder={placeholder}
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
      optionFilterProp="label"
      options={options}
      optionRender={(opt) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{opt.label}</span>
          <Badge
            count={opt.data.count}
            overflowCount={99999}
            style={{ background: '#f0f0f0', color: '#666', boxShadow: 'none' }}
          />
        </div>
      )}
    />
  );
}
