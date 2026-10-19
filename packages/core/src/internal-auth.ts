import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Calls between web and mcp on the internal network (the OAuth consent bridge) carry an
 * HMAC over method, path, time and body, with a key derived from AUTH_SECRET. The reverse
 * proxy already refuses /internal/ from outside; this is the second wall.
 */
export const INTERNAL_SIGNATURE_HEADER = 'x-noergo-signature';
const SKEW_S = 60;

function key(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)');
  return Buffer.from(hkdfSync('sha256', secret, 'noergo', 'internal-bridge', 32));
}

function mac(secret: string, method: string, path: string, t: number, body: string): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', key(secret)).update(`${method.toUpperCase()}\n${path}\n${t}\n${digest}`).digest('hex');
}

export function signInternal(secret: string, method: string, path: string, body = '', now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},s=${mac(secret, method, path, t, body)}`;
}

export function verifyInternal(secret: string, header: string | null | undefined, method: string, path: string, body = '', now = Date.now()): boolean {
  const m = /^t=(\d{1,12}),s=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now / 1000 - t) > SKEW_S) return false;
  const expected = Buffer.from(mac(secret, method, path, t, body), 'hex');
  const given = Buffer.from(m[2]!, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
