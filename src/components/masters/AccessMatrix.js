'use client';

import { Table, Tag, Typography, Card, Space, Alert } from 'antd';
import { CheckCircleFilled, MinusOutlined } from '@ant-design/icons';

import { ROLE, ROLE_RANK } from '../../config/constants.js';
import { useT } from '../../i18n/index.js';

const { Text, Paragraph } = Typography;

const ROLE_LABEL = {
  [ROLE.OWNER]: 'मालिक',
  [ROLE.ADMIN]: 'व्यवस्थापक',
  [ROLE.OPERATOR]: 'ऑपरेटर',
  [ROLE.AGENT]: 'एजेंट',
};

/**
 * What each role may do, written out.
 *
 * This is documentation, not configuration — and it is honest about that.
 * The real check is `requireScope(request, ROLE.X)` at the top of every route
 * handler; a per-permission toggle screen would imply this table controls
 * access when it does not, and a screen that lies about what it controls is
 * worse than no screen.
 *
 * The minimum role for each action is taken from the routes themselves, so
 * this table is a reading of the code rather than a second opinion about it.
 */
const ABILITIES = [
  { group: 'सदस्य', label: 'सदस्य सूची देखना', min: ROLE.AGENT,
    note: 'एजेंट को सिर्फ़ अपने सदस्य दिखते हैं' },
  { group: 'सदस्य', label: 'नया सदस्य जोड़ना', min: ROLE.OPERATOR },
  { group: 'सदस्य', label: 'सदस्य की जानकारी बदलना', min: ROLE.OPERATOR },
  { group: 'सदस्य', label: 'सदस्य ब्लॉक करना', min: ROLE.OPERATOR },
  { group: 'सदस्य', label: 'सदस्य हटाना', min: ROLE.ADMIN,
    note: 'जिसका भुगतान हो चुका है उसे कोई नहीं हटा सकता' },

  { group: 'भुगतान', label: 'भुगतान लेना और रसीद बनाना', min: ROLE.AGENT },
  { group: 'भुगतान', label: 'रसीद रद्द करना', min: ROLE.ADMIN,
    note: 'रिकॉर्ड मिटता नहीं — उल्टी प्रविष्टि बनती है' },

  { group: 'क्लोजिंग', label: 'क्लोजिंग सूची देखना', min: ROLE.AGENT },
  { group: 'क्लोजिंग', label: 'नई क्लोजिंग बनाना', min: ROLE.OPERATOR },
  { group: 'क्लोजिंग', label: 'क्लोजिंग वापस लेना', min: ROLE.ADMIN },

  { group: 'एजेंट', label: 'एजेंट सूची और कमीशन देखना', min: ROLE.AGENT,
    note: 'एजेंट को सिर्फ़ अपना' },
  { group: 'एजेंट', label: 'नया एजेंट बनाना', min: ROLE.ADMIN },
  { group: 'एजेंट', label: 'कमीशन का भुगतान करना', min: ROLE.ADMIN },

  { group: 'व्यवस्था', label: 'योजना बनाना और बदलना', min: ROLE.ADMIN },
  { group: 'व्यवस्था', label: 'ट्रस्ट की जानकारी बदलना', min: ROLE.ADMIN },
  { group: 'व्यवस्था', label: 'मास्टर सूचियाँ बदलना', min: ROLE.ADMIN },
  { group: 'व्यवस्था', label: 'टीम सदस्य जोड़ना, भूमिका बदलना', min: ROLE.ADMIN },
  { group: 'व्यवस्था', label: 'मालिक का खाता बदलना', min: ROLE.OWNER },
];

export default function AccessMatrix() {
  const t = useT();
  const roles = [ROLE.OWNER, ROLE.ADMIN, ROLE.OPERATOR, ROLE.AGENT];

  return (
    <>
      <Paragraph type="secondary">
        {t(`भूमिकाएँ सीढ़ी की तरह हैं — ऊपर वाला वह सब कर सकता है जो नीचे वाला कर
सकता है, और कुछ ज़्यादा। किसी को कोई काम देना हो तो उसकी भूमिका
“उपयोगकर्ता” में बदल दें।`)}
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('यह तालिका सिर्फ़ बताती है, तय नहीं करती')}
        description={t(`असली जाँच हर API पर सर्वर में होती है। यहाँ कोई toggle जान-बूझकर नहीं रखा — ऐसा toggle यह भरोसा दिलाता कि पहुँच यहीं से तय होती है, जबकि होती सर्वर में है। भूमिका बदलनी हो तो “उपयोगकर्ता” टैब से बदलें।`)}
      />

      <Space wrap size={8} style={{ marginBottom: 16 }}>
        {roles.map((r) => (
          <Card key={r} size="small" styles={{ body: { padding: '8px 12px' } }}>
            <Space>
              <Tag color={{ owner: 'purple', admin: 'red', operator: 'blue', agent: 'green' }[r]}>
                {t(ROLE_LABEL[r])}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('स्तर {n}', { n: ROLE_RANK[r] })}</Text>
            </Space>
          </Card>
        ))}
      </Space>

      <Table
        rowKey={(r) => `${r.group}:${r.label}`}
        size="small"
        pagination={false}
        dataSource={ABILITIES}
        columns={[
          {
            title: t('काम'),
            dataIndex: 'label',
            render: (label, row) => (
              <div style={{ lineHeight: 1.35 }}>
                <div>{t(label)}</div>
                {row.note && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{t(row.note)}</Text>
                )}
              </div>
            ),
          },
          ...roles.map((role) => ({
            title: t(ROLE_LABEL[role]),
            width: 110,
            align: 'center',
            render: (_, row) =>
              ROLE_RANK[role] >= ROLE_RANK[row.min] ? (
                <CheckCircleFilled style={{ color: 'var(--paid)' }} />
              ) : (
                <MinusOutlined style={{ color: '#d0d0d0' }} />
              ),
          })),
        ]}
        rowClassName={(row, i) =>
          i > 0 && ABILITIES[i - 1].group !== row.group ? 'master-group-start' : ''
        }
      />

      <style>{`
        .master-group-start > td { border-top: 2px solid #f0f0f0 !important; }
      `}</style>
    </>
  );
}
