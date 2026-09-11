import Providers from '../lib/providers.js';
import './globals.css';

export const metadata = {
  title: 'ट्रस्ट प्रबंधन | Trust Management',
  description: 'सदस्य, क्लोजिंग और भुगतान प्रबंधन',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="hi" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
