'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, Descriptions, Divider, Form, Image, Input, InputNumber, Modal, Row, Space, Switch, Tag, Typography,
} from 'antd';
import {
  MobileOutlined, ToolOutlined, CloudDownloadOutlined, PhoneOutlined, QrcodeOutlined, EyeOutlined,
} from '@ant-design/icons';

import PhotoUpload from '../members/PhotoUpload.js';

import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Paragraph, Text } = Typography;

/**
 * The phone app (agents + members), switched from here:
 *
 *   • रखरखाव (maintenance) — on: every phone shows the maintenance screen with
 *     your message instead of the app, until you switch it off. Use it while
 *     correcting data or migrating, so nobody collects against wrong numbers.
 *   • अपडेट — the newest app version and the oldest one still allowed. Phones
 *     below "नवीनतम" see "नया अपडेट उपलब्ध"; below "न्यूनतम" must update first.
 *   • संपर्क — the numbers on the app's "संपर्क करें" card (blank = the trust's
 *     own phone/email from "ट्रस्ट की जानकारी").
 */
export default function MobileAppTab() {
  const t = useT();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const cfg = useQuery({ queryKey: ['app-config'], queryFn: () => api.appConfig.get() });

  useEffect(() => {
    if (cfg.data?.config) form.setFieldsValue(cfg.data.config);
  }, [cfg.data, form]);

  const save = useMutation({
    mutationFn: (values) => api.appConfig.update(values),
    onSuccess: (res) => {
      qc.setQueryData(['app-config'], res);
      message.success(t('मोबाइल ऐप की सेटिंग सहेजी गई'));
    },
    onError: (e) => message.error(e.message),
  });

  const maintenance = Form.useWatch('maintenance', form);
  const payOn = Form.useWatch(['payment', 'enabled'], form);
  const qrImageURL = Form.useWatch(['payment', 'qrImageURL'], form);
  const [preview, setPreview] = useState(null);
  const [backfill, setBackfill] = useState(null);

  // Logins for members enrolled before auto-create: batch after batch.
  async function runBackfill() {
    const total = { created: 0, linked: 0, skipped: 0, remaining: null, running: true };
    setBackfill({ ...total });
    try {
      for (let i = 0; i < 200; i++) {
        const r = await api.memberLogins.backfill();
        total.created += r.created; total.linked += r.linked; total.skipped += r.skipped; total.remaining = r.remaining;
        setBackfill({ ...total });
        if (!r.remaining || !r.processed) break;
      }
      message.success(t('पुराने सदस्यों के लॉगिन बन गए'));
    } catch (e) {
      message.error(e.message);
    } finally {
      setBackfill((b) => ({ ...(b ?? total), running: false }));
    }
  }
  const [previewAmount, setPreviewAmount] = useState(300);
  const [previewing, setPreviewing] = useState(false);

  async function openPreview() {
    setPreviewing(true);
    try {
      const res = await api.appConfig.paymentPreview(previewAmount);
      setPreview(res.payment);
    } catch (e) {
      message.error(e.message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} disabled={cfg.isLoading}>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        <MobileOutlined /> {t('एजेंट और सदस्य के फ़ोन ऐप के लिए। बदलाव कुछ ही सेकंड में हर फ़ोन पर दिखते हैं।')}
      </Paragraph>

      <Card
        size="small"
        title={<><ToolOutlined /> {t('रखरखाव (Maintenance)')}</>}
        extra={maintenance ? <Tag color="red">{t('चालू — ऐप बंद है')}</Tag> : <Tag color="green">{t('ऐप चालू है')}</Tag>}
        style={{ marginBottom: 16, borderColor: maintenance ? '#ff7875' : undefined }}
      >
        <Form.Item name="maintenance" valuePropName="checked" label={t('रखरखाव स्क्रीन दिखाएँ')}>
          <Switch checkedChildren={t('चालू')} unCheckedChildren={t('बंद')} />
        </Form.Item>
        {maintenance ? (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }}
            message={t('सहेजते ही सभी एजेंट और सदस्य ऐप में रखरखाव स्क्रीन देखेंगे — कोई ऐप उपयोग नहीं कर पाएगा।')} />
        ) : null}
        <Row gutter={16}>
          <Col xs={24} md={16}>
            <Form.Item name="maintenanceMessage" label={t('संदेश')}>
              <Input.TextArea rows={2} maxLength={400} placeholder={t('जैसे: हिसाब मिलान का काम चल रहा है, शाम 6 बजे तक ऐप बंद रहेगा।')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="maintenanceUntil" label={t('कब तक (वैकल्पिक)')}>
              <Input maxLength={60} placeholder={t('जैसे: आज शाम 6 बजे')} />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Card size="small" title={<><CloudDownloadOutlined /> {t('ऐप अपडेट')}</>} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="latestVersion" label={t('नवीनतम वर्ज़न')} rules={[{ pattern: /^(\d+(\.\d+){0,2})?$/, message: '1.2.3' }]}>
              <Input placeholder="1.0.1" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="minVersion" label={t('न्यूनतम ज़रूरी वर्ज़न')} rules={[{ pattern: /^(\d+(\.\d+){0,2})?$/, message: '1.2.3' }]}>
              <Input placeholder="1.0.0" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="updateUrl" label={t('अपडेट लिंक (Play Store / APK)')} rules={[{ type: 'url', message: t('सही लिंक डालें') }]}>
              <Input placeholder="https://play.google.com/store/apps/details?id=…" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="updateMessage" label={t('अपडेट संदेश')}>
              <Input.TextArea rows={2} maxLength={400} placeholder={t('जैसे: नए वर्ज़न में बैच-वार क्लोजिंग सूची और तेज़ PDF।')} />
            </Form.Item>
          </Col>
        </Row>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('नवीनतम से पुराने ऐप पर "नया अपडेट उपलब्ध" दिखेगा (बाद में भी कर सकते हैं)। न्यूनतम से पुराने ऐप पर अपडेट ज़रूरी होगा।')}
        </Text>
      </Card>


      <Card
        size="small"
        title={<><QrcodeOutlined /> {t('ऐप से भुगतान (UPI / बैंक)')}</>}
        extra={payOn ? <Tag color="green">{t('ऐप में दिख रहा है')}</Tag> : <Tag>{t('बंद')}</Tag>}
        style={{ marginBottom: 16 }}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          {t('चालू करने पर सदस्य और एजेंट ऐप में "भुगतान करें" से UPI QR (राशि सहित), UPI ID, बैंक खाता और भुगतान के तरीक़े देखेंगे। ऐप से भुगतान अपने-आप जमा नहीं होता — पैसा खाते में दिखने पर कार्यालय रसीद बनाता है।')}
        </Paragraph>
        <Space size={24} wrap>
          <Form.Item name={['payment', 'enabled']} valuePropName="checked" label={t('ऐप में भुगतान दिखाएँ')}>
            <Switch checkedChildren={t('चालू')} unCheckedChildren={t('बंद')} />
          </Form.Item>
          <Form.Item name={['payment', 'forMembers']} valuePropName="checked" label={t('किसके लिए')}>
            <Checkbox>{t('सदस्य')}</Checkbox>
          </Form.Item>
          <Form.Item name={['payment', 'forAgents']} valuePropName="checked" label=" ">
            <Checkbox>{t('एजेंट')}</Checkbox>
          </Form.Item>
        </Space>

        <Divider orientation="left" plain>{t('UPI')}</Divider>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name={['payment', 'upiId']} label={t('UPI ID (VPA)')} extra={t('इससे राशि सहित QR अपने-आप बनेगा')}
              rules={[{ pattern: /^([\w.\-]{2,256}@[a-zA-Z][\w.\-]{1,64})?$/, message: t('UPI ID जैसे trust@sbi') }]}>
              <Input placeholder="trustname@sbi" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={['payment', 'payeeName']} label={t('प्राप्तकर्ता का नाम')} extra={t('खाली = ट्रस्ट का नाम। बैंक खाते वाला अंग्रेज़ी नाम सबसे अच्छा रहता है')}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={['payment', 'qrImageURL']} hidden><Input /></Form.Item>
            <PhotoUpload
              label={t('अपना छपा हुआ QR (वैकल्पिक)')}
              folder="documents"
              value={qrImageURL}
              onChange={(url) => form.setFieldValue(['payment', 'qrImageURL'], url)}
            />
          </Col>
        </Row>

        <Divider orientation="left" plain>{t('बैंक खाता (वैकल्पिक)')}</Divider>
        <Row gutter={16}>
          <Col xs={24} md={8}><Form.Item name={['payment', 'accountName']} label={t('खाताधारक का नाम')}><Input /></Form.Item></Col>
          <Col xs={24} md={8}>
            <Form.Item name={['payment', 'accountNumber']} label={t('खाता नंबर')} rules={[{ pattern: /^[0-9]{0,20}$/, message: t('सिर्फ़ अंक') }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={['payment', 'ifsc']} label="IFSC" rules={[{ pattern: /^([A-Za-z]{4}0[A-Za-z0-9]{6})?$/, message: 'SBIN0001234' }]}>
              <Input style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}><Form.Item name={['payment', 'bankName']} label={t('बैंक')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={['payment', 'branch']} label={t('शाखा')}><Input /></Form.Item></Col>
        </Row>

        <Divider orientation="left" plain>{t('भुगतान कैसे करें')}</Divider>
        <Row gutter={16}>
          <Col xs={24} md={14}>
            <Form.Item name={['payment', 'instructions']} label={t('तरीक़ा — हर कदम नई लाइन में')}
              extra={t('खाली छोड़ें तो ऐप अपने आसान कदम दिखाएगा')}>
              <Input.TextArea rows={5} placeholder={t('QR स्कैन करें या UPI ऐप खोलें\nराशि जाँचें और भुगतान करें\nUTR / स्क्रीनशॉट WhatsApp पर भेजें')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name={['payment', 'note']} label={t('नीचे दिखने वाला नोट')}>
              <Input.TextArea rows={2} placeholder={t('जैसे: रसीद 2 दिन में आपके एजेंट से मिलेगी।')} />
            </Form.Item>
            <Form.Item name={['payment', 'confirmWhatsapp']} label={t('भुगतान की सूचना किस WhatsApp पर')} extra={t('खाली = सहायता WhatsApp')}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Space wrap>
          <InputNumber min={0} value={previewAmount} onChange={setPreviewAmount} prefix="₹" style={{ width: 140 }} />
          <Button icon={<EyeOutlined />} loading={previewing} onClick={openPreview}>{t('ऐप में कैसा दिखेगा (पहले सहेजें)')}</Button>
        </Space>
      </Card>

      <Card size="small" title={<><MobileOutlined /> {t('सदस्य ऐप लॉगिन')}</>} style={{ marginBottom: 16 }}>
        <Paragraph style={{ marginTop: 0 }}>
          {t('हर नए सदस्य का लॉगिन अपने-आप बनता है — लॉगिन ID = रजिस्ट्रेशन नंबर, पासवर्ड = मोबाइल नंबर। सदस्य बाद में ऐप की सेटिंग्स से पासवर्ड बदल सकता है।')}
        </Paragraph>
        <Paragraph type="secondary">
          {t('पहले जुड़े सदस्यों के लिए नीचे का बटन एक बार चलाएँ। जिनका लॉगिन पहले से है उनका पासवर्ड नहीं बदलता; जिनका मोबाइल नंबर नहीं है वे छोड़ दिए जाते हैं।')}
        </Paragraph>
        <Space wrap>
          <Button onClick={runBackfill} loading={backfill?.running}>{t('पुराने सदस्यों के लॉगिन बनाएँ')}</Button>
          {backfill ? (
            <Text>
              {t('बने')}: <b>{backfill.created}</b> · {t('पहले से')}: <b>{backfill.linked}</b> · {t('छोड़े (मोबाइल नहीं)')}: <b>{backfill.skipped}</b>
              {backfill.remaining ? ` · ${t('बाकी')}: ${backfill.remaining}` : ''}
            </Text>
          ) : null}
        </Space>
      </Card>

      <Card size="small" title={<><PhoneOutlined /> {t('ऐप में संपर्क और परिचय')}</>} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} md={6}><Form.Item name="supportPhone" label={t('सहायता फ़ोन')}><Input /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="supportWhatsapp" label={t('WhatsApp नंबर')}><Input /></Form.Item></Col>
          <Col xs={24} md={6}><Form.Item name="supportEmail" label={t('सहायता ईमेल')} rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24} md={6}><Form.Item name="officeHours" label={t('कार्यालय समय')}><Input placeholder={t('सुबह 10 – शाम 5')} /></Form.Item></Col>
          <Col xs={24}>
            <Form.Item name="aboutText" label={t('ट्रस्ट का परिचय (ऐप में "ट्रस्ट के बारे में")')}>
              <Input.TextArea rows={3} maxLength={1500} />
            </Form.Item>
          </Col>
        </Row>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('खाली छोड़ें तो "ट्रस्ट की जानकारी" वाले फ़ोन और ईमेल दिखेंगे। नाम, पता, पंजीयन वहीं से आते हैं।')}
        </Text>
      </Card>

      <Divider style={{ margin: '8px 0 16px' }} />
      <Button type="primary" htmlType="submit" loading={save.isPending}>{t('सहेजें')}</Button>

      <Modal open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} title={t('ऐप का भुगतान पेज')} width={420}>
        {preview ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {!preview.enabled ? <Alert type="warning" showIcon message={t('अभी ऐप में बंद है — चालू करके सहेजें')} /> : null}
            {preview.qrDataUrl ? (
              <div style={{ textAlign: 'center' }}>
                <Image src={preview.qrDataUrl} width={220} preview={false} />
                <div><Text strong>{preview.payeeName}</Text></div>
                <Text code>{preview.upiId}</Text>
              </div>
            ) : null}
            {preview.qrImageURL ? <Image src={preview.qrImageURL} width={200} /> : null}
            {preview.bank ? (
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label={t('खाताधारक')}>{preview.bank.accountName}</Descriptions.Item>
                <Descriptions.Item label={t('खाता नंबर')}>{preview.bank.accountNumber}</Descriptions.Item>
                <Descriptions.Item label="IFSC">{preview.bank.ifsc}</Descriptions.Item>
                <Descriptions.Item label={t('बैंक')}>{[preview.bank.bankName, preview.bank.branch].filter(Boolean).join(', ')}</Descriptions.Item>
              </Descriptions>
            ) : null}
            {preview.steps?.length ? <ol style={{ paddingLeft: 18, margin: 0 }}>{preview.steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : null}
            {preview.note ? <Text type="secondary">{preview.note}</Text> : null}
          </Space>
        ) : null}
      </Modal>
    </Form>
  );
}
