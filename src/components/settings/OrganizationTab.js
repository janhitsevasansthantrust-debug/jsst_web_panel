'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Form, Input, Button, Card, Row, Col, Space, Typography, App,
  ColorPicker, Switch, Select, Spin, Alert, AutoComplete,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons';

import PhotoUpload from '../members/PhotoUpload.js';
import { api, keys } from '../../lib/api.js';
import { DEFAULT_PRIMARY, DEFAULT_ACCENT } from '../../lib/theme.js';
import { useT } from '../../i18n/index.js';
import { useMasters } from '../../lib/useMasters.js';

const { Text, Title, Paragraph } = Typography;

/**
 * The trust's own details — one record, edited in place.
 *
 * Everything here is data, not code. That is what makes handing this system to
 * another trust a matter of a fresh deployment plus this one form: the logo,
 * the header lines, the seal, the signature, the receipt prefix and the colours
 * all come out of this document at print time. Nothing about any particular
 * trust is compiled in.
 *
 * The old screen's save called `addDoc` on an `organizations` collection, so
 * pressing it twice left two organization records with no rule about which was
 * real, and the header rendered from whichever came back first. This is a
 * merge into a single document.
 */
export default function OrganizationTab() {
  const t = useT();
  const masters = useMasters();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: keys.trust, queryFn: () => api.trust.get() });
  const trust = query.data?.trust;

  useEffect(() => {
    if (!trust) return;
    form.setFieldsValue({
      name: trust.name,
      ...trust.branding,
      phone: trust.branding.phone?.length ? trust.branding.phone : [''],
      topLines: trust.branding.topLines ?? [],
      headerLines: trust.branding.headerLines ?? [],
      terms: trust.branding.terms ?? [],
      primary: trust.branding.theme?.primary || DEFAULT_PRIMARY,
      accent: trust.branding.theme?.accent || DEFAULT_ACCENT,
    });
  }, [trust, form]);

  const save = useMutation({
    mutationFn: (values) => {
      const { name, primary, accent, ...branding } = values;
      return api.trust.update({
        name: name || branding.nameHi,
        branding: {
          ...branding,
          phone: (branding.phone ?? []).map((p) => String(p ?? '').trim()).filter(Boolean),
          topLines: (branding.topLines ?? []).filter(Boolean),
          headerLines: (branding.headerLines ?? []).filter(Boolean),
          terms: (branding.terms ?? []).filter(Boolean),
          theme: { primary: hex(primary), accent: hex(accent) },
        },
      });
    },
    onSuccess: () => {
      message.success(t('ट्रस्ट की जानकारी सहेज दी गई'));
      queryClient.invalidateQueries({ queryKey: keys.trust });
      // The theme, the sidebar name and the login screen all read `branding`.
      // Without this the new colours only appear after a hard reload, which
      // looks exactly like the save not working.
      queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (err) => message.error(err.message),
  });

  if (query.isLoading) return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  if (query.error) return <Alert type="error" showIcon message={query.error.message} />;

  return (
    <Form form={form} layout="vertical" onFinish={save.mutate} scrollToFirstError>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('यही जानकारी हर रसीद, सूची और प्रमाणपत्र पर छपती है')}
        description={t('लोगो, हेडर लाइनें, मुहर, हस्ताक्षर और रंग — सब यहीं से आते हैं, कोड से नहीं। इसीलिए यह सिस्टम किसी दूसरे ट्रस्ट को देना सिर्फ़ नया deployment और यही एक फ़ॉर्म भरने जितना है।')}
      />

      <Card size="small" title={t('ट्रस्ट की पहचान')} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="nameHi" label={t('ट्रस्ट का नाम (हिन्दी)')}
              rules={[{ required: true, min: 2, message: t('नाम ज़रूरी है') }]}>
              <Input size="large" placeholder={t('श्री … सेवा ट्रस्ट')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('Name (English)')}>
              <Input size="large" placeholder={t('Shri … Seva Trust')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="tagline" label={t('उपशीर्षक / ध्येय वाक्य')}>
              <Input placeholder={t('रसीद पर नाम के नीचे छपेगा')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="cityState"
              label={t('क्षेत्र')}
              extra={t('नाम के नीचे छपेगा')}
            >
              <Input placeholder={t('जैसे: राजस्थान-गुजरात')} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Text style={{ display: 'block', marginBottom: 4 }}>{t('ऊपर की पंक्तियाँ')}</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {t('ट्रस्ट के नाम से ऊपर छपेंगी — जैसे “|| श्री गणेशाय नमः ||”')}
            </Text>
            <StringList name="topLines" placeholder={t('|| श्री गणेशाय नमः ||')} max={6} />
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="registrationNo" label={t('पंजीकरण संख्या')}><Input /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="panNo" label={t('PAN')}><Input /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="regDate" label={t('पंजीकरण तिथि')}>
              <Input placeholder="DD-MM-YYYY" />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Card size="small" title={t('पता और संपर्क')} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item name="addressHi" label={t('पता')}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="city" label={t('शहर')}><Input /></Form.Item></Col>
          <Col xs={12} md={6}>
            {/* Master-backed, and ordered state-first in the data even though the
                old layout put ज़िला on the left: the district list is derived
                from the chosen state. */}
            <Form.Item name="state" label={t('राज्य')}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('राज्य चुनें')}
                options={masters.states}
                onChange={() => form.setFieldValue('district', undefined)}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              noStyle
              shouldUpdate={(prev, next) => prev.state !== next.state}
            >
              {({ getFieldValue }) => (
                <Form.Item name="district" label={t('ज़िला')}>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={t('ज़िला चुनें')}
                    options={masters.districtsFor(getFieldValue('state'))}
                  />
                </Form.Item>
              )}
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="pinCode" label={t('पिन कोड')}><Input maxLength={6} /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label={t('ईमेल')}><Input type="email" /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="website" label={t('वेबसाइट')}><Input /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="contactPerson"
              label={t('संपर्क व्यक्ति')}
              extra={t('फ़ोन पर किससे बात करनी है')}
            >
              <Input placeholder={t('जैसे: भागीरथ K')} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            {/* Several numbers, because a receipt usually carries the office
                line and whoever actually answers the phone. */}
            <Text style={{ display: 'block', marginBottom: 6 }}>{t('फ़ोन नंबर')}</Text>
            <Form.List name="phone">
              {(fields, { add, remove }) => (
                <>
                  {/* `key` is destructured out rather than spread: React 19
                      warns when a spread object carries one, and a key that
                      arrives by spread is not a key at all — the list would
                      re-mount rows instead of reordering them. */}
                  {fields.map(({ key, ...field }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item {...field} noStyle>
                        <Input style={{ width: 220 }} placeholder="9876543210" />
                      </Form.Item>
                      {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(field.name)} />}
                    </Space>
                  ))}
                  {fields.length < 5 && (
                    <Button type="dashed" onClick={() => add('')} icon={<PlusOutlined />}>
                      {t('नंबर जोड़ें')}
                    </Button>
                  )}
                </>
              )}
            </Form.List>
          </Col>
        </Row>
      </Card>

      <Card size="small" title={t('लोगो, मुहर और हस्ताक्षर')} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="logoURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('लोगो')} kind="logo" width={110} height={110} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="sealURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('मुहर')} kind="seal" width={110} height={110} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="signatureURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('हस्ताक्षर')} kind="sign" width={150} height={70} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="rightLogoURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('दायाँ लोगो')} kind="logo" width={110} height={110} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="headerImageURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('हेडर पट्टी')} kind="header" width={200} height={60} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="bannerURL" getValueFromEvent={(v) => v}>
              <BrandImage label={t('बैनर')} kind="banner" width={180} height={70} />
            </Form.Item>
          </Col>

          <Col xs={24} md={8}>
            <Form.Item name="presidentName" label={t('अध्यक्ष का नाम')}>
              <Input placeholder={t('जैसे: भागीरथ K')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="signatoryName" label={t('हस्ताक्षरकर्ता का नाम')}><Input /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            {/* AutoComplete, not Select: a trust that signs as something the
                master list has never heard of must still be able to print. */}
            <Form.Item name="signatoryDesignation" label={t('पद')}>
              <AutoComplete
                allowClear
                options={masters.designations}
                placeholder={t('अध्यक्ष')}
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Card size="small" title={t('रसीद और दस्तावेज़')} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="receiptPrefix" label={t('रसीद उपसर्ग')}
              extra={t('रसीद नंबर इससे शुरू होगा')}>
              <Input maxLength={8} placeholder={t('RSD')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="language" label={t('दस्तावेज़ की भाषा')}>
              <Select options={[
                { value: 'hi', label: t('हिन्दी') },
                { value: 'en', label: t('English') },
              ]} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="primary" label={t('मुख्य रंग')}>
              <ColorPicker showText format="hex" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="accent" label={t('सहायक रंग')}>
              <ColorPicker showText format="hex" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="showQR" label={t('रसीद पर QR कोड')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Text style={{ display: 'block', marginBottom: 4 }}>{t('हेडर लाइनें')}</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {t('ट्रस्ट के नाम के नीचे छपने वाली पंक्तियाँ — पता, पंजीकरण, फ़ोन')}
            </Text>
            <StringList name="headerLines" placeholder={t('जैसे: पंजी. क्र. 1234/2019')} max={6} />
          </Col>
          <Col xs={24} style={{ marginTop: 16 }}>
            <Text style={{ display: 'block', marginBottom: 4 }}>{t('नियम व शर्तें')}</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {t('रसीद के नीचे छपेंगी')}
            </Text>
            <StringList name="terms" placeholder={t('एक शर्त प्रति पंक्ति')} max={12} />
          </Col>
          <Col xs={24} style={{ marginTop: 16 }}>
            <Form.Item name="footerNote" label={t('फुटर नोट')}>
              <Input.TextArea rows={2} placeholder={t('हर दस्तावेज़ के नीचे छपेगा')} />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <HeaderPreview form={form} />

      <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '12px 0',
                    borderTop: '1px solid #f0f0f0' }}>
        <Button type="primary" size="large" icon={<SaveOutlined />}
          loading={save.isPending} onClick={() => form.submit()}>
          {t('सहेजें')}
        </Button>
      </div>
    </Form>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

/** A repeatable line of free text — header lines, terms. */
function StringList({ name, placeholder, max }) {
  const t = useT();
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, ...field }) => (
            <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
              <Form.Item {...field} noStyle>
                <Input style={{ width: 460, maxWidth: '100%' }} placeholder={placeholder} />
              </Form.Item>
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          {fields.length < max && (
            <Button type="dashed" onClick={() => add('')} icon={<PlusOutlined />}>
              {t('पंक्ति जोड़ें')}
            </Button>
          )}
        </>
      )}
    </Form.List>
  );
}

