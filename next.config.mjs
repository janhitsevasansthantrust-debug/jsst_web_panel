/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages must run as real Node modules on the server, not be bundled.
  // firebase-admin uses dynamic requires; @react-pdf loads native font parsing.
  serverExternalPackages: [
    'firebase-admin',
    '@react-pdf/renderer',
    'exceljs',
  ],

  // Ant Design and the icon set are huge barrels — this rewrites imports so
  // only the components actually used end up in the bundle.
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons'],
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Devanagari fonts are immutable and large — cache them hard.
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
