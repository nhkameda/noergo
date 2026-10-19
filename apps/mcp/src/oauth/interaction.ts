import type { IncomingMessage, ServerResponse } from 'node:http';
import { agentAccessAllowed, recordConnection, recordSecurityEvent, verifyInternal, INTERNAL_SIGNATURE_HEADER } from '@noergo/core';
import { isUuid } from '@noergo/core/db';
import type Provider from 'oidc-provider';
import { errors } from 'oidc-provider';
import { MCP_ACCESS, MCP_RESOURCE } from '../env';
import { clientIp, json } from '../http';
import { SCOPES } from './provider';

/** What the consent page shows: who is asking, where the answer goes, what they asked for. */
export interface InteractionView {
  uid: string;
  client: { id: string; name: string; uri: string | null; metadataDocument: boolean };
  redirectHost: string;
  wantsWrite: boolean;
}

const UID = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * The internal side of the consent page (apps/web /oauth/interaction/[uid]). web calls it
 * with the browser's interaction cookie, so an interaction can only be answered from the
 * browser that started it, and with an HMAC, so only web can call it at all.
 *
 *   GET  /internal/interaction/:uid           → InteractionView
 *   POST /internal/interaction/:uid/confirm   { userId, readOnly } → { location }
 *   POST /internal/interaction/:uid/abort     → { location }
 */
export async function interactionBridge(provider: Provider, req: IncomingMessage, res: ServerResponse, path: string, body: string): Promise<void> {
  const secret = process.env.AUTH_SECRET ?? '';
  if (!verifyInternal(secret, req.headers[INTERNAL_SIGNATURE_HEADER] as string | undefined, req.method ?? 'GET', path, body)) {
    void recordSecurityEvent({ kind: 'internal_signature_refused', severity: 'high', ip: clientIp(req), path });
    return json(res, 404, { error: 'not_found' });
  }
  const m = /^\/internal\/interaction\/([^/]+)(?:\/(confirm|abort))?$/.exec(path);
  const uid = m?.[1];
  const action = m?.[2];
  if (!uid || !UID.test(uid)) return json(res, 404, { error: 'not_found' });

  let details;
  try {
    details = await provider.interactionDetails(req, res);
  } catch (e) {
    if (e instanceof errors.SessionNotFound) return json(res, 410, { error: 'interaction_expired' });
    throw e;
  }
  if (details.uid !== uid) return json(res, 410, { error: 'interaction_expired' });

  const params = details.params as Record<string, string | undefined>;
  const client = await provider.Client.find(String(params.client_id ?? ''));
  if (!client) return json(res, 410, { error: 'interaction_expired' });
  const redirectHost = URL.parse(String(params.redirect_uri ?? ''))?.host ?? '';
  const requested = String(params.scope ?? '').split(/\s+/).filter(Boolean);

  if (req.method === 'GET' && !action) {
    const view: InteractionView = {
      uid,
      client: { id: client.clientId, name: client.clientName ?? '', uri: client.clientUri ?? null, metadataDocument: client.clientId.startsWith('https://') },
      redirectHost,
      wantsWrite: requested.length === 0 || requested.includes('notes:write'),
    };
    return json(res, 200, view);
  }

  if (req.method === 'POST' && action === 'abort') {
    const location = await provider.interactionResult(req, res, { error: 'access_denied', error_description: 'the person declined' }, { mergeWithLastSubmission: false });
    void recordSecurityEvent({ kind: 'oauth_consent_denied', severity: 'low', target: client.clientId, ip: clientIp(req) });
    return json(res, 200, { location });
  }

  if (req.method === 'POST' && action === 'confirm') {
    let input: { userId?: unknown; readOnly?: unknown };
    try {
      input = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { error: 'invalid' });
    }
    const userId = input.userId;
    if (!isUuid(userId)) return json(res, 400, { error: 'invalid' });
    // web checked it already; the provider checks again, it is the one that issues tokens.
    if (!(await agentAccessAllowed(userId, MCP_ACCESS))) return json(res, 403, { error: 'access_not_granted' });
    const readOnly = input.readOnly === true || !(requested.length === 0 || requested.includes('notes:write'));
    const scopes = readOnly ? ['notes:read'] : ['notes:read', 'notes:write'];

    // The provider compares the grant with the request on resume: what was asked for and
    // not given is rejected explicitly, or it shows the consent page again.
    const grant = new provider.Grant({ accountId: userId, clientId: client.clientId });
    grant.addResourceScope(MCP_RESOURCE, scopes.join(' '));
    grant.addOIDCScope([...scopes, ...(requested.includes('offline_access') ? ['offline_access'] : [])].join(' '));
    const refused = SCOPES.filter((s) => requested.includes(s) && !scopes.includes(s));
    if (refused.length > 0) {
      grant.rejectResourceScope(MCP_RESOURCE, refused.join(' '));
      grant.rejectOIDCScope(refused.join(' '));
    }
    const grantId = await grant.save();
    await recordConnection({ userId, clientId: client.clientId, grantId, clientName: client.clientName ?? redirectHost, redirectHost, scopes, readOnly });
    const location = await provider.interactionResult(req, res, { login: { accountId: userId }, consent: { grantId } }, { mergeWithLastSubmission: false });
    return json(res, 200, { location });
  }

  return json(res, 405, { error: 'method_not_allowed' });
}
