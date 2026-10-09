import '../../components/mobile/mobile.css';

/** The member app — a family's own view of their membership and payments. */
export const metadata = {
  title: 'सदस्य ऐप',
  manifest: '/member.webmanifest',
  appleWebApp: { capable: true, title: 'सदस्य', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#7a1f2b',
};

export default function MemberRootLayout({ children }) {
  return children;
}
