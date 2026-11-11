import type Provider from 'oidc-provider';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePools, testDb } from '../../../packages/core/test/fixtures';
import type {} from '../../../packages/core/test/global-setup';

// Client.find asks the adapter first: point core's default pool at the test database.
if (testDb) process.env.DATABASE_URL = testDb.appUrl;
process.env.AUTH_SECRET ??= 'test-secret-'.padEnd(48, 'x');

/** ChatGPT's Client ID Metadata Document as https://chatgpt.com/oauth/client.json served it on 2026-11-12. */
const CHATGPT = {
  client_id: 'https://chatgpt.com/oauth/client.json',
  client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};

/** The documents the stubbed network serves, by URL. */
const documents = new Map<string, object>([
  [CHATGPT.client_id, CHATGPT],
  // A client that can only sign its token requests: nothing here verifies them.
  ['https://chatgpt.com/oauth/signed-only.json', { ...CHATGPT, client_id: 'https://chatgpt.com/oauth/signed-only.json', token_endpoint_auth_methods_supported: ['private_key_jwt'] }],
  // A public client that predates the choices list, as Claude's documents do.
  ['https://claude.ai/oauth/client.json', { client_id: 'https://claude.ai/oauth/client.json', client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }],
]);

describe.skipIf(!testDb)('OAuth clients identified by a metadata document', () => {
  let provider: Provider;

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const doc = documents.get(String(url));
      return doc ? Response.json(doc) : new Response('not found', { status: 404 });
    });
    const { createProvider } = await import('../src/oauth/provider');
    provider = createProvider();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await closePools();
  });

  it('ChatGPT, which prefers private_key_jwt, becomes a public client with PKCE', async () => {
    const client = await provider.Client.find(CHATGPT.client_id);
    expect(client).toBeDefined();
    expect(client!.metadata()).toMatchObject({
      client_id: CHATGPT.client_id,
      client_name: 'ChatGPT',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: CHATGPT.redirect_uris,
    });
    expect(client!.metadata()).not.toHaveProperty('token_endpoint_auth_signing_alg');
    // The refresh_token grant is what issueRefreshToken looks at (CLAUDE.md, Agents).
    expect(client!.grantTypeAllowed('refresh_token')).toBe(true);
  });

  it('a client whose only method is one this server does not accept is still refused', async () => {
    await expect(provider.Client.find('https://chatgpt.com/oauth/signed-only.json')).rejects.toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('a document with only the singular method keeps working', async () => {
    const client = await provider.Client.find('https://claude.ai/oauth/client.json');
    expect(client!.metadata()).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none' });
  });
});
