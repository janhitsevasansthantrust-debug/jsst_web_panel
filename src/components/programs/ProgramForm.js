'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, Divider, Drawer, Form, Input, InputNumber, Radio, Row, Select, Space, Switch, Tag, Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import { api, keys } from '../../lib/api.js';
import { previewRegistration, DEFAULT_REGISTRATION } from '../../lib/registration.js';
import { describeAgeGroups } from '../../lib/ageGroup.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

const CATEGORIES = [
  { label: 'सुरक्षा (Suraksha)', value: 'isSuraksha' },
  { label: 'मामेरा (Mamera)', value: 'isMamera' },
  { label: 'विवाह (Vivah)', value: 'isVivah' },
  { label: 'अन्य (Other)', value: 'isOther' },
];

const GROUP_TYPES = [
  { label: 'Group A', value: 'A' },
  { label: 'Group B', value: 'B' },
  { label: 'Group C', value: 'C' },
];

/**
 * Create / edit a योजना.
 *
 * The important part is the age bands. They are not a detail of the program —
 * they ARE the rate card: a member's per-closing contribution and joining fee
 * come from whichever band their age falls into on their joining date. That is
 * why the bands are validated for overlaps and gaps before the program saves,
 * and why the server re-derives every member's rate from them rather than
 * trusting the member form.
 */
export default function ProgramForm({ open, onClose, program }) {
  const [form] = Form.useForm();
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const editing = Boolean(program?.id);

  const ageGroups = Form.useWatch('ageGroups', form);

  useEffect(() => {
    if (!open) return;
    if (program) {
      form.setFieldsValue({
        ...program,
        category: program.category ?? 'isOther',
        // A योजना created before the registration settings existed has no
        // `registration` at all; spreading it in as `undefined` would leave
        // every field on that tab blank and save it blank.
        registration: { ...DEFAULT_REGISTRATION, ...(program.registration ?? {}) },
        receiptPrefix: program.receiptPrefix ?? 'RSD',
        ageGroups: program.ageGroups?.length ? program.ageGroups : [blankAge()],
        locationGroups: program.locationGroups ?? [],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        category: 'isOther',
        isSelected: false,
        receiptPrefix: 'RSD',
        registration: {
          mode: 'sequential', prefix: '', suffix: '',
          startFrom: 1001, padding: 0, randomLength: 6,
        },
        ageGroups: [blankAge()],
        locationGroups: [],
      });
    }
  }, [open, program, form]);

  const save = useMutation({
    mutationFn: (values) =>
      editing ? api.programs.update(program.id, values) : api.programs.create(values),
    onSuccess: () => {
      message.success(editing ? t('योजना अपडेट हो गई') : t('योजना बन गई'));
      queryClient.invalidateQueries({ queryKey: keys.programs });
      onClose();
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <Drawer
      title={editing ? t('योजना संपादित करें') : t('नई योजना')}
      open={open}
      onClose={onClose}
      width={860}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('रद्द')}</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            {t('सहेजें')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={save.mutate}>
        <Divider orientation="left" plain>{t('बुनियादी जानकारी')}</Divider>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="name"
              label={t('योजना का नाम (English)')}
              rules={[{ required: true, message: t('नाम डालें') }, { min: 2 }]}
            >
              <Input placeholder="Program name" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="hiname" label={t('योजना का नाम (हिंदी)')}>
              <Input placeholder={t('हिंदी नाम')} />
            </Form.Item>
          </Col>

          <Col xs={24}>
            <Form.Item name="about" label={t('योजना के बारे में')}>
              <Input.TextArea rows={2} placeholder={t('संक्षिप्त विवरण')} />
            </Form.Item>
          </Col>

          <Col xs={24}>
            <Form.Item
              name="noteLine"
              label={t('प्रमाणपत्र नोट (हिंदी)')}
              extra={t('यह पंक्ति सदस्यता प्रमाणपत्र पर छपती है')}
            >
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item name="category" label={t('श्रेणी')} rules={[{ required: true }]}>
              <Radio.Group>
                <Space direction="vertical">
                  {CATEGORIES.map((c) => (
                    <Radio key={c.value} value={c.value}>{t(c.label)}</Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item
              name="isSelected"
              label={t('चालू योजना बनाएँ')}
              valuePropName="checked"
              extra={t('नए सदस्य डिफ़ॉल्ट रूप से इसी योजना में जुड़ेंगे')}
            >
              <Switch />
            </Form.Item>

            {!editing && (
              <Form.Item name="receiptPrefix" label={t('रसीद उपसर्ग')}>
                <Input maxLength={8} placeholder="RSD" />
              </Form.Item>
            )}
          </Col>
        </Row>

        {!editing && (
          <>
            <Divider orientation="left" plain>{t('रजिस्ट्रेशन नंबर')}</Divider>
            <RegistrationSettings form={form} />
          </>
        )}

        <Divider orientation="left" plain>{t('आयु समूह — यही राशि तय करते हैं')}</Divider>

        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('सदस्य की राशि यहीं से आती है')}
          description={
            <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>
              {t('सदस्य जोड़ते समय उसकी ')}
              <strong>{t('जन्म तिथि')}</strong>{' '}
              {t('और ')}
              <strong>{t('जुड़ने की तारीख़')}</strong>{' '}
              {t('से आयु निकाली जाती है, और जिस समूह में वो आती है उसी की राशि लागू होती है। आयु ')}
              <Text code>{t('शुरुआती ≤ आयु < अंतिम')}</Text>{' '}
              {t('के हिसाब से मिलती है, तो समूह आपस में टकराने नहीं चाहिए और बीच में खाली जगह नहीं छूटनी चाहिए — वरना कुछ उम्र के सदस्य जुड़ ही नहीं पाएँगे।')}
            </Paragraph>
          }
        />

        <Form.List name="ageGroups">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  extra={
                    fields.length > 1 && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    )
                  }
                >
                  <Row gutter={12}>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name={[field.name, 'startAge']}
                        label={t('शुरुआती आयु')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <InputNumber min={0} max={150} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name={[field.name, 'endAge']}
                        label={t('अंतिम आयु')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <InputNumber min={0} max={150} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name={[field.name, 'joinFee']}
                        label={t('नामांकन शुल्क')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <InputNumber min={0} prefix="₹" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name={[field.name, 'payAmount']}
                        label={t('प्रति क्लोजिंग')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <InputNumber min={0} prefix="₹" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                </Card>
              ))}

              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => add(blankAge())}
                style={{ marginBottom: 8 }}
              >
                {t('आयु समूह जोड़ें')}
              </Button>

              {ageGroups?.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('वर्तमान: {text}', { text: describeAgeGroups(ageGroups) })}
                </Text>
              )}
            </>
          )}
        </Form.List>

        <Divider orientation="left" plain>{t('स्थान समूह')}</Divider>

        <Form.List name="locationGroups">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  extra={
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  }
                >
                  <Row gutter={12}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name={[field.name, 'groupName']}
                        label={t('समूह का नाम')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <Input placeholder={t('जैसे: उत्तर क्षेत्र')} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name={[field.name, 'location']}
                        label={t('स्थान')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <Input placeholder={t('जैसे: जोधपुर')} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name={[field.name, 'groupType']}
                        label={t('समूह प्रकार')}
                        rules={[{ required: true, message: t('ज़रूरी') }]}
                      >
                        <Select options={GROUP_TYPES} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                </Card>
              ))}

              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => add({ groupName: '', location: '', groupType: 'A' })}
              >
                {t('स्थान समूह जोड़ें')}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}

