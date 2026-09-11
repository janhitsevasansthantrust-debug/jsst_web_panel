'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, AutoComplete, Button, Card, Checkbox, Col, DatePicker, Divider, Drawer, Empty, Form, Input, Radio, Row, Select, Space, Spin, Statistic, Tag, Typography,
} from 'antd';
import {
  DeleteOutlined, PlusOutlined, UserOutlined, PhoneOutlined, HomeOutlined,
  CopyOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { api, keys } from '../../lib/api.js';
import { useActiveProgramId, setActiveProgramId } from '../../lib/activeProgram.js';
import { matchAgeGroup, describeAgeGroups } from '../../lib/ageGroup.js';
import { resolveRegistrationConfig, previewRegistration } from '../../lib/registration.js';
import { useMasters } from '../../lib/useMasters.js';
import { MEMBER_STATUS } from '../../config/constants.js';
import PhotoUpload from './PhotoUpload.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

/**
 * Add / edit a member — the same sections, and the same shape, as the old form.
 *
 * The योजना selector comes FIRST and everything else stays hidden until it is
 * chosen. That is not decoration: a trust runs several programs at once, and
 * the chosen one supplies the age bands that decide this member's rates. Until
 * it is picked there is nothing to compute a rate from, so there is nothing
 * useful to show.
 *
 * The one thing worth understanding: the operator does NOT type the amounts.
 * Date of birth + joining date give an age, the age picks a band from the
 * program, and the band supplies both `payAmount` and `joinFees`. The card
 * below the dates shows what was matched, so a wrong birth date is obvious
 * immediately rather than discovered months later in the accounts.
 *
 * The same matching runs again on the server, which is the number that gets
 * stored — the form only previews it.
 */
export default function MemberForm({ open, onClose, member }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const t = useT();
  const queryClient = useQueryClient();
  const editing = Boolean(member?.id);

  const [files, setFiles] = useState({});
  const [copyPhone, setCopyPhone] = useState('');
  const [copiedFrom, setCopiedFrom] = useState(null);

  const programs = useQuery({
    queryKey: keys.programs,
    queryFn: () => api.programs.list(),
    enabled: open,
  });

  const programId = Form.useWatch('programId', form);
  const activeProgramId = useActiveProgramId();
  // States, districts and genders come from the master screen now, so a new
  // district is an edit rather than a deploy.
  const masters = useMasters();

  /**
   * When editing, always work from the complete member document.
   *
   * The row handed in by the grid is a `.select()` projection — about twenty
   * fields, chosen to keep the list cheap. Populating the form from that and
   * submitting it would write empty strings over every field the projection
   * left out: Aadhaar number, address, guardian, गोत्र, the extra details.
   * So the row is only good enough to know WHICH member to load.
   */
  const fullMember = useQuery({
    queryKey: keys.member(member?.id),
    queryFn: () => api.members.get(member.id),
    enabled: open && Boolean(member?.id),
  });

  // Until the full document arrives the form stays disabled, rather than
  // showing half a member that looks ready to save.
  const fullRecord = fullMember.data?.member ?? null;
  const loadingMember = Boolean(member?.id) && !fullRecord;

  const rules = useQuery({
    queryKey: ['program-rules', programId],
    queryFn: () => api.programs.rules(programId),
    enabled: open && Boolean(programId),
  });

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: () => api.agents.list(),
    enabled: open,
  });

  const program = rules.data?.rules;
  const selectedProgram = (programs.data?.programs ?? []).find((p) => p.id === programId);
  const regConfig = resolveRegistrationConfig(selectedProgram);
  const regPreview = previewRegistration(regConfig, 1)[0];
  const selectedState = Form.useWatch('state', form);
  const addedBy = Form.useWatch('addedBy', form);
  const bobDate = Form.useWatch('bobDate', form);
  const joinDate = Form.useWatch('joinDate', form);
  const joinFeesDone = Form.useWatch('joinFeesDone', form);

  const lookup = useQuery({
    queryKey: keys.memberByPhone(copyPhone),
    queryFn: () => api.members.byPhone(copyPhone),
    enabled: false,
  });

  /**
   * Only offer members from OTHER programs. Someone already in the program
   * being joined is not a candidate to copy — they are a duplicate.
   */
  const copyCandidates = (lookup.data?.members ?? []).filter(
    (m) => m.programId !== programId,
  );

  function copyFrom(source) {
    form.setFieldsValue({
      displayName: source.displayName,
      fatherName: source.fatherName,
      guardian: source.guardian,
      guardianRelation: source.guardianRelation,
      gender: source.gender,
      jati: source.jati,
      gotra: source.gotra,
      phone: source.phone,
      phoneAlt: source.phoneAlt,
      aadhaarNo: source.aadhaarNo,
      bobDate: source.bobDateMs ? dayjs(source.bobDateMs) : null,
      state: source.state,
      district: source.district,
      village: source.village,
      pinCode: source.pinCode,
      currentAddress: source.currentAddress,
    });
    // Reuse the documents too — it is the same person, so re-uploading the
    // same Aadhaar card into a second program helps nobody.
    setFiles({
      photo: source.photoURL || undefined,
      extraImage: source.extraImageURL || undefined,
      documentFront: source.documentFrontURL || undefined,
      documentBack: source.documentBackURL || undefined,
      guardianDocument: source.guardianDocumentURL || undefined,
    });
    setCopiedFrom(source);
    message.success(t('{name} से डेटा कॉपी किया गया', { name: source.displayName }));
  }

  /** The live rate preview — recomputed as the dates change. */
  const matched = useMemo(() => {
    if (!program?.ageGroups?.length || !bobDate || !joinDate) return null;
    return matchAgeGroup(
      program.ageGroups,
      bobDate.startOf('day').valueOf(),
      joinDate.startOf('day').valueOf(),
    );
  }, [program, bobDate, joinDate]);

  useEffect(() => {
    if (!open) return;
    setFiles({});
    setCopyPhone('');
    setCopiedFrom(null);
    if (member) {
      if (!fullRecord) return; // still loading the full document
      form.setFieldsValue({
        ...fullRecord,
        programId: fullRecord.programId,
        bobDate: fullRecord.bobDateMs ? dayjs(fullRecord.bobDateMs) : null,
        joinDate: fullRecord.joinDateMs ? dayjs(fullRecord.joinDateMs) : dayjs(),
        locationGroupId: fullRecord.locactionGroupId ?? undefined,
        addedBy: fullRecord.addedBy ?? 'admin',
        extraDetails: fullRecord.extraDetails ?? [],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        joinDate: dayjs(),
        status: MEMBER_STATUS.ACCEPTED,
        addedBy: 'admin',
        joinFeesDone: false,
        extraDetails: [],
      });
    }
  }, [open, member, fullRecord, form]);

  // Default to whichever योजना the header switcher is on, so "add member"
  // lands in the book the user is currently looking at. Still changeable —
  // members are regularly added to a different one — and if that happens the
  // switcher follows the member afterwards (see onSuccess below), because a
  // member saved into a program you are not viewing looks exactly like a
  // member that was never saved at all.
  useEffect(() => {
    if (!open || member || form.getFieldValue('programId')) return;
    const list = programs.data?.programs ?? [];
    const chosen =
      list.find((p) => p.id === activeProgramId) ??
      list.find((p) => p.isSelected) ??
      (list.length === 1 ? list[0] : null);
    if (chosen) form.setFieldValue('programId', chosen.id);
  }, [open, member, programs.data, activeProgramId, form]);

  // A program with exactly one location group needs no choice made.
  useEffect(() => {
    if (program?.locationGroups?.length === 1 && !form.getFieldValue('locationGroupId')) {
      form.setFieldValue('locationGroupId', program.locationGroups[0].id);
    }
  }, [program, form]);

  const save = useMutation({
    mutationFn: (values) => {
      const payload = {
        ...values,
        bobDate: values.bobDate?.format('DD-MM-YYYY') ?? '',
        bobDateMs: values.bobDate?.startOf('day').valueOf(),
        joinDate: values.joinDate?.format('DD-MM-YYYY') ?? '',
        joinDateMs: values.joinDate?.startOf('day').valueOf(),
        // agentName / addedByName are NOT sent. The server reads them from the
        // agent record — a name the browser supplies is a name the browser can
        // get wrong, and there would be nothing to check it against.
        photoURL: files.photo ?? fullRecord?.photoURL ?? '',
        extraImageURL: files.extraImage ?? fullRecord?.extraImageURL ?? '',
        documentFrontURL: files.documentFront ?? fullRecord?.documentFrontURL ?? '',
        documentBackURL: files.documentBack ?? fullRecord?.documentBackURL ?? '',
        guardianDocumentURL: files.guardianDocument ?? fullRecord?.guardianDocumentURL ?? '',
        extraDetails: (values.extraDetails ?? []).filter((f) => f?.label && f?.value),
      };
      return editing
        ? api.members.update(member.id, payload)
        : api.members.create(payload);
    },
    onSuccess: (res) => {
      message.success(
        editing
          ? t('सदस्य अपडेट हो गया')
          : t('सदस्य जुड़ गया — रजि. नंबर {n}', { n: res.member?.registrationNumber ?? '' }),
      );
      // Follow the member into whatever योजना it was filed under, otherwise
      // the list the user is about to look at is scoped to a different book
      // and the row they just created is simply not in it.
      const savedProgramId = res.member?.programId ?? form.getFieldValue('programId');
      if (savedProgramId && savedProgramId !== activeProgramId) {
        setActiveProgramId(savedProgramId);
        queryClient.clear();
      } else {
        queryClient.invalidateQueries({ queryKey: ['members'] });
        queryClient.invalidateQueries({ queryKey: keys.stats });
      }
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  // Only meaningful once a योजना is chosen — before that there is simply
  // nothing loaded yet, which is not the same as "this program has no bands".
  const noProgramRules = Boolean(programId) && program && !program.ageGroups?.length;

  return (
    <Drawer
      title={editing ? t('सदस्य संपादित करें') : t('नया सदस्य जोड़ें')}
      open={open}
      onClose={onClose}
      width={900}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('रद्द')}</Button>
          <Button
            type="primary"
            loading={save.isPending}
            disabled={!programId || noProgramRules || loadingMember}
            onClick={() => form.submit()}
          >
            {t('सहेजें')}
          </Button>
        </Space>
      }
    >
      {loadingMember && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Spin tip={t('सदस्य की पूरी जानकारी लोड हो रही है…')} size="large">
            <div style={{ height: 40 }} />
          </Spin>
        </div>
      )}

      {noProgramRules && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('इस योजना में कोई आयु समूह नहीं है')}
          description={t('सदस्य की राशि आयु समूह से आती है। योजना पेज पर जाकर इस योजना में आयु समूह जोड़ें, या ऊपर से दूसरी योजना चुनें।')}
        />
      )}

      <Form form={form} layout="vertical" onFinish={save.mutate} scrollToFirstError>
        {/* ── कार्यक्रम चयन ─────────────────────────────────────────────── */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Form.Item
            name="programId"
            label={<Text strong>{t('कार्यक्रम / योजना का चयन करें')}</Text>}
            rules={[{ required: true, message: t('कृपया एक योजना चुनें') }]}
            extra={t('इसी योजना के आयु समूह से सदस्य की राशि तय होगी')}
            style={{ marginBottom: 0 }}
          >
            <Select
              size="large"
              placeholder={t('योजना चुनें')}
              showSearch
              optionFilterProp="label"
              loading={programs.isLoading}
              disabled={editing}
              options={(programs.data?.programs ?? []).map((p) => ({
                label: `${p.hiname || p.name}${p.isSelected ? `  ${t('(चालू)')}` : ''}`,
                value: p.id,
              }))}
              onChange={() => {
                // Age bands and location groups belong to the program, so a
                // change invalidates both — clearing beats showing a rate that
                // came from the previous योजना.
                form.setFieldValue('locationGroupId', undefined);
              }}
            />
          </Form.Item>
        </Card>

        {!programId ? (
          <Empty
            description={t('ऊपर से योजना चुनें — उसके बाद बाकी फ़ॉर्म खुलेगा')}
            style={{ padding: '40px 0' }}
          />
        ) : (
        <>
        {/* ── मौजूदा सदस्य से कॉपी करें ─────────────────────────────────── */}
        {!editing && (
          <Card size="small" title={t('मौजूदा सदस्य से कॉपी करें')} style={{ marginBottom: 16 }}>
            <Paragraph type="secondary" style={{ fontSize: 13, marginTop: 0 }}>
              {t('परिवार का कोई सदस्य पहले से किसी और योजना में है? फ़ोन नंबर से खोजिए और उसकी जानकारी व दस्तावेज़ कॉपी कर लीजिए — दोबारा टाइप करने से वही व्यक्ति हर योजना में अलग-अलग दर्ज हो जाता है।')}
            </Paragraph>

            <Row gutter={8}>
              <Col flex="auto">
                <Input
                  prefix={<PhoneOutlined />}
                  placeholder={t('मौजूदा सदस्य का फ़ोन नंबर')}
                  value={copyPhone}
                  onChange={(e) => setCopyPhone(e.target.value)}
                  onPressEnter={() => copyPhone && lookup.refetch()}
                />
              </Col>
              <Col>
                <Button
                  icon={<SearchOutlined />}
                  loading={lookup.isFetching}
                  disabled={copyPhone.trim().length < 6}
                  onClick={() => lookup.refetch()}
                >
                  {t('खोजें')}
                </Button>
              </Col>
            </Row>

            {copiedFrom ? (
              <Alert
                type="success"
                showIcon
                icon={<CopyOutlined />}
                style={{ marginTop: 12 }}
                message={t('{name} से डेटा कॉपी किया गया', { name: copiedFrom.displayName })}
                description={t('मौजूदा दस्तावेज़ भी उपयोग होंगे। जन्म तिथि और जुड़ने की तारीख़ ज़रूर जाँच लें — राशि उन्हीं से तय होती है।')}
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      form.resetFields([
                        'displayName', 'fatherName', 'guardian', 'guardianRelation',
                        'gender', 'jati', 'gotra', 'phone', 'phoneAlt', 'aadhaarNo',
                        'bobDate', 'state', 'district', 'village', 'pinCode',
                        'currentAddress',
                      ]);
                      setFiles({});
                      setCopiedFrom(null);
                    }}
                  >
                    {t('नया डेटा')}
                  </Button>
                }
              />
            ) : (
              lookup.isFetched && (
                copyCandidates.length ? (
                  <div style={{ marginTop: 12 }}>
                    <Text strong style={{ fontSize: 13 }}>
                      {t('अन्य योजनाओं में मिले सदस्य:')}
                    </Text>
                    {copyCandidates.map((m) => (
                      <Card key={`${m.programId}-${m.id}`} size="small" style={{ marginTop: 8 }}>
                        <Row justify="space-between" align="middle" gutter={8}>
                          <Col flex="auto">
                            <Text strong>{m.displayName}</Text>{' '}
                            <Text type="secondary">({m.fatherName || '—'})</Text>
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {t('योजना:')} {m.programName} · {t('गाँव:')} {m.village || '—'}
                              </Text>
                            </div>
                          </Col>
                          <Col>
                            <Button
                              type="primary"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyFrom(m)}
                            >
                              {t('कॉपी करें')}
                            </Button>
                          </Col>
                        </Row>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 12 }}>
                    {t('इस नंबर पर किसी दूसरी योजना में कोई सदस्य नहीं मिला।')}
                  </Text>
                )
              )
            )}
          </Card>
        )}

        {/* ── व्यक्तिगत जानकारी ─────────────────────────────────────────── */}
        <Divider orientation="left">{t('व्यक्तिगत जानकारी')}</Divider>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="displayName"
              label={t('नाम')}
              rules={[{ required: true, message: t('नाम डालें') }, { min: 2 }]}
            >
              <Input prefix={<UserOutlined />} placeholder={t('पूरा नाम')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="fatherName" label={t('पिता/पति का नाम')}>
              <Input prefix={<UserOutlined />} placeholder={t('पिता/पति का नाम')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="gender" label={t('लिंग')}>
              <Select placeholder={t('लिंग चुनें')} options={masters.genders} allowClear />
            </Form.Item>
          </Col>

          <Col xs={12} md={8}>
            <Form.Item name="jati" label={t('जाति')}>
              {/* A Select that also takes free text: the master list covers
                  what the trust normally sees, but an operator must never be
                  stopped mid-registration because a caste is not on it. What
                  they type is stored as-is and can be added to the list
                  afterwards from the master screen. */}
              <AutoComplete
                allowClear
                options={masters.jatis}
                placeholder={t('जाति')}
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="gotra" label={t('गोत्र (वैकल्पिक)')}>
              <Input placeholder={t('गोत्र')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="guardian" label={t('वारिसदार का नाम')}>
              <Input prefix={<UserOutlined />} placeholder={t('वारिसदार का नाम')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item
              name="guardianRelation"
              label={t('वारिस से संबंध')}
              rules={[{ required: true, message: t('रिश्ता चुनें') }]}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('रिश्ता चुनें')}
                options={masters.relations}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* ── संपर्क जानकारी ────────────────────────────────────────────── */}
        <Divider orientation="left">{t('संपर्क जानकारी')}</Divider>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="phone"
              label={t('प्राथमिक फ़ोन')}
              rules={[{ pattern: /^[0-9+\-\s]{6,15}$/, message: t('सही नंबर डालें') }]}
            >
              <Input prefix={<PhoneOutlined />} placeholder={t('10 अंकों का नंबर')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="phoneAlt" label={t('वैकल्पिक फ़ोन')}>
              <Input prefix={<PhoneOutlined />} placeholder={t('वैकल्पिक')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="aadhaarNo"
              label={t('आधार संख्या')}
              rules={[{ pattern: /^\d{12}$/, message: t('12 अंक होने चाहिए') }]}
            >
              <Input maxLength={12} placeholder={t('12 अंकों का आधार')} />
            </Form.Item>
          </Col>
        </Row>

        {/* ── आयु और कार्यक्रम विवरण ────────────────────────────────────── */}
        <Divider orientation="left">{t('आयु और कार्यक्रम विवरण')}</Divider>

        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item
              name="bobDate"
              label={t('जन्म तिथि')}
              rules={[{ required: true, message: t('जन्म तिथि ज़रूरी है') }]}
            >
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="joinDate"
              label={t('जुड़ने की तारीख')}
              rules={[{ required: true, message: t('तारीख़ ज़रूरी है') }]}
            >
              <DatePicker format="DD-MM-YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="locationGroupId"
              label={t('स्थान समूह')}
              extra={
                program?.locationGroups?.length === 1
                  ? t('इस योजना में एक ही स्थान समूह है')
                  : undefined
              }
            >
              <Select
                allowClear
                placeholder={t('स्थान चुनें')}
                disabled={program?.locationGroups?.length === 1}
                options={(program?.locationGroups ?? []).map((g) => ({
                  label: `${g.groupName} — ${g.location} (${g.groupType})`,
                  value: g.id,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <RateCard matched={matched} program={program} hasDates={Boolean(bobDate && joinDate)} />

        {/* ── पता जानकारी ───────────────────────────────────────────────── */}
        <Divider orientation="left">{t('पता जानकारी')}</Divider>

        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item
              name="state"
              label={t('राज्य')}
              rules={[{ required: true, message: t('राज्य चुनें') }]}
            >
              <Select
                allowClear
                showSearch
                placeholder={t('राज्य चुनें')}
                options={masters.states}
                onChange={() => form.setFieldValue('district', undefined)}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="district"
              label={t('ज़िला')}
              rules={[{ required: true, message: t('ज़िला चुनें') }]}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('ज़िला चुनें')}
                disabled={!selectedState}
                options={masters.districtsFor(selectedState)}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="village" label={t('गाँव')}>
              <Input prefix={<HomeOutlined />} placeholder={t('गाँव का नाम')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="pinCode"
              label={t('पिन कोड')}
              rules={[{ pattern: /^\d{6}$/, message: t('6 अंक') }]}
            >
              <Input maxLength={6} placeholder={t('6 अंकों का पिनकोड')} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="currentAddress" label={t('वर्तमान पता')}>
              <Input.TextArea rows={2} placeholder={t('पूरा पता')} />
            </Form.Item>
          </Col>
        </Row>

        {/* ── दस्तावेज़ और फोटो ──────────────────────────────────────────── */}
        <Divider orientation="left">{t('दस्तावेज़ और फोटो')}</Divider>

        <Row gutter={16}>
          <Col xs={12} md={8}>
            <PhotoUpload
              label={t('सदस्य का फोटो')}
              required
              crop
              value={files.photo ?? fullRecord?.photoURL}
              onChange={(url) => setFiles((f) => ({ ...f, photo: url }))}
            />
          </Col>
          <Col xs={12} md={8}>
            <PhotoUpload
              label={t('वारिसदार फोटो')}
              crop
              value={files.extraImage ?? fullRecord?.extraImageURL}
              onChange={(url) => setFiles((f) => ({ ...f, extraImage: url }))}
            />
          </Col>
          <Col xs={12} md={8}>
            <PhotoUpload
              label={t('दस्तावेज़ (आगे)')}
              value={files.documentFront ?? fullRecord?.documentFrontURL}
              onChange={(url) => setFiles((f) => ({ ...f, documentFront: url }))}
            />
          </Col>
          <Col xs={12} md={8}>
            <PhotoUpload
              label={t('दस्तावेज़ (पीछे)')}
              value={files.documentBack ?? fullRecord?.documentBackURL}
              onChange={(url) => setFiles((f) => ({ ...f, documentBack: url }))}
            />
          </Col>
          <Col xs={12} md={8}>
            <PhotoUpload
              label={t('वारिसदार का दस्तावेज़')}
              value={files.guardianDocument ?? fullRecord?.guardianDocumentURL}
              onChange={(url) => setFiles((f) => ({ ...f, guardianDocument: url }))}
            />
          </Col>
        </Row>

        {/* ── अतिरिक्त जानकारी ──────────────────────────────────────────── */}
        <Divider orientation="left">{t('अतिरिक्त जानकारी (वैकल्पिक)')}</Divider>

        <Form.List name="extraDetails">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Row gutter={8} key={field.key} style={{ marginBottom: 8 }}>
                  <Col xs={10}>
                    <Form.Item name={[field.name, 'label']} noStyle>
                      <Input placeholder={t('लेबल (उदाहरण: व्यवसाय)')} />
                    </Form.Item>
                  </Col>
                  <Col xs={12}>
                    <Form.Item name={[field.name, 'value']} noStyle>
                      <Input placeholder={t('मान')} />
                    </Form.Item>
                  </Col>
                  <Col xs={2}>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Col>
                </Row>
              ))}
              <Button block icon={<PlusOutlined />} onClick={() => add({ label: '', value: '' })}>
                {t('जानकारी जोड़ें')}
              </Button>
            </>
          )}
        </Form.List>

        {/* ── जोड़ा गया ──────────────────────────────────────────────────── */}
        <Divider orientation="left">{t('जोड़ा गया')}</Divider>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="addedBy" label={t('जोड़ा गया')}>
              <Radio.Group>
                <Radio value="admin">{t('व्यवस्थापक')}</Radio>
                <Radio value="agent">{t('एजेंट')}</Radio>
              </Radio.Group>
            </Form.Item>
          </Col>
          {addedBy === 'agent' && (
            <Col xs={24} md={16}>
              <Form.Item
                name="agentId"
                label={t('एजेंट चुनें')}
                rules={[{ required: true, message: t('एजेंट चुनें') }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('एजेंट चुनें')}
                  loading={agents.isLoading}
                  options={(agents.data?.agents ?? []).map((a) => ({
                    label: `${a.displayName}${a.village ? ` — ${a.village}` : ''}`,
                    value: a.id,
                  }))}
                />
              </Form.Item>
            </Col>
          )}
        </Row>

        {/* ── नामांकन शुल्क ─────────────────────────────────────────────── */}
        <Divider orientation="left">{t('नामांकन शुल्क')}</Divider>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="joinFeesDone" valuePropName="checked">
              <Checkbox>{t('नामांकन शुल्क जमा हो गया')}</Checkbox>
            </Form.Item>
          </Col>
          {joinFeesDone && (
            <Col xs={24} md={16}>
              <Form.Item name="joinFeesTxtId" label={t('लेन-देन आईडी')}>
                <Input placeholder="Transaction ID" />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Form.Item
          name="registrationNumber"
          label={t('रजिस्ट्रेशन नंबर')}
          extra={
            editing
              ? undefined
              : regConfig.prefix
                ? t('अगला नंबर: {n} — खाली छोड़ें तो अपने-आप बनेगा', { n: regPreview })
                : t('खाली छोड़ें तो अपने-आप बनेगा')
          }
        >
          <Input
            disabled={editing}
            style={{ maxWidth: 280 }}
            addonBefore={regConfig.prefix || undefined}
            placeholder={editing ? '' : regPreview}
          />
        </Form.Item>
        </>
        )}
      </Form>
    </Drawer>
  );
}

/**
 * The rate preview.
 *
 * This exists because the amounts are not typed — they are matched. Showing
 * exactly which band was hit turns a mistyped birth date into something the
 * operator notices at entry time, instead of a wrong contribution amount that
 * only surfaces when the accounts do not balance.
 */
function RateCard({ matched, program, hasDates }) {
  const t = useT();
  if (!program) return null;

  if (!hasDates) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('जन्म तिथि और जुड़ने की तारीख़ भरें')}
        description={
          <Text style={{ fontSize: 13 }}>
            {t('राशि इन्हीं दोनों से तय होती है। उपलब्ध समूह:')}{' '}
            {describeAgeGroups(program.ageGroups)}
          </Text>
        }
      />
    );
  }

  if (!matched) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('इस आयु के लिए कोई समूह नहीं है')}
        description={
          <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
            {t('इस योजना के समूह:')} {describeAgeGroups(program.ageGroups)}.{' '}
            {t('जन्म तिथि जाँचें, या योजना पेज पर इस आयु के लिए समूह जोड़ें।')}
          </Paragraph>
        }
      />
    );
  }

  return (
    <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
      <Row gutter={16} align="middle">
        <Col xs={24} md={8}>
          <Text type="secondary">{t('मिला आयु समूह')}</Text>
          <div>
            <Tag color="green" style={{ fontSize: 14, padding: '2px 10px' }}>
              {matched.range} {t('वर्ष')}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('आयु {age} वर्ष', { age: matched.ageYears })}
            </Text>
          </div>
        </Col>
        <Col xs={12} md={8}>
          <Statistic
            title={t('प्रति क्लोजिंग राशि')}
            value={`₹${matched.payAmount}`}
            valueStyle={{ fontSize: 20, color: 'var(--paid)' }}
          />
        </Col>
        <Col xs={12} md={8}>
          <Statistic
            title={t('नामांकन शुल्क')}
            value={`₹${matched.joinFee}`}
            valueStyle={{ fontSize: 20 }}
          />
        </Col>
      </Row>
    </Card>
  );
}
