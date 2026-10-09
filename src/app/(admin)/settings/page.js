'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Menu, Row, Col, Typography, Grid, Tag, Space, Avatar } from 'antd';
import {
  BankOutlined, TeamOutlined, AppstoreOutlined, SafetyOutlined,
  CustomerServiceOutlined, MobileOutlined, BellOutlined,
} from '@ant-design/icons';

import PageHeader from '../../../components/ui/PageHeader.js';
import OrganizationTab from '../../../components/settings/OrganizationTab.js';
import TeamTab from '../../../components/settings/TeamTab.js';
import SecurityTab from '../../../components/settings/SecurityTab.js';
import GroupsTab from '../../../components/settings/GroupsTab.js';
import SupportTab from '../../../components/settings/SupportTab.js';
import MobileAppTab from '../../../components/settings/MobileAppTab.js';
import NotificationsTab from '../../../components/settings/NotificationsTab.js';
import { api, keys } from '../../../lib/api.js';
import { useT } from '../../../i18n/index.js';

const { Text, Title } = Typography;

const SECTIONS = [
  {
    key: 'organization',
    icon: <BankOutlined />,
    label: 'ट्रस्ट की जानकारी',
    hint: 'नाम, पता, लोगो, मुहर, रसीद हेडर',
  },
  {
    key: 'team',
    icon: <TeamOutlined />,
    label: 'टीम सदस्य',
    hint: 'कौन लॉग इन कर सकता है',
  },
  {
    key: 'groups',
    icon: <AppstoreOutlined />,
    label: 'यूनिट / समूह',
    hint: 'सदस्यों की दरें तय करने वाले समूह',
  },
  {
    key: 'mobile',
    icon: <MobileOutlined />,
    label: 'मोबाइल ऐप',
    hint: 'रखरखाव स्क्रीन, ऐप अपडेट, संपर्क नंबर',
  },
  {
    key: 'notify',
    icon: <BellOutlined />,
    label: 'सूचनाएँ (ऐप)',
    hint: 'सदस्यों और एजेंटों के फ़ोन पर सूचना भेजें',
  },
  {
    key: 'security',
    icon: <SafetyOutlined />,
    label: 'सुरक्षा',
    hint: 'अपना पासवर्ड बदलें',
  },
  {
    key: 'support',
    icon: <CustomerServiceOutlined />,
    label: 'सहायता',
    hint: 'मदद और सिस्टम की जानकारी',
  },
];

/**
 * Settings — the same shape as the old screen: a menu down the left, one
 * section at a time on the right.
 *
 * One difference that matters: this edits THE trust. There is no "add
 * organization" here, because this deployment serves exactly one trust.
 * Handing the system to another trust means another deployment with its own
 * Firebase project and its own `TRUST_ID` — not a second record inside this
 * one. Two trusts in one database share a blast radius, and every screen would
 * have to carry a "which trust" question nobody in the office ever asks.
 */
export default function SettingsPage() {
  const [section, setSection] = useState('organization');
  const t = useT();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const trust = useQuery({ queryKey: keys.trust, queryFn: () => api.trust.get() });
  const branding = trust.data?.trust?.branding;

  const active = SECTIONS.find((s) => s.key === section);

  return (
    <>
      <PageHeader title={t('सेटिंग्स')} subtitle={active?.hint ? t(active.hint) : undefined} />

      {/* Whose trust this is — stated once, plainly, so it is obvious that the
          whole app is about one organisation and not a list of them. */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space size={12}>
          <Avatar
            size={44}
            src={branding?.logoURL || undefined}
            icon={<BankOutlined />}
            style={{ background: branding?.theme?.primary ?? 'var(--brand)' }}
          />
          <div style={{ lineHeight: 1.35 }}>
            <Title level={5} style={{ margin: 0 }}>
              {branding?.nameHi || trust.data?.trust?.name || t('ट्रस्ट')}
            </Title>
            <Space size={6} wrap>
              {branding?.registrationNo && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('पंजी.')} {branding.registrationNo}
                </Text>
              )}
              <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('एकल ट्रस्ट')}</Tag>
            </Space>
          </div>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={7} lg={6}>
          <Card size="small" styles={{ body: { padding: isMobile ? 8 : 4 } }}>
            <Menu
              mode={isMobile ? 'horizontal' : 'inline'}
              selectedKeys={[section]}
              onClick={(e) => setSection(e.key)}
              style={{ borderInlineEnd: 0 }}
              items={SECTIONS.map((s) => ({
                key: s.key,
                icon: s.icon,
                label: t(s.label),
              }))}
            />
          </Card>
        </Col>

        <Col xs={24} md={17} lg={18}>
          <Card>
            {section === 'organization' && <OrganizationTab />}
            {section === 'team' && <TeamTab />}
            {section === 'groups' && <GroupsTab />}
            {section === 'mobile' && <MobileAppTab />}
            {section === 'notify' && <NotificationsTab />}
            {section === 'security' && <SecurityTab />}
            {section === 'support' && <SupportTab />}
          </Card>
        </Col>
      </Row>
    </>
  );
}
