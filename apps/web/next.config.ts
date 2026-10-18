import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Headers for every response. The Content-Security-Policy is per request (src/proxy.ts). */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // The monorepo root, so the standalone output traces the workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@noergo/core', '@noergo/i18n', '@noergo/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // next dev would otherwise write an AGENTS.md here; CLAUDE.md already points agents at
  // the docs bundled in node_modules/next/dist/docs.
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(config);
