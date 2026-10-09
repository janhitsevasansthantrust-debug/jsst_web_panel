import '../../components/mobile/mobile.css';

/**
 * The agent app — a phone-first slice of the system for agents in the field.
 * Installable from the browser ("Add to Home screen") through its manifest.
 */
export const metadata = {
  title: 'एजेंट ऐप',
  manifest: '/agent.webmanifest',
  appleWebApp: { capable: true, title: 'एजेंट', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#7a1f2b',
};

export default function AgentRootLayout({ children }) {
  return children;
}
