/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages must run as real Node modules on the server, not be bundled.
  // firebase-admin uses dynamic requires; @react-pdf loads native font parsing.
  serverExternalPackages: [
    'firebase-admin',
    '@react-pdf/renderer',
    'exceljs',
  ],

  // The Devanagari fonts are read with a path built at runtime
  // (src/server/pdf/renderer.js), which the build's file tracer cannot see —
  // so on Vercel every PDF route shipped WITHOUT them and failed with
  // "Devanagari फ़ॉन्ट नहीं मिला: /var/task/src/server/pdf/fonts/…". Listing
  // them here copies them into every API function.
  //
  // Same story inside pdfkit (used by @react-pdf): it loads its built-in fonts
  // through a package-internal alias (`#standard-fonts/Helvetica`) the tracer
  // does not follow, so the function failed with "Cannot find module
  // …/pdfkit/js/standard-fonts/Helvetica.cjs". Its font metrics (js/data) are
  // read from disk the same way.
  outputFileTracingIncludes: {
    '/api/**/*': [
      './src/server/pdf/fonts/*.ttf',
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/pdfkit/js/data/**/*',
    ],
  },

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
