'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Menu, Row, Col, Grid, Typography, Alert, Tag, Space } from 'antd';
import {
  EnvironmentOutlined, ApartmentOutlined, TeamOutlined, UserOutlined,
  SafetyCertificateOutlined, WalletOutlined, HeartOutlined, IdcardOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import MasterListEditor from '../../../components/masters/MasterListEditor.js';
import AccessMatrix from '../../../components/masters/AccessMatrix.js';
import TeamTab from '../../../components/settings/TeamTab.js';
import { api, keys } from '../../../lib/api.js';
import { MASTER_TYPES, ROLE, ROLE_RANK } from '../../../config/constants.js';
import { useT } from '../../../i18n/index.js';

const { Text } = Typography;

const ICONS = {
  state: <EnvironmentOutlined />,
  district: <ApartmentOutlined />,
  relation: <HeartOutlined />,
  gender: <UserOutlined />,
  jati: <IdcardOutlined />,
  paymentMethod: <WalletOutlined />,
  closingType: <HeartOutlined />,
  designation: <IdcardOutlined />,
};

/**
 * Master — the reference data behind every form, plus who can use the system.
 *
 * These lists used to live in a source file, which meant a trust in a
 * different state needed a code change and a redeploy to add a district. They
 * are data now, edited here.
 *
 * Admin and owner only. Not because the lists are secret, but because they
 * decide what every form offers and what gets written onto member records —
 * a wrong edit here is felt on every screen at once.
 */
export default function MastersPage() {
  const [section, setSection] = useState('state');
  const t = useT();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const session = useQuery({
    queryKey: ['session', 'me'],
    queryFn: () => api.session.me(),
  });
  const role = session.data?.user?.role;
  const allowed = (ROLE_RANK[role] ?? 0) >= ROLE_RANK[ROLE.ADMIN];

  const masters = useQuery({
    queryKey: keys.masters,
    queryFn: () => api.masters.all(),
    enabled: allowed,
  });

  if (session.isLoading) return <PageHeader title={t('मास्टर')} subtitle={t('लोड हो रहा है…')} />;

  if (!allowed) {
    return (
      <>
        <PageHeader title={t('मास्टर')} />
        <Alert
          type="warning"
          showIcon
          message={t('इस पेज के लिए व्यवस्थापक की पहुँच चाहिए')}
          description={t('मास्टर सूचियाँ हर फ़ॉर्म तय करती हैं, इसलिए इन्हें सिर्फ़ व्यवस्थापक और मालिक बदल सकते हैं।')}
        />
      </>
    );
  }

  const listItems = Object.entries(MASTER_TYPES).map(([key, def]) => ({
    key,
    icon: ICONS[key] ?? <DatabaseOutlined />,
    label: (
      <Space size={6}>
        <span>{t(def.label)}</span>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {masters.data?.masters?.[key]?.length ?? ''}
        </Text>
      </Space>
    ),
  }));

  const items = [
    { key: 'lists', type: 'group', label: t('सूचियाँ'), children: listItems },
    {
      key: 'people',
      type: 'group',
      label: t('लोग और पहुँच'),
      children: [
        { key: 'users', icon: <TeamOutlined />, label: t('उपयोगकर्ता') },
        { key: 'access', icon: <SafetyCertificateOutlined />, label: t('पहुँच अधिकार') },
      ],
    },
  ];

  const title = t(
    MASTER_TYPES[section]?.label
      ?? { users: 'उपयोगकर्ता', access: 'पहुँच अधिकार' }[section]
      ?? '',
  );

  return (
    <>
      <PageHeader
        title={t('मास्टर')}
        subtitle={t('फ़ॉर्म की सूचियाँ, उपयोगकर्ता और पहुँच — सब एक जगह')}
        extra={<Tag color="red">{t('व्यवस्थापक')}</Tag>}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={7} lg={5}>
          <Card size="small" styles={{ body: { padding: 4 } }}>
            <Menu
              mode={isMobile ? 'horizontal' : 'inline'}
              selectedKeys={[section]}
              onClick={(e) => setSection(e.key)}
              style={{ borderInlineEnd: 0 }}
              items={items}
            />
          </Card>
        </Col>

        <Col xs={24} md={17} lg={19}>
          <Card title={title}>
            {MASTER_TYPES[section] && <MasterListEditor type={section} />}
            {section === 'users' && <TeamTab />}
            {section === 'access' && <AccessMatrix />}
          </Card>
        </Col>
      </Row>
    </>
  );
}
