import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { endConnectionOfGrant, LIMITS, rateLimit, recordSecurityEvent } from '@noergo/core';
import { getDb, sql } from '@noergo/core/db';
import { HOST, MCP_RESOURCE, PORT, PUBLIC_ORIGIN, PUBLIC_URL } from './env';
import { clientIp, header, json, readBody } from './http';
import { accessAllowed, principalFromBearer } from './mcp/auth';
import { INSTRUCTIONS, registerTools } from './mcp/tools';
import { interactionBridge } from './oauth/interaction';
import { createProvider, SCOPES } from './oauth/provider';

/**
 * The MCP endpoint and the OAuth 2.1 authorization server for agents. The reverse proxy
 * sends it /mcp, /oauth/* (but /oauth/interaction/*, the consent page on web) and
 * /.well-known/oauth-* and openid-configuration; /internal/* is reachable only from web.
 */
const provider = createProvider();
const oauth = provider.callback();
const VERSION = process.env.NOERGO_VERSION ?? '0.1.0';

const ISSUER = new URL(PUBLIC_URL);
const PRM_PATH = '/.well-known/oauth-protected-resource';
const PRM_URL = `${PUBLIC_URL}${PRM_PATH}/mcp`;
const CHALLENGE = `Bearer resource_metadata="${PRM_URL}", scope="${SCOPES.join(' ')}"`;

const MCP_BODY_MAX = 4 * 1024 * 1024;
const DCR_BODY_MAX = 32 * 1024;
const DCR_PER_HOUR = 20;
const OAUTH_PER_MINUTE = 120;

provider.on('server_error', (_ctx, err) => console.error(`[oauth] ${err.stack ?? err.message}`));

// The provider revokes a whole grant when a spent refresh token is replayed (rotation makes
// that a sign the token leaked) or when the agent revokes its refresh token.
provider.on('grant.revoked', (ctx, grantId: string) => {
  endConnectionOfGrant(grantId)
    .then((c) => {
      if (c && ctx.oidc.route === 'token') {
        return recordSecurityEvent({ kind: 'oauth_refresh_reuse', severity: 'high', userId: c.userId, target: c.clientName.slice(0, 200), ip: clientIp(ctx.req), path: '/oauth/token' });
      }
    })
    .catch((e: unknown) => console.error(`[oauth] grant.revoked: ${(e as Error)?.stack ?? String(e)}`));
});

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * A client registering only loopback redirect URIs is a desktop app (Claude Code, Cursor):
 * it becomes `native`, so any port of the loopback matches (RFC 8252), or the redirect to
 * the port it opens on each sign-in is refused (CLAUDE.md, Agents).
 */
function nativeWhenLoopback(body: Record<string, unknown>): Record<string, unknown> {
  const uris = body.redirect_uris;
  if (body.application_type !== undefined || !Array.isArray(uris) || uris.length === 0) return body;
  const loopbackOnly = uris.every((u) => {
    const url = typeof u === 'string' ? URL.parse(u) : null;
    return url?.protocol === 'http:' && LOOPBACK.has(url.hostname);
  });
  return loopbackOnly ? { ...body, application_type: 'native' } : body;
}

