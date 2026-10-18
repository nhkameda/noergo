import { headers } from 'next/headers';

/**
 * The nonce of this request's Content-Security-Policy (set by src/proxy.ts). Reading it
 * also makes the page render per request, which the nonce requires: a prerendered page
 * would carry a stale nonce and the browser would block every script on it.
 */
export async function cspNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