const blankAge = () => ({ startAge: 0, endAge: 18, joinFee: 0, payAmount: 0 });

/* ── registration numbers ────────────────────────────────────────────────── */

/**
 * How this योजना numbers its members.
 *
 * Set once, when the योजना is created, and not editable afterwards — the
 * numbers already issued are printed on receipts and written in ledgers, and
 * changing the recipe underneath them would produce two members whose numbers
 * follow different rules with nothing to say which is which.
 *
 * The preview is the important part of this panel. "padding 5, prefix RJ-"
 * means nothing until you see `RJ-01001`, and seeing it is what catches a
 * prefix somebody typed with a trailing space.
 */
function RegistrationSettings({ form }) {
  const t = useT();
  const reg = Form.useWatch('registration', form) ?? {};
  const random = reg.mode === 'random';
  const samples = previewRegistration(reg, 3);

  return (
    <>
      <Form.Item name={['registration', 'mode']} label={t('नंबर कैसे बनें')}>
        <Radio.Group optionType="button" buttonStyle="solid">
          <Radio.Button value="sequential">{t('क्रम से (1001, 1002…)')}</Radio.Button>
          <Radio.Button value="random">{t('रैंडम (कोई भी अंक)')}</Radio.Button>
        </Radio.Group>
      </Form.Item>

      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Form.Item
            name={['registration', 'prefix']}
            label={t('उपसर्ग')}
            extra={t('नंबर से पहले')}
          >
            <Input maxLength={10} placeholder={t('जैसे: RJ-')} />
          </Form.Item>
        </Col>

        {random ? (
          <Col xs={12} md={6}>
            <Form.Item
              name={['registration', 'randomLength']}
              label={t('कितने अंक')}
              extra={t('जितने ज़्यादा, टकराव उतना कम')}
            >
              <InputNumber min={4} max={12} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        ) : (
          <>
            <Col xs={12} md={6}>
              <Form.Item
                name={['registration', 'startFrom']}
                label={t('पहला नंबर')}
                extra={t('पहले सदस्य को यही मिलेगा')}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item
                name={['registration', 'padding']}
                label={t('कुल अंक')}
                extra={t('0 = जैसा है वैसा')}
              >
                <InputNumber min={0} max={12} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </>
        )}

        <Col xs={12} md={6}>
          <Form.Item name={['registration', 'suffix']} label={t('प्रत्यय')} extra={t('नंबर के बाद')}>
            <Input maxLength={10} placeholder={t('जैसे: /25')} />
          </Form.Item>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('पहले तीन सदस्यों के नंबर ऐसे दिखेंगे')}
        description={
          <Space size={8} wrap style={{ marginTop: 4 }}>
            {samples.map((n) => (
              <Tag key={n} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>
                {n}
              </Tag>
            ))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {random
                ? t('हर सदस्य को अलग रैंडम नंबर मिलेगा — टकराव होने पर दोबारा बनेगा')
                : t('योजना बनने के बाद यह नियम बदला नहीं जा सकता')}
            </Text>
          </Space>
        }
      />
    </>
  );
}
