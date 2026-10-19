import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against `next dev` and the development database (npm run db:dev),
 * signing in through the throwaway identity provider in e2e/idp.ts.
 *
 *   npm run db:dev && npm run e2e
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3141);
const MCP_PORT = Number(process.env.E2E_MCP_PORT ?? 3142);
const IDP_PORT = Number(process.env.E2E_IDP_PORT ?? 9311);
const DB_PORT = Number(process.env.NOERGO_DEV_PGPORT ?? 5434);
const BASE = `http://localhost:${WEB_PORT}`;
const MCP = `http://127.0.0.1:${MCP_PORT}`;
const DATABASE_URL = `postgres://noergo_app@127.0.0.1:${DB_PORT}/noergo`;
// A fresh key per run: sessions from an earlier run do not survive it. web and mcp share it,
// as in production (the consent bridge is signed with it).
const AUTH_SECRET = randomBytes(32).toString('base64url');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE, locale: 'en-US', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/idp.ts',
      url: `http://127.0.0.1:${IDP_PORT}/.well-known/openid-configuration`,
      env: { E2E_IDP_PORT: String(IDP_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx src/index.ts',
      cwd: 'apps/mcp',
      url: `${MCP}/healthz`,
      reuseExistingServer: false,
      env: { NOERGO_PUBLIC_URL: BASE, DATABASE_URL, AUTH_SECRET, MCP_HOST: '127.0.0.1', MCP_PORT: String(MCP_PORT), MCP_ACCESS: 'all' },
    },
    {
      command: `npx next dev --port ${WEB_PORT}`,
      cwd: 'apps/web',
      url: `${BASE}/healthz`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NOERGO_PUBLIC_URL: BASE,
        DATABASE_URL,
        AUTH_SECRET,
        // One origin for web and mcp, as the reverse proxy gives in production.
        NOERGO_MCP_PROXY: MCP,
        NOERGO_MCP_INTERNAL_URL: MCP,
        MCP_ACCESS: 'all',
        AUTH_OIDC_ISSUER: `http://127.0.0.1:${IDP_PORT}`,
        AUTH_OIDC_ID: 'noergo-e2e',
        AUTH_OIDC_SECRET: 'not-a-secret',
        AUTH_OIDC_NAME: 'Test IdP',
        SIGNUP: 'allowlist',
        SIGNUP_ALLOWLIST: '@noergo.test',
      },
    },
  ],
});
