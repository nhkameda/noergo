import { createPrivateKey, randomBytes } from 'node:crypto';
import { getDb, isUuid } from '@noergo/core/db';
import Provider, { errors, type Configuration } from 'oidc-provider';
import { CIMD_HOSTS, derivedKey, MCP_RESOURCE, PUBLIC_URL } from '../env';
import { KyselyAdapter } from './adapter';

export const SCOPES = ['notes:read', 'notes:write'] as const;

/** PKCS#8 header of an Ed25519 private key; the 32 bytes after it are the seed. */
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * The ID-token signing key, derived from AUTH_SECRET. Agents never ask for ID tokens
 * (`openid` is not offered); the key exists so the provider does not fall back to its
 * public development keys.
 */
function signingJwk() {
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, derivedKey('oidc-signing')]), format: 'der', type: 'pkcs8' });
  return { ...key.export({ format: 'jwk' }), kid: 'noergo-1', alg: 'EdDSA', use: 'sig' };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createProvider(): Provider {
  const secure = PUBLIC_URL.startsWith('https://');
  const config: Configuration = {
    adapter: KyselyAdapter,
    async findAccount(_ctx, sub) {
      if (!isUuid(sub)) return undefined;
      // A blocked account is no account: its refresh tokens stop working too.
      const u = await getDb().selectFrom('users').select('id').where('id', '=', sub).where('deleted_at', 'is', null).where('blocked_at', 'is', null).executeTakeFirst();
      return u ? { accountId: u.id, claims: () => ({ sub: u.id }) } : undefined;
    },
    claims: { openid: ['sub'] },
    scopes: ['offline_access', ...SCOPES],
    responseTypes: ['code'],
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      id_token_signed_response_alg: 'EdDSA',
    },
    clientAuthMethods: ['none', 'client_secret_basic', 'client_secret_post'],
    enabledJWA: { idTokenSigningAlgValues: ['EdDSA'] },
    jwks: { keys: [signingJwk()] },
    cookies: {
      keys: [derivedKey('oidc-cookies').toString('base64url')],
      long: { httpOnly: true, sameSite: 'lax', secure },
      short: { httpOnly: true, sameSite: 'lax', secure },
    },
    pkce: { required: () => true },
    // The reverse proxy sends /oauth/* (but /oauth/interaction/*, the consent page on web)
    // and /.well-known/* here; the issuer is the site itself.
    routes: {
      authorization: '/oauth/authorize',
      token: '/oauth/token',
      registration: '/oauth/register',
      revocation: '/oauth/revoke',
      jwks: '/oauth/jwks',
      end_session: '/oauth/session/end',
      userinfo: '/oauth/userinfo',
      introspection: '/oauth/introspect',
      pushed_authorization_request: '/oauth/par',
      backchannel_authentication: '/oauth/backchannel',
      code_verification: '/oauth/device',
      device_authorization: '/oauth/device/auth',
      challenge: '/oauth/challenge',
      credential: '/oauth/credential',
    },
    interactions: { url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}` },
    // Every authorization shows the consent page, which checks the person signed in to
    // noergo right now: an old grant never approves on its own. Only the grant the consent
    // page just created (this interaction's result) is loaded, or the resume asks again.
    loadExistingGrant: async (ctx) => {
      const grantId = ctx.oidc.result?.consent?.grantId;
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
    // Claude and ChatGPT do not ask for offline_access; a client registered for the
    // refresh_token grant gets refresh tokens anyway (CLAUDE.md, Agents).
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: true,
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 60,
      Interaction: 900,
      Session: 600,
      Grant: 365 * 86_400,
      RefreshToken: 90 * 86_400,
      IdToken: 3600,
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, idFactory: () => `dcr_${randomBytes(16).toString('base64url')}` },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      // /mcp takes Bearer tokens only; a client that bound its token with DPoP would be refused.
      dPoP: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => MCP_RESOURCE,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== MCP_RESOURCE) throw new errors.InvalidTarget();
          return { scope: SCOPES.join(' '), audience: MCP_RESOURCE, accessTokenTTL: 3600, accessTokenFormat: 'opaque' };
        },
      },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch: async (_ctx, clientId) => CIMD_HOSTS.has(new URL(clientId).hostname.toLowerCase()),
      },
    },
    clientBasedCORS: () => false,
    async renderError(ctx, out) {
      ctx.type = 'html';
      ctx.body = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>noergo</title><body style="font:16px system-ui;margin:3rem auto;max-width:36rem;padding:0 1rem"><h1 style="font-size:1.25rem">noergo</h1><p>${escapeHtml(String(out.error ?? 'error'))}${out.error_description ? `: ${escapeHtml(String(out.error_description))}` : ''}</p>`;
    },
  };
  const provider = new Provider(PUBLIC_URL, config);
  provider.proxy = true;
  return provider;
}