/** PhotoUpload wired for `Form.Item` — takes a URL, gives back a URL. */
/**
 * A branding image — logo, seal, signature, header band, banner.
 *
 * Unlike every other upload in the app this goes through the server
 * (`/api/trust/branding`) rather than straight to Firebase Storage. See that
 * route for why; the short version is that only an admin should be able to
 * change what every printed document is headed with, and that check belongs on
 * the verified session rather than on Storage rules that are deployed
 * separately from the app.
 */
function BrandImage({ value, onChange, label, kind, width, height }) {
  return (
    <PhotoUpload
      label={label} value={value} onChange={onChange}
      upload={(file) => api.trust.uploadBranding(kind, file)}
      width={width} height={height}
    />
  );
}

/**
 * What the top of a printed document will look like.
 *
 * Worth the few lines: a logo of the wrong shape or a header line that is too
 * long is obvious here and invisible in a form full of text inputs — and the
 * alternative is finding out on a stack of already-printed receipts.
 */
function HeaderPreview({ form }) {
  const t = useT();
  const values = Form.useWatch([], form) ?? {};
  const primary = hex(values.primary) || DEFAULT_PRIMARY;

  return (
    <Card size="small" title={t('रसीद का हेडर — पूर्वावलोकन')} style={{ marginBottom: 16 }}>
      <div style={{ border: `2px solid ${primary}`, borderRadius: 8, padding: 16 }}>
        {values.headerImageURL && (
          <img
            src={values.headerImageURL}
            alt=""
            style={{ width: '100%', maxHeight: 70, objectFit: 'contain', marginBottom: 8 }}
          />
        )}

        {(values.topLines ?? []).filter(Boolean).length > 0 && (
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            {(values.topLines ?? []).filter(Boolean).map((line, i) => (
              <div key={i} style={{ fontSize: 11, color: primary, fontWeight: 600 }}>
                {line}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {values.logoURL && (
            <img src={values.logoURL} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          )}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <Title level={4} style={{ margin: 0, color: primary }}>
              {values.nameHi || t('ट्रस्ट का नाम')}
            </Title>
            {values.cityState && (
              <div style={{ fontSize: 12, fontWeight: 600 }}>{values.cityState}</div>
            )}
            {values.tagline && (
              <Text type="secondary" style={{ fontSize: 12 }}>{values.tagline}</Text>
            )}
            {(values.headerLines ?? []).filter(Boolean).map((line, i) => (
              <div key={i} style={{ fontSize: 11, color: '#555' }}>{line}</div>
            ))}
            {(values.addressHi || values.city) && (
              <div style={{ fontSize: 11, color: '#555' }}>
                {[values.addressHi, values.city, values.district, values.pinCode]
                  .filter(Boolean).join(', ')}
              </div>
            )}
            {(values.phone ?? []).filter(Boolean).length > 0 && (
              <div style={{ fontSize: 11, color: '#555' }}>
                {t('फ़ोन:')} {(values.phone ?? []).filter(Boolean).join(', ')}
              </div>
            )}
            {values.contactPerson && (
              <div style={{ fontSize: 11, color: '#555' }}>
                {t('संपर्क:')} {values.contactPerson}
              </div>
            )}
          </div>
          {(values.rightLogoURL || values.sealURL) && (
            <img
              src={values.rightLogoURL || values.sealURL}
              alt=""
              style={{ width: 64, height: 64, objectFit: 'contain' }}
            />
          )}
        </div>
      </div>
      <Paragraph type="secondary" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        {t('असली PDF इसी जानकारी से बनेगा।')}
      </Paragraph>
    </Card>
  );
}

/**
 * antd's ColorPicker hands back an object; the database wants "#8B0000".
 *
 * A CSS variable is rejected outright. It would look fine on screen — the
 * browser resolves it — and then reach the PDF renderer, which has no CSS and
 * would print the header rule in nothing at all.
 */
function hex(v) {
  if (!v) return '';
  const s = typeof v === 'string' ? v : (v.toHexString?.() ?? '');
  return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s.trim()) ? s.trim() : '';
}