async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ip = clientIp(req);
  const limit = rateLimit(`dcr:${ip ?? 'unknown'}`, { limit: DCR_PER_HOUR, windowSeconds: 3600 });
  if (!limit.ok) {
    void recordSecurityEvent({ kind: 'dcr_rate_limited', severity: 'medium', ip, userAgent: header(req, 'user-agent'), path: '/oauth/register' });
    return json(res, 429, { error: 'too_many_requests' }, { 'retry-after': String(limit.retryAfter) });
  }
  const text = await readBody(req, DCR_BODY_MAX);
  if (text === null) return json(res, 413, { error: 'invalid_client_metadata', error_description: 'request too large' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(res, 400, { error: 'invalid_client_metadata', error_description: 'the body must be JSON' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(res, 400, { error: 'invalid_client_metadata' });
  // The stream is consumed; oidc-provider reads a pre-parsed body from req.body.
  (req as IncomingMessage & { body?: unknown }).body = nativeWhenLoopback(parsed as Record<string, unknown>);
  return oauth(req, res);
}

function protectedResource(res: ServerResponse): void {
  json(
    res,
    200,
    {
      resource: MCP_RESOURCE,
      authorization_servers: [PUBLIC_URL],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'noergo',
      resource_documentation: `${PUBLIC_URL}/agents`,
    },
    { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' },
  );
}

async function mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
  const ip = clientIp(req);
  const origin = header(req, 'origin');
  // Browsers send Origin; a page elsewhere must not drive an agent session (DNS rebinding).
  if (origin && origin !== PUBLIC_ORIGIN) {
    void recordSecurityEvent({ kind: 'mcp_origin_refused', severity: 'medium', target: origin.slice(0, 200), ip, path: '/mcp' });
    return json(res, 403, { error: 'origin_not_allowed' });
  }

  const auth = header(req, 'authorization');
  const bearer = auth?.match(/^Bearer +([^\s]+)$/i)?.[1];
  if (!bearer) return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': CHALLENGE });
  const principal = await principalFromBearer(provider, bearer);
  if (!principal) {
    void recordSecurityEvent({ kind: 'mcp_bearer_refused', severity: 'medium', ip, userAgent: header(req, 'user-agent'), path: '/mcp' });
    return json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': `${CHALLENGE}, error="invalid_token"` });
  }

  const limit = rateLimit(`mcp:${principal.kind}:${principal.id}`, { limit: LIMITS.agentCallsPerMinute, windowSeconds: 60 });
  if (!limit.ok) {
    void recordSecurityEvent({ kind: 'mcp_rate_limited', severity: 'low', ip, userId: principal.userId, target: principal.label.slice(0, 200), path: '/mcp' });
    return json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(limit.retryAfter) });
  }

  const text = await readBody(req, MCP_BODY_MAX);
  if (text === null) return json(res, 413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  }

  // Stateless: one server per request. ChatGPT does not echo Mcp-Session-Id, and nothing
  // here needs a session; who is calling comes from the bearer on every request.
  const server = new McpServer({ name: 'noergo', title: 'noergo', version: VERSION, websiteUrl: PUBLIC_URL }, { instructions: INSTRUCTIONS, capabilities: { tools: {} } });
  registerTools(server, { principal, allowed: await accessAllowed(principal.userId) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = URL.parse(req.url ?? '/', 'http://mcp.internal');
  const path = url?.pathname ?? '/';

  if (path === '/healthz' && req.method === 'GET') {
    try {
      await sql`SELECT 1`.execute(getDb());
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 503, { ok: false });
    }
  }

  if (path === '/mcp') return mcp(req, res);
  if (path === PRM_PATH || path === `${PRM_PATH}/mcp`) return req.method === 'GET' ? protectedResource(res) : json(res, 405, { error: 'method_not_allowed' });

  if (path.startsWith('/internal/interaction/')) {
    const body = req.method === 'POST' ? await readBody(req, 16 * 1024) : '';
    if (body === null) return json(res, 413, { error: 'too_large' });
    return interactionBridge(provider, req, res, path, body);
  }

  const discovery = path === '/.well-known/openid-configuration' || path === '/.well-known/oauth-authorization-server';
  if (discovery || (path.startsWith('/oauth/') && !path.startsWith('/oauth/interaction/'))) {
    const ip = clientIp(req);
    if (!discovery) {
      const limit = rateLimit(`oauth:${ip ?? 'unknown'}`, { limit: OAUTH_PER_MINUTE, windowSeconds: 60 });
      if (!limit.ok) return json(res, 429, { error: 'too_many_requests' }, { 'retry-after': String(limit.retryAfter) });
    }
    // Endpoint URLs come from the issuer, never from the request's Host header.
    req.headers.host = ISSUER.host;
    req.headers['x-forwarded-proto'] = ISSUER.protocol.slice(0, -1);
    delete req.headers['x-forwarded-host'];
    if (path === '/oauth/register' && req.method === 'POST') return register(req, res);
    // RFC 8414 metadata is the OpenID discovery document; the issuer has no path.
    if (path === '/.well-known/oauth-authorization-server') req.url = `/.well-known/openid-configuration${url?.search ?? ''}`;
    return oauth(req, res);
  }

  return json(res, 404, { error: 'not_found' });
}

const server = createServer((req, res) => {
  route(req, res).catch((e: unknown) => {
    console.error(`[mcp] ${req.method} ${req.url?.split('?')[0]}: ${(e as Error)?.stack ?? String(e)}`);
    if (!res.headersSent) json(res, 500, { error: 'internal' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => console.info(JSON.stringify({ mcp: 'listening', host: HOST, port: PORT, issuer: PUBLIC_URL })));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
