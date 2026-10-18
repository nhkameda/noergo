import { redactText, rateLimit, resetRateLimits } from '@noergo/core';
import { describe, expect, it } from 'vitest';
import { mutationOriginAllowed } from '@/lib/request-origin';
import { safeReturnPath } from '@/lib/return-path';

const ORIGIN = 'https://noergo.example';
const req = (method: string, path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { method, headers });

describe('mutationOriginAllowed', () => {
  it('lets reads and same-origin writes through', () => {
    expect(mutationOriginAllowed(req('GET', '/api/ops', { origin: 'https://evil.example' }), ORIGIN)).toBe(true);
    expect(mutationOriginAllowed(req('POST', '/api/ops', { origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(mutationOriginAllowed(req('POST', '/api/ops', { 'sec-fetch-site': 'same-origin' }), ORIGIN)).toBe(true);
  });

  it('refuses cross-site, null and anonymous writes', () => {
    expect(mutationOriginAllowed(req('POST', '/api/ops', { origin: 'https://evil.example' }), ORIGIN)).toBe(false);
    expect(mutationOriginAllowed(req('DELETE', '/api/ops', { origin: 'null' }), ORIGIN)).toBe(false);
    expect(mutationOriginAllowed(req('POST', '/api/ops'), ORIGIN)).toBe(false);
    expect(mutationOriginAllowed(req('POST', '/api/ops', { 'sec-fetch-site': 'cross-site' }), ORIGIN)).toBe(false);
    // A look-alike origin is not the origin.
    expect(mutationOriginAllowed(req('POST', '/api/ops', { origin: `${ORIGIN}.evil.example` }), ORIGIN)).toBe(false);
  });

  it('exempts only callers that authenticate otherwise', () => {
    expect(mutationOriginAllowed(req('POST', '/api/webhooks/stripe'), ORIGIN)).toBe(true);
    expect(mutationOriginAllowed(req('POST', '/api/auth/callback/oidc'), ORIGIN)).toBe(true);
    expect(mutationOriginAllowed(req('POST', '/api/auth/signout'), ORIGIN)).toBe(false);
  });
});

describe('safeReturnPath', () => {
  it('keeps paths on this site and drops everything else', () => {
    expect(safeReturnPath('/pt/app?board=1', '/en/app')).toBe('/pt/app?board=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', 42, undefined, `/${'a'.repeat(3000)}`]) {
      expect(safeReturnPath(bad, '/en/app')).toBe('/en/app');
    }
  });
});

describe('redactText', () => {
  it('removes credentials, addresses and control characters', () => {
    const out = redactText('Bearer abc.def ana@gmail.com ?code=xyz&state=s nrg_0123456789abcdef \x1b[31mred\x1b[0m\nline eyJhbGciOi.eyJzdWIiOiIx.sig');
    expect(out).not.toMatch(/abc\.def|ana@gmail|xyz|nrg_0123|eyJzdWIiOiIx/);
    expect(out).not.toContain('\x1b');
    expect(out).not.toContain('\n');
  });
});

describe('rateLimit', () => {
  it('counts per identifier inside the window', () => {
    resetRateLimits();
    const limit = { limit: 2, windowSeconds: 60 };
    expect(rateLimit('t:a', limit).ok).toBe(true);
    expect(rateLimit('t:a', limit).ok).toBe(true);
    expect(rateLimit('t:a', limit)).toMatchObject({ ok: false });
    expect(rateLimit('t:b', limit).ok).toBe(true);
  });
});
