import { agentAccessAllowed, looksLikePersonalToken, principalFromGrant, principalFromToken, type AgentPrincipal } from '@noergo/core';
import type Provider from 'oidc-provider';
import { MCP_ACCESS, MCP_RESOURCE } from '../env';

/**
 * Who is calling /mcp: an OAuth access token issued by this provider for the /mcp resource,
 * or a personal token (nrg_…). null for anything else, including revoked connections and
 * tokens: revocation drops the grant's tokens, and the connection row is checked on every call.
 */
export async function principalFromBearer(provider: Provider, bearer: string): Promise<AgentPrincipal | null> {
  if (looksLikePersonalToken(bearer)) return principalFromToken(bearer);
  if (bearer.length > 512) return null;
  const at = await provider.AccessToken.find(bearer);
  if (!at || at.isExpired) return null;
  const aud = Array.isArray(at.aud) ? at.aud : [at.aud];
  if (!aud.includes(MCP_RESOURCE)) return null;
  const principal = await principalFromGrant(at.grantId, at.accountId);
  if (!principal) return null;
  // A token granted only notes:read is read-only even on a connection that may write.
  const scopes = new Set((at.scope ?? '').split(' '));
  return scopes.has('notes:write') ? principal : { ...principal, readOnly: true };
}

const ACCESS_TTL_MS = 60_000;
const accessCache = new Map<string, { allowed: boolean; until: number }>();

/** Whether the account may use agents now (MCP_ACCESS), cached a minute per account. */
export async function accessAllowed(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = accessCache.get(userId);
  if (hit && hit.until > now) return hit.allowed;
  const allowed = await agentAccessAllowed(userId, MCP_ACCESS);
  if (accessCache.size > 10_000) accessCache.clear();
  accessCache.set(userId, { allowed, until: now + ACCESS_TTL_MS });
  return allowed;
}
