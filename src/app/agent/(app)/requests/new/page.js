'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, DatePicker, Form, Input, InputNumber, Select, Skeleton,
} from 'antd';
import { SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import AgentShell, { useAgentOverview } from '../../../../../components/agent/AgentShell.js';
import PhotoUpload from '../../../../../components/members/PhotoUpload.js';
import { inr } from '../../../../../components/mobile/format.js';
import { api, keys } from '../../../../../lib/api.js';
import { useActiveProgramId } from '../../../../../lib/activeProgram.js';
import { matchAgeGroup } from '../../../../../lib/ageGroup.js';
import { useMasters } from '../../../../../lib/useMasters.js';
import { useT } from '../../../../../i18n/index.js';

/**
 * The agent's "add a member" form — a request, not an enrolment.
 *
 * Mirrors the office member form, cut to what can be filled standing in a
 * courtyard: the योजना first (it supplies the rate card), then the person,
 * contact, address, photo and ID. The rate is previewed live from the date of
 * birth exactly as the office will compute it, so the family hears the right
 * figure; the server computes it again on approval and that is the one stored.
 *
 * `?from=<id>` opens an earlier request to correct and send again.
 */
export default function NewRequestPage() {
  return <Suspense><NewRequest /></Suspense>;
}

const DATE_FORMAT = 'DD-MM-YYYY';

function NewRequest() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const fromId = params.get('from');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const masters = useMasters();
  const activeId = useActiveProgramId();
  const overview = useAgentOverview();
  const [files, setFiles] = useState({});

  const programs = overview.data?.programs ?? [];
  const programId = Form.useWatch('programId', form);
  const bobDate = Form.useWatch('bobDate', form);
  const joinDate = Form.useWatch('joinDate', form);
  const state = Form.useWatch('state', form);

  const rules = useQuery({
    queryKey: ['program-rules', programId],
    queryFn: () => api.programs.rules(programId),
    enabled: Boolean(programId),
    staleTime: 5 * 60 * 1000,
  });
  const program = rules.data?.rules;

  const previous = useQuery({
    queryKey: ['member-request', fromId],
    queryFn: () => api.memberRequests.get(fromId),
    enabled: Boolean(fromId),
  });

  // Defaults, or the earlier request being corrected.
  useEffect(() => {
    const r = previous.data?.request;
    if (r) {
      form.setFieldsValue({
        ...r,
        bobDate: r.bobDateMs ? dayjs(r.bobDateMs) : undefined,
        joinDate: r.joinDateMs ? dayjs(r.joinDateMs) : dayjs(),
        joinFeesCollected: r.joinFeesCollected ?? 0,
      });
      setFiles({ photo: r.photoURL, documentFront: r.documentFrontURL, documentBack: r.documentBackURL });
    } else if (!fromId && !form.getFieldValue('programId') && (activeId || overview.data?.programId)) {
      form.setFieldsValue({ programId: activeId || overview.data.programId, joinDate: dayjs(), joinFeesMethod: 'cash', joinFeesCollected: 0 });
    }
  }, [previous.data, fromId, activeId, overview.data?.programId, form]);

  useEffect(() => {
    if (program?.locationGroups?.length === 1 && !form.getFieldValue('locationGroupId')) {
      form.setFieldValue('locationGroupId', program.locationGroups[0].id);
    }
  }, [program, form]);

  const matched = useMemo(() => (
    program && bobDate && joinDate
      ? matchAgeGroup(program.ageGroups, bobDate.startOf('day').valueOf(), joinDate.startOf('day').valueOf())
      : null
  ), [program, bobDate, joinDate]);

  const save = useMutation({
    mutationFn: (v) => {
      const body = {
        ...v,
        bobDate: v.bobDate?.format(DATE_FORMAT) ?? '',
        bobDateMs: v.bobDate?.startOf('day').valueOf(),
        joinDate: v.joinDate?.format(DATE_FORMAT) ?? '',
        joinDateMs: v.joinDate?.startOf('day').valueOf(),
        photoURL: files.photo ?? '',
        documentFrontURL: files.documentFront ?? '',
        documentBackURL: files.documentBack ?? '',
        aadhaarNo: (v.aadhaarNo ?? '').replace(/\D+/g, ''),
        locationGroupId: v.locationGroupId ?? null,
      };
      return fromId ? api.memberRequests.resubmit(fromId, body) : api.memberRequests.create(body);
    },
    onSuccess: () => {
      message.success(t('अनुरोध भेज दिया गया — कार्यालय की स्वीकृति का इंतज़ार करें'));
      queryClient.invalidateQueries({ queryKey: ['member-requests'] });
      queryClient.invalidateQueries({ queryKey: ['agent-app'] });
      router.replace('/agent/requests?s=pending');
    },
    onError: (e) => message.error(e.message, 6),
  });

  const fee = Number(matched?.joinFee) || 0;

  return (
    <AgentShell back="/agent/requests" title={fromId ? t('अनुरोध सुधारें') : t('नया सदस्य अनुरोध')}>
      {fromId && previous.data?.request?.status === 'rejected' ? (
        <Alert type="warning" showIcon message={t('पिछली बार अस्वीकार का कारण')} description={previous.data.request.rejectReason} />
      ) : null}
      {fromId && previous.isLoading ? <Skeleton active /> : (
        <Form form={form} layout="vertical" className="m-form" onFinish={(v) => save.mutate(v)} requiredMark scrollToFirstError>
          <div className="m-card">
            <div className="m-card__title" style={{ marginBottom: 8 }}>{t('योजना')}</div>
            <Form.Item name="programId" rules={[{ required: true, message: t('योजना चुनें') }]} style={{ marginBottom: 0 }}>
              <Select
                size="large"
                placeholder={t('योजना चुनें')}
                options={programs.map((p) => ({ value: p.id, label: p.hiname || p.name }))}
                onChange={() => form.setFieldValue('locationGroupId', undefined)}
              />
            </Form.Item>
          </div>

          <div className="m-card" style={{ marginTop: 12 }}>
            <div className="m-card__title" style={{ marginBottom: 8 }}>{t('व्यक्तिगत जानकारी')}</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <PhotoUpload label={t('फोटो')} crop value={files.photo} onChange={(url) => setFiles((f) => ({ ...f, photo: url }))} />
            </div>
            <Form.Item name="displayName" label={t('पूरा नाम')} rules={[{ required: true, min: 2, message: t('नाम ज़रूरी है') }]}>
              <Input size="large" />
            </Form.Item>
            <Form.Item name="fatherName" label={t('पिता / पति का नाम')}>
              <Input size="large" />
            </Form.Item>
            <div className="m-grid2">
              <Form.Item name="gender" label={t('लिंग')}>
                <Select size="large" allowClear options={masters.genders} placeholder={t('चुनें')} />
              </Form.Item>
              <Form.Item name="bobDate" label={t('जन्म तिथि')} rules={[{ required: true, message: t('जन्म तिथि ज़रूरी है') }]}>
                <DatePicker size="large" format={DATE_FORMAT} style={{ width: '100%' }} inputReadOnly={false} placeholder="DD-MM-YYYY" />
              </Form.Item>
            </div>
            <div className="m-grid2">
              <Form.Item name="jati" label={t('जाति')}>
                <Select size="large" allowClear showSearch options={masters.jatis.map((j) => ({ value: j.label, label: j.label }))} placeholder={t('चुनें')} />
              </Form.Item>
              <Form.Item name="gotra" label={t('गोत्र')}>
                <Input size="large" />
              </Form.Item>
            </div>
            <div className="m-grid2">
              <Form.Item name="guardian" label={t('संरक्षक / नॉमिनी')}>
                <Input size="large" />
              </Form.Item>
              <Form.Item name="guardianRelation" label={t('रिश्ता')}>
                <Select size="large" allowClear options={masters.relations} placeholder={t('चुनें')} />
              </Form.Item>
            </div>
          </div>

          <div className="m-card" style={{ marginTop: 12 }}>
            <div className="m-card__title" style={{ marginBottom: 8 }}>{t('संपर्क')}</div>
            <Form.Item
              name="phone"
              label={t('मोबाइल नंबर')}
              rules={[{ required: true, pattern: /^[0-9+\-\s]{10,15}$/, message: t('सही मोबाइल नंबर डालें') }]}
              extra={t('इसी नंबर से परिवार के सब सदस्य सदस्य ऐप में दिखेंगे')}
            >
              <Input size="large" inputMode="tel" maxLength={15} />
            </Form.Item>
            <Form.Item name="phoneAlt" label={t('दूसरा मोबाइल')} rules={[{ pattern: /^[0-9+\-\s]{6,15}$/, message: t('सही नंबर डालें') }]}>
              <Input size="large" inputMode="tel" maxLength={15} />
            </Form.Item>
            <Form.Item name="aadhaarNo" label={t('आधार नंबर')} rules={[{ pattern: /^\d{12}$/, message: t('12 अंक का आधार नंबर') }]}>
              <Input size="large" inputMode="numeric" maxLength={12} />
            </Form.Item>
            <div className="m-grid2">
              <PhotoUpload label={t('आधार आगे')} value={files.documentFront} onChange={(url) => setFiles((f) => ({ ...f, documentFront: url }))} />
              <PhotoUpload label={t('आधार पीछे')} value={files.documentBack} onChange={(url) => setFiles((f) => ({ ...f, documentBack: url }))} />
            </div>
          </div>

          <div className="m-card" style={{ marginTop: 12 }}>
            <div className="m-card__title" style={{ marginBottom: 8 }}>{t('पता')}</div>
            <div className="m-grid2">
              <Form.Item name="state" label={t('राज्य')}>
                <Select size="large" allowClear showSearch options={masters.states} placeholder={t('चुनें')}
                  onChange={() => form.setFieldValue('district', undefined)} />
              </Form.Item>
              <Form.Item name="district" label={t('ज़िला')}>
                <Select size="large" allowClear showSearch options={masters.districtsFor(state)} placeholder={t('चुनें')} />
              </Form.Item>
            </div>
            <div className="m-grid2">
              <Form.Item name="village" label={t('गाँव / शहर')} rules={[{ required: true, message: t('गाँव लिखें') }]}>
                <Input size="large" />
              </Form.Item>
              <Form.Item name="pinCode" label={t('पिन कोड')} rules={[{ pattern: /^\d{6}$/, message: t('6 अंक') }]}>
                <Input size="large" inputMode="numeric" maxLength={6} />
              </Form.Item>
            </div>
            <Form.Item name="currentAddress" label={t('पूरा पता')}>
              <Input.TextArea rows={2} />
            </Form.Item>
            {program?.locationGroups?.length ? (
              <Form.Item name="locationGroupId" label={t('स्थान समूह')}>
                <Select
                  size="large"
                  allowClear
                  options={program.locationGroups.map((g) => ({ value: g.id, label: `${g.groupName} — ${g.location}` }))}
                />
              </Form.Item>
            ) : null}
          </div>

          <div className="m-card" style={{ marginTop: 12 }}>
            <div className="m-card__title" style={{ marginBottom: 8 }}>{t('सदस्यता और शुल्क')}</div>
            <Form.Item name="joinDate" label={t('जुड़ने की तिथि')} rules={[{ required: true, message: t('तिथि ज़रूरी है') }]}>
              <DatePicker size="large" format={DATE_FORMAT} style={{ width: '100%' }} />
            </Form.Item>

            {bobDate && joinDate && program ? (
              matched ? (
                <div className="m-grid3" style={{ marginBottom: 14 }}>
                  <div className="m-stat"><div className="m-stat__label">{t('आयु समूह')}</div><div className="m-stat__value" style={{ fontSize: 15 }}>{matched.range}</div><div className="m-stat__hint">{t('{n} वर्ष', { n: matched.ageYears })}</div></div>
                  <div className="m-stat"><div className="m-stat__label">{t('प्रति क्लोजिंग')}</div><div className="m-stat__value" style={{ fontSize: 15 }}>{inr(matched.payAmount)}</div></div>
                  <div className="m-stat"><div className="m-stat__label">{t('नामांकन शुल्क')}</div><div className="m-stat__value" style={{ fontSize: 15 }}>{inr(matched.joinFee)}</div></div>
                </div>
              ) : (
                <Alert style={{ marginBottom: 14 }} type="error" showIcon message={t('यह आयु इस योजना के किसी आयु समूह में नहीं आती')} />
              )
            ) : null}

            <div className="m-grid2">
              <Form.Item
                name="joinFeesCollected"
                label={t('शुल्क लिया (₹)')}
                extra={fee ? t('अधिकतम {amt}', { amt: inr(fee) }) : undefined}
                rules={[{ type: 'number', min: 0, max: fee || 10_000_000, message: t('शुल्क से ज़्यादा नहीं') }]}
              >
                <InputNumber size="large" min={0} style={{ width: '100%' }} inputMode="numeric" />
              </Form.Item>
              <Form.Item name="joinFeesMethod" label={t('माध्यम')}>
                <Select size="large" options={[
                  { value: 'cash', label: t('नकद') }, { value: 'upi', label: 'UPI' },
                  { value: 'online', label: t('ऑनलाइन') }, { value: 'cheque', label: t('चेक') },
                ]} />
              </Form.Item>
            </div>
            <Form.Item name="joinFeesReference" label={t('UPI / रेफ़रेंस नंबर')}>
              <Input size="large" />
            </Form.Item>
            <Form.Item name="note" label={t('कार्यालय के लिए नोट')}>
              <Input.TextArea rows={2} />
            </Form.Item>
            <div className="m-muted" style={{ background: 'var(--accent-wash)', borderRadius: 10, padding: '8px 10px' }}>
              {t('स्वीकृति के बाद कार्यालय लिए गए शुल्क की रसीद बनाएगा और आपका कमीशन जुड़ेगा।')}
            </div>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            icon={<SendOutlined />}
            loading={save.isPending}
            disabled={Boolean(bobDate && joinDate && program && !matched)}
            style={{ marginTop: 14, height: 50, borderRadius: 12, fontWeight: 600 }}
          >
            {fromId ? t('दोबारा भेजें') : t('अनुरोध भेजें')}
          </Button>
        </Form>
      )}
    </AgentShell>
  );
}
