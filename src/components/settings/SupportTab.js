'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Typography, Space, Tag, Alert } from 'antd';

import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Paragraph, Text } = Typography;

/**
 * Help, and the handful of facts worth knowing when something looks wrong.
 *
 * The two commands below are here rather than buried in the docs because they
 * are what an operator is told to run when a screen disagrees with reality,
 * and nobody reads a repository at that moment.
 */
export default function SupportTab() {
  const t = useT();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.stats({}),
    retry: false,
  });

  const trust = useQuery({ queryKey: keys.trust, queryFn: () => api.trust.get() });

  return (
    <>
      <Card size="small" title={t('सिस्टम की जानकारी')} style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
          <Descriptions.Item label={t('ट्रस्ट')}>
            {trust.data?.trust?.branding?.nameHi || trust.data?.trust?.name || '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('ट्रस्ट आईडी')}>
            <Text code>{trust.data?.trust?.id ?? '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('सर्वर')}>
            {health.isError
              ? <Tag color="red">{t('जवाब नहीं')}</Tag>
              : <Tag color="green">{t('चालू')}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label={t('मोड')}>
            <Tag>{t('एक ट्रस्ट, एक deployment')}</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title={t('कुछ गड़बड़ लगे तो')} style={{ marginBottom: 16 }}>
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>{t('सूची और असली हिसाब अलग दिख रहे हैं?')}</Text> {t('सदस्य अनुक्रमणिका दोबारा बनाएँ — यह कभी नुक़सान नहीं करती:')}
        </Paragraph>
        <pre style={{ background: '#f6f6f6', padding: 10, borderRadius: 6, fontSize: 12 }}>
npm run reindex -- --trust &lt;trustId&gt;
        </pre>

        <Paragraph style={{ marginBottom: 8, marginTop: 16 }}>
          <Text strong>{t('गिनतियाँ (कुल सदस्य, कुल जमा) अटक गई हैं?')}</Text> {t('ये counters हैं; इन्हें दोबारा गिना जा सकता है:')}
        </Paragraph>
        <pre style={{ background: '#f6f6f6', padding: 10, borderRadius: 6, fontSize: 12 }}>
npm run deploy:indexes
        </pre>
      </Card>

      <Alert
        type="info"
        showIcon
        message={t('दूसरे ट्रस्ट को यह सिस्टम देना हो तो')}
        description={
          <Space direction="vertical" size={4}>
            <Text style={{ fontSize: 13 }}>
              {t('नया Firebase project बनाएँ, यही कोड deploy करें, और उसके')}
              <Text code>.env.local</Text> {t('में अपना')} <Text code>TRUST_ID</Text> {t('रखें। फिर "ट्रस्ट की जानकारी" भरकर लोगो अपलोड कर दें — कोड में एक भी बदलाव नहीं।')}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('दोनों ट्रस्ट का डेटा तब अलग-अलग रहता है — यही सबसे बड़ा फ़ायदा है।')}
            </Text>
          </Space>
        }
      />
    </>
  );
}
