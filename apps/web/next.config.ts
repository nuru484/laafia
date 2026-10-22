import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@laafia/core'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
  // The dashboard calls the API on the same origin, so session cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/:path*` }]
  },
}

export default config
