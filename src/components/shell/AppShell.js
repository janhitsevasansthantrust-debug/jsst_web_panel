'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Layout, Menu, Avatar, Dropdown, Typography, Grid, Button, Space, Tag, Drawer } from 'antd';
import {
  DashboardOutlined, TeamOutlined, HeartOutlined, WalletOutlined, GroupOutlined,
  UserSwitchOutlined, PercentageOutlined, ProjectOutlined, FileTextOutlined,
  SettingOutlined, LogoutOutlined, MenuOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { signOut } from 'firebase/auth';

import { auth } from '../../lib/firebase/client.js';
import { api } from '../../lib/api.js';
import ProgramSwitcher from './ProgramSwitcher.js';
import LanguageSwitcher from './LanguageSwitcher.js';
import { useT } from '../../i18n/index.js';
import { ROLE, ROLE_RANK } from '../../config/constants.js';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

/**
 * The navigation.
 *
 * `label` is a message KEY, translated at render. Translating here would
 * freeze the words at module-evaluation time, and the language can change
 * while the app is open.
 */
const NAV = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'डैशबोर्ड', min: ROLE.AGENT },
  { key: '/members', icon: <TeamOutlined />, label: 'सदस्य', min: ROLE.AGENT },
  { key: '/closings', icon: <HeartOutlined />, label: 'क्लोजिंग', min: ROLE.AGENT },
  { key: '/collect', icon: <WalletOutlined />, label: 'भुगतान लें', min: ROLE.AGENT },
  { key: '/bulk-collect', icon: <GroupOutlined />, label: 'सामूहिक वसूली', min: ROLE.AGENT },
  { key: '/agents', icon: <UserSwitchOutlined />, label: 'एजेंट', min: ROLE.ADMIN },
  { key: '/yojna', icon: <ProjectOutlined />, label: 'योजना', min: ROLE.ADMIN },
  { key: '/commission', icon: <PercentageOutlined />, label: 'कमीशन', min: ROLE.AGENT },
  { key: '/reports', icon: <FileTextOutlined />, label: 'रिपोर्ट / PDF', min: ROLE.AGENT },
  { key: '/masters', icon: <DatabaseOutlined />, label: 'मास्टर', min: ROLE.ADMIN },
  { key: '/settings', icon: <SettingOutlined />, label: 'सेटिंग्स', min: ROLE.ADMIN },
];

/**
 * The signed-in frame.
 *
 * Two things it deliberately gets right. The sidebar carries the trust's own
 * name and logo, not a product label — this is one trust's system and it
 * should look like it. And on a phone the navigation is a drawer rather than a
 * squeezed 80px rail: a rail of icons whose labels are in Hindi is a rail of
 * riddles.
 */
export default function AppShell({ user, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = useT();

  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.branding(),
    staleTime: 10 * 60 * 1000,
  });
  const b = branding.data?.branding;
  const trustName = b?.nameHi || t('ट्रस्ट प्रबंधन');

  const rank = ROLE_RANK[user?.role] ?? 0;
  const items = NAV.filter((n) => rank >= (ROLE_RANK[n.min] ?? 0)).map((n) => ({
    key: n.key,
    icon: n.icon,
    label: <Link href={n.key} onClick={() => setDrawerOpen(false)}>{t(n.label)}</Link>,
  }));

  // Longest matching prefix, so /members/123 still lights up /members.
  const selected = NAV.map((n) => n.key)
    .filter((key) => pathname.startsWith(key))
    .sort((a, b2) => b2.length - a.length)
    .slice(0, 1);

  async function handleSignOut() {
    // Killing the server session is what actually signs the user out; the
    // Firebase client sign-out is housekeeping and may be unavailable if the
    // client config is incomplete, so it must never block the redirect.
    await api.session.destroy().catch(() => {});
    if (auth) await signOut(auth).catch(() => {});
    router.replace('/login');
    router.refresh();
  }

  const brandBlock = (
    <div className="app-brand">
      {b?.logoURL ? (
        <img src={b.logoURL} alt="" className="app-brand__mark" />
      ) : (
        <div className="app-brand__mark">{trustName.slice(0, 1)}</div>
      )}
      {!(collapsed && !isMobile) && (
        <div className="app-brand__name">{trustName}</div>
      )}
    </div>
  );

  const nav = (
    <Menu
      theme="dark"
      mode="inline"
      className="app-nav"
      selectedKeys={selected}
      items={items}
      style={{ background: 'transparent', borderInlineEnd: 0, paddingTop: 8 }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          className="app-sider"
          theme="dark"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={228}
          collapsedWidth={72}
          style={{ position: 'sticky', top: 0, height: '100vh' }}
        >
          {brandBlock}
          {nav}
        </Sider>
      )}

      {/* On a phone the same navigation, as a drawer. */}
      <Drawer
        placement="left"
        width={252}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        closable={false}
        styles={{
          body: { padding: 0, background: 'var(--sider-bg)' },
          content: { background: 'var(--sider-bg)' },
        }}
      >
        {brandBlock}
        {nav}
      </Drawer>

      <Layout>
        <Header
          className="app-header"
          style={{
            background: 'var(--surface)',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderBottom: '1px solid var(--line)',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <Space size={10}>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setDrawerOpen(true)}
              />
            )}
            {/* Which योजना every screen below is reading and writing. */}
            <ProgramSwitcher compact={isMobile} />
            <LanguageSwitcher compact={isMobile} />
          </Space>

          <Dropdown
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: 'who',
                  label: (
                    <div style={{ lineHeight: 1.35, padding: '2px 0' }}>
                      <div style={{ fontWeight: 600 }}>{user?.name || t('उपयोगकर्ता')}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{user?.email}</Text>
                    </div>
                  ),
                  disabled: true,
                },
                { type: 'divider' },
                {
                  key: 'settings',
                  icon: <SettingOutlined />,
                  label: <Link href="/settings">{t('सेटिंग्स')}</Link>,
                  disabled: rank < ROLE_RANK[ROLE.ADMIN],
                },
                {
                  key: 'out',
                  icon: <LogoutOutlined />,
                  label: t('लॉग आउट'),
                  danger: true,
                  onClick: handleSignOut,
                },
              ],
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
                          padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                          transition: 'background 0.15s ease' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--brand-wash)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Avatar size={34} style={{ background: 'var(--brand)', color: 'var(--brand-contrast)', boxShadow: '0 2px 6px var(--brand-a24)' }}>
                {(user?.name ?? 'U').slice(0, 1).toUpperCase()}
              </Avatar>
              {!isMobile && (
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {user?.name || user?.email}
                  </div>
                  <Tag
                    style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '15px', padding: '0 6px', borderRadius: 6 }}
                    color={roleColor(user?.role)}
                  >
                    {t(roleLabel(user?.role))}
                  </Tag>
                </div>
              )}
            </div>
          </Dropdown>
        </Header>

        <Content
          style={{
            padding: isMobile ? 14 : 26,
            maxWidth: 1720,
            width: '100%',
            marginInline: 'auto',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}

function roleLabel(role) {
  return {
    owner: 'मालिक', admin: 'व्यवस्थापक', operator: 'ऑपरेटर',
    agent: 'एजेंट', member: 'सदस्य',
  }[role] ?? role;
}

function roleColor(role) {
  return {
    owner: 'purple', admin: 'red', operator: 'blue', agent: 'green',
  }[role] ?? 'default';
}
