import { hkdfSync } from 'node:crypto';
import { envSettings } from '@noergo/core';

/** The public URL of this instance (the OAuth issuer), without a trailing slash. */
export const PUBLIC_URL = (process.env.NOERGO_PUBLIC_URL ?? 'http://localhost:3041').replace(/\/+$/, '');
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;

/** The protected resource: the one audience access tokens are issued for. */
export const MCP_RESOURCE = `${PUBLIC_URL}/mcp`;

// A typo in SIGNUP or MCP_ACCESS stops the server instead of opening the instance.
envSettings();

export const PORT = Number(process.env.MCP_PORT ?? 3042);
export const HOST = process.env.MCP_HOST ?? '127.0.0.1';

/**
 * Hosts whose Client ID Metadata Documents are fetched (ChatGPT, Claude). Any other client
 * registers dynamically. Fetching only from known hosts keeps the authorization server from
 * being used to reach arbitrary URLs. Empty means the default; `none` turns it off.
 */
export const CIMD_HOSTS = new Set(
  (process.env.MCP_CIMD_HOSTS || 'chatgpt.com,claude.ai,claude.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)');
  return s;
}

/** A key for one purpose, derived from AUTH_SECRET, so no further secret has to be provisioned. */
export function derivedKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', secret(), 'noergo', purpose, length));
}
