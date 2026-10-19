import { INTERNAL_SIGNATURE_HEADER, mcpAccessMode, signInternal } from '@noergo/core';

/** Where web reaches mcp on the internal network (never through the public proxy). */
const MCP_INTERNAL_URL = (process.env.NOERGO_MCP_INTERNAL_URL ?? 'http://127.0.0.1:3042').replace(/\/+$/, '');

/** Who may connect agents (MCP_ACCESS): everyone, or admins and the accounts they enable. */
export const MCP_ACCESS = mcpAccessMode(process.env.MCP_ACCESS);

export const INTERACTION_UID = /^[A-Za-z0-9_-]{10,64}$/;

/** What the consent page shows (apps/mcp src/oauth/interaction.ts). */
export interface InteractionView {
  uid: string;
  client: { id: string; name: string; uri: string | null; metadataDocument: boolean };
  redirectHost: string;
  wantsWrite: boolean;
}

/**
 * Only oidc-provider's interaction cookie (and its signature) travels to mcp: the session
 * cookie of noergo stays here.
 */
export function interactionCookies(cookieHeader: string | null): string {
  return (cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => /^_interaction(?:\.sig)?=/.test(c))
    .join('; ');
}

/** A signed call to mcp's internal interaction API. */
export async function interactionBridge<T>(method: 'GET' | 'POST', path: string, cookies: string, body = ''): Promise<{ status: number; data: T | null }> {
  const secret = process.env.AUTH_SECRET ?? '';
  const res = await fetch(`${MCP_INTERNAL_URL}${path}`, {
    method,
    headers: {
      [INTERNAL_SIGNATURE_HEADER]: signInternal(secret, method, path, body),
      cookie: cookies,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'POST' ? body : undefined,
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? ((await res.json()) as T) : null;
  return { status: res.status, data };
}
