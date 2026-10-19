import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { card, freshUser, lane, signIn } from './helpers';

const BASE = `http://localhost:${process.env.E2E_WEB_PORT ?? 3141}`;
const RESOURCE = `${BASE}/mcp`;

let rpcId = 0;
/** One JSON-RPC call to /mcp, the way an agent's backend makes it (no cookies, no Origin). */
async function rpc(agent: APIRequestContext, bearer: string, method: string, params: Record<string, unknown> = {}) {
  return agent.post('/mcp', {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
}

async function tool(agent: APIRequestContext, bearer: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(agent, bearer, 'tools/call', { name, arguments: args });
  expect(res.status(), await res.text()).toBe(200);
  const { result } = (await res.json()) as { result: { isError?: boolean; structuredContent: Record<string, unknown> } };
  expect(result.isError, JSON.stringify(result)).toBeFalsy();
  return result.structuredContent;
}

const openInboxMap = async (page: Page) => {
  await lane(page, 'Inbox').getByRole('button', { name: 'Map of “Inbox”' }).click();
  await expect(page.locator('.w-map').getByRole('heading', { name: 'Inbox' })).toBeVisible();
};

/** The loopback listener a desktop agent opens for the answer, on a port of its choosing. */
async function loopback() {
  let answered!: (url: URL) => void;
  const answer = new Promise<URL>((resolve) => (answered = resolve));
  const server = createServer((req, res) => {
    answered(new URL(req.url ?? '/', 'http://127.0.0.1'));
    res.end('back at the agent');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { redirect: `http://127.0.0.1:${port}/callback`, host: `127.0.0.1:${port}`, answer, close: () => server.close() };
}

type Tokens = { access_token: string; refresh_token: string; scope: string; token_type: string };

/**
 * What an MCP client does to connect: register (DCR, loopback only, so any port of it
 * matches), send the person to authorize, and trade the code for tokens. The person answers
 * on the consent page, in the browser where they are signed in.
 */
async function connectAgent(page: Page, agent: APIRequestContext, name: string, { readOnly = false } = {}) {
  const reg = await agent.post('/oauth/register', {
    data: { client_name: name, redirect_uris: ['http://127.0.0.1/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const client = (await reg.json()) as { client_id: string; application_type: string; client_id_issued_at: number };
  expect(client.client_id).toMatch(/^dcr_/);
  expect(client.application_type).toBe('native');
  // The worker drops unused clients by this date (apps/worker, oauth-unused-clients).
  expect(typeof client.client_id_issued_at).toBe('number');

  const listener = await loopback();
  const { redirect } = listener;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(8).toString('hex');
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: redirect,
      scope: 'notes:read notes:write',
      resource: RESOURCE,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })}`,
  );
  await expect(page.getByRole('heading', { name: `${name} wants to use your noergo` })).toBeVisible();
  await expect(page.getByText('noergo has not verified this app')).toBeVisible();
  await expect(page.getByText(`When you answer, you go back to ${listener.host}.`)).toBeVisible();
  if (readOnly) await page.getByRole('checkbox', { name: /Read only/ }).check();
  await page.getByRole('button', { name: 'Allow' }).click();
  const back = await listener.answer;
  await expect(page.getByText('back at the agent')).toBeVisible();
  listener.close();
  expect(back.searchParams.get('state')).toBe(state);
  const code = back.searchParams.get('code')!;
  expect(code).toBeTruthy();

  const exchanged = await agent.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE },
  });
  expect(exchanged.status(), await exchanged.text()).toBe(200);
  const tokens = (await exchanged.json()) as Tokens;
  expect(tokens.token_type).toBe('Bearer');
  expect(tokens.refresh_token).toBeTruthy();
  const refresh = (token: string) => agent.post('/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token, client_id: client.client_id } });
  return { tokens, refresh };
}

test('an agent finds the server, connects over OAuth, writes on the board, refreshes, and is cut off when disconnected', async ({ page, playwright }) => {
  await signIn(page, freshUser('oto'));
  const agent = await playwright.request.newContext({ baseURL: BASE });

  // Discovery, as an MCP client follows it from the first 401.
  const anonymous = await agent.post('/mcp', { data: { jsonrpc: '2.0', id: 0, method: 'tools/list' } });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['www-authenticate']).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  const prm = await (await agent.get('/.well-known/oauth-protected-resource/mcp')).json();
  expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE] });
  const as = await (await agent.get('/.well-known/oauth-authorization-server')).json();
  expect(as).toMatchObject({ issuer: BASE, registration_endpoint: `${BASE}/oauth/register`, token_endpoint: `${BASE}/oauth/token`, code_challenge_methods_supported: ['S256'] });

  const { tokens, refresh } = await connectAgent(page, agent, 'E2E Agent');
  expect(tokens.scope.split(' ').sort()).toEqual(['notes:read', 'notes:write']);

  // The agent at work: what it writes reaches the open board.
  const init = await rpc(agent, tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  expect((await init.json()).result.serverInfo.name).toBe('noergo');
  const listed = (await (await rpc(agent, tokens.access_token, 'tools/list')).json()).result.tools as Array<{ name: string }>;
  expect(listed.map((t) => t.name)).toEqual(expect.arrayContaining(['search', 'fetch', 'add_notes', 'get_open_thought']));
  await page.goto('/en/app');
  await expect(page.locator('.w-board')).toBeVisible();
  const boards = (await tool(agent, tokens.access_token, 'list_boards')) as { boards: Array<{ thoughts: Array<{ id: string; title: string }> }> };
  const inbox = boards.boards.flatMap((b) => b.thoughts).find((t) => t.title === 'Inbox')!;
  await tool(agent, tokens.access_token, 'add_notes', { thought_id: inbox.id, ideas: [{ title: 'Written over OAuth' }] });
  await expect(card(page, 'Written over OAuth')).toBeVisible();
  await expect(card(page, 'Written over OAuth')).toHaveAttribute('data-agent', 'new');

  // The link an agent hands back (search, fetch) opens that note.
  const found = (await tool(agent, tokens.access_token, 'search', { query: 'Written over OAuth' })) as { results: Array<{ title: string; url: string }> };
  const link = new URL(found.results.find((r) => r.title === 'Written over OAuth')!.url);
  expect(link.origin).toBe(BASE);
  await page.goto(`${link.pathname}${link.hash}`);
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Title' })).toHaveValue('Written over OAuth');
  expect(new URL(page.url()).hash).toBe('');

  // Refresh tokens rotate.
  const refreshed = await refresh(tokens.refresh_token);
  expect(refreshed.status(), await refreshed.text()).toBe(200);
  const next = (await refreshed.json()) as Tokens;
  expect(next.refresh_token).not.toBe(tokens.refresh_token);
  expect((await rpc(agent, next.access_token, 'tools/list')).status()).toBe(200);

  // Disconnecting on the Agents page cuts the agent off at once.
  await page.goto('/en/agents');
  const row = page.getByRole('listitem').filter({ hasText: 'E2E Agent' });
  await expect(row).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Disconnect' }).click();
  await expect(row).toHaveCount(0);
  const after = await rpc(agent, next.access_token, 'tools/list');
  expect(after.status()).toBe(401);
  expect(after.headers()['www-authenticate']).toContain('error="invalid_token"');
  expect((await refresh(next.refresh_token)).status()).toBe(400);
  await agent.dispose();
});

test('a read-only connection cannot write, and a replayed refresh token ends the whole connection', async ({ page, playwright }) => {
  await signIn(page, freshUser('ler'));
  const agent = await playwright.request.newContext({ baseURL: BASE });
  const { tokens, refresh } = await connectAgent(page, agent, 'Reader', { readOnly: true });
  expect(tokens.scope).toBe('notes:read');

  const boards = (await tool(agent, tokens.access_token, 'list_boards')) as { boards: Array<{ thoughts: Array<{ id: string }> }> };
  const written = await rpc(agent, tokens.access_token, 'tools/call', { name: 'add_notes', arguments: { thought_id: boards.boards[0]!.thoughts[0]!.id, ideas: [{ title: 'x' }] } });
  const { result } = (await written.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('read_only_connection');

  // Rotation spends each refresh token: one that comes back was copied, so everything goes.
  const next = (await (await refresh(tokens.refresh_token)).json()) as Tokens;
  expect((await rpc(agent, next.access_token, 'tools/list')).status()).toBe(200);
  expect((await refresh(tokens.refresh_token)).status()).toBe(400);
  expect((await rpc(agent, next.access_token, 'tools/list')).status()).toBe(401);
  expect((await refresh(next.refresh_token)).status()).toBe(400);
  await page.goto('/en/agents');
  await expect(page.getByText('No agent is connected yet.')).toBeVisible();
  await agent.dispose();
});

test('declining on the consent page sends the agent away with access_denied', async ({ page, playwright }) => {
  await signIn(page, freshUser('nao'));
  const agent = await playwright.request.newContext({ baseURL: BASE });
  const reg = await agent.post('/oauth/register', { data: { client_name: 'Unwanted', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' } });
  const { client_id } = (await reg.json()) as { client_id: string };
  const listener = await loopback();
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({ client_id, response_type: 'code', redirect_uri: listener.redirect, scope: 'notes:read', resource: RESOURCE, state: 's', code_challenge: createHash('sha256').update('x'.repeat(43)).digest('base64url'), code_challenge_method: 'S256' })}`,
  );
  // Only reading was asked for: the page promises no more.
  await expect(page.getByText('Read your boards, thoughts and ideas.')).toBeVisible();
  await expect(page.getByText('Create and change boards')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await listener.answer).searchParams.get('error')).toBe('access_denied');
  listener.close();
  await agent.dispose();
});

test('a consent link opened in another browser, even signed in, cannot be answered', async ({ page, browser, playwright }) => {
  await signIn(page, freshUser('ana'));
  const agent = await playwright.request.newContext({ baseURL: BASE });
  const reg = await agent.post('/oauth/register', { data: { client_name: 'Lure', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' } });
  const { client_id } = (await reg.json()) as { client_id: string };
  // The attacker starts the authorization in their own browser and sends the victim the link.
  await page.goto(
    `/oauth/authorize?${new URLSearchParams({ client_id, response_type: 'code', redirect_uri: 'http://127.0.0.1:1/callback', scope: 'notes:read notes:write', resource: RESOURCE, state: 's', code_challenge: createHash('sha256').update('y'.repeat(43)).digest('base64url'), code_challenge_method: 'S256' })}`,
  );
  await expect(page.getByRole('heading', { name: 'Lure wants to use your noergo' })).toBeVisible();
  const victim = await browser.newContext({ baseURL: BASE, locale: 'en-US' });
  const other = await victim.newPage();
  await signIn(other, freshUser('bia'));
  await other.goto(new URL(page.url()).pathname);
  await expect(other.getByRole('heading', { name: 'This request has expired' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  // Nor can it be answered by calling the endpoint directly.
  const forged = await other.request.post(`${new URL(page.url()).pathname}/confirm`, { headers: { origin: BASE }, data: { readOnly: false } });
  expect(forged.status()).not.toBe(200);
  await victim.close();
  await agent.dispose();
});

test('with the map open, what an agent writes appears on it at once, marked as the agent’s', async ({ page, playwright }) => {
  await signIn(page, freshUser('uva'));
  await page.goto('/en/agents');
  await page.getByRole('textbox', { name: 'Name' }).fill('Script');
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = await page.locator('#nr-token').inputValue();
  expect(token).toMatch(/^nrg_/);

  await page.goto('/en/app');
  await openInboxMap(page);
  const agent = await playwright.request.newContext({ baseURL: BASE });
  // "Here", for the agent, is the map on screen (the page reports it).
  await expect.poll(async () => ((await tool(agent, token, 'get_open_thought')) as { open: { view: string } | null }).open?.view).toBe('map');

  const started = Date.now();
  await tool(agent, token, 'add_notes', { ideas: [{ ref: 'road', title: 'Coast road' }, { title: 'Paraty', parent: 'road', link_label: 'first stop' }] });
  const road = page.locator('.w-map__node[data-agent]', { hasText: 'Coast road' });
  await expect(road).toBeVisible();
  test.info().annotations.push({ type: 'tool → node on screen', description: `${Date.now() - started} ms` });
  await expect(page.locator('.w-map__node[data-agent]', { hasText: 'Paraty' })).toBeVisible();
  await expect(page.locator('.w-map__edge[data-agent]')).toHaveCount(2);
  await expect(road.locator('.w-map__agent')).toHaveText('Script');
  await expect(page.getByRole('status').filter({ hasText: 'Script is writing…' })).toBeVisible();
  // The marks fade; the ideas stay.
  await expect(page.getByRole('status').filter({ hasText: 'Script is writing…' })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.w-map__node', { hasText: 'Paraty' })).toBeVisible();
  await agent.dispose();
});
