import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { ensureActor } from './actors';
import { getDb, isUuid, withWorkspace, type Db } from './db';
import type { FocusView, SecuritySeverity } from './db/types';
import { DomainError, notFound } from './errors';
import { personalWorkspaceId } from './workspace';

/**
 * Who may connect agents. `all`: every account (the default of a self-hosted instance).
 * `granted`: administrators and the accounts an administrator enabled (`admin_unlimited`);
 * noergo.com runs this until billing exists.
 */
export type McpAccess = 'all' | 'granted';

export function mcpAccessMode(value: string | undefined): McpAccess {
  const mode = value || 'all';
  if (mode !== 'all' && mode !== 'granted') throw new Error(`MCP_ACCESS must be "all" or "granted", not "${mode}"`);
  return mode;
}

export async function agentAccessAllowed(userId: string, mode: McpAccess, db: Db = getDb()): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const u = await db.selectFrom('users').select(['role', 'admin_unlimited', 'deleted_at']).where('id', '=', userId).executeTakeFirst();
  if (!u || u.deleted_at) return false;
  return mode === 'all' || u.role === 'admin' || u.admin_unlimited;
}

/** An agent at work: an OAuth connection or a personal token, with the actor its changes carry. */
export interface AgentPrincipal {
  kind: 'agent' | 'token';
  /** agent_connections.id or api_tokens.id. */
  id: string;
  userId: string;
  workspaceId: string;
  actorId: string;
  label: string;
  readOnly: boolean;
}

/** last_used_at is written at most this often per connection or token. */
const TOUCH_MS = 5 * 60_000;

// ───────────────────────────── personal tokens

export const TOKEN_PREFIX = 'nrg_';
const TOKEN_SHAPE = /^nrg_[A-Za-z0-9_-]{43}$/;
const MAX_TOKENS = 20;

export const hashToken = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

export function looksLikePersonalToken(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

export interface TokenDto {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface ConnectionDto {
  id: string;
  clientName: string;
  redirectHost: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** A new personal token. The token itself is returned once and never stored; only its hash is. */
export async function createApiToken(userId: string, input: { name: string; readOnly: boolean }, db: Db = getDb()): Promise<{ token: string; info: TokenDto }> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new DomainError('invalid', 'a token needs a name');
  const workspaceId = await personalWorkspaceId(userId, db);
  if (!workspaceId) throw notFound('workspace');
  const active = await db.selectFrom('api_tokens').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', userId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
  if (Number(active.n) >= MAX_TOKENS) throw new DomainError('limit_reached', `at most ${MAX_TOKENS} tokens; revoke one first`);
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const row = await db
    .insertInto('api_tokens')
    .values({ user_id: userId, workspace_id: workspaceId, name, prefix: token.slice(0, 12), token_hash: hashToken(token), read_only: input.readOnly, scopes: input.readOnly ? ['notes:read'] : ['notes:read', 'notes:write'] })
    .returning(['id', 'name', 'prefix', 'read_only', 'created_at', 'last_used_at', 'expires_at'])
    .executeTakeFirstOrThrow();
  return { token, info: { id: row.id, name: row.name, prefix: row.prefix, readOnly: row.read_only, createdAt: iso(row.created_at)!, lastUsedAt: null, expiresAt: iso(row.expires_at) } };
}

/** The principal behind a personal token, or null when it is unknown, revoked, expired or its owner is gone. */
export async function principalFromToken(token: string, db: Db = getDb()): Promise<AgentPrincipal | null> {
  if (!looksLikePersonalToken(token)) return null;
  const t = await db
    .selectFrom('api_tokens as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .select(['t.id', 't.user_id', 't.workspace_id', 't.name', 't.read_only', 't.last_used_at'])
    .where('t.token_hash', '=', hashToken(token))
    .where('t.revoked_at', 'is', null)
    .where((eb) => eb.or([eb('t.expires_at', 'is', null), eb('t.expires_at', '>', new Date())]))
    .where('u.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!t) return null;
  const actorId = await withWorkspace(t.workspace_id, (tx) => ensureActor(tx, t.workspace_id, { kind: 'token', tokenId: t.id, label: t.name }), { db });
  if (!t.last_used_at || Date.now() - new Date(t.last_used_at).getTime() > TOUCH_MS) {
    await db.updateTable('api_tokens').set({ last_used_at: new Date() }).where('id', '=', t.id).execute();
  }
  return { kind: 'token', id: t.id, userId: t.user_id, workspaceId: t.workspace_id, actorId, label: t.name, readOnly: t.read_only };
}

export async function revokeApiToken(userId: string, id: string, db: Db = getDb()): Promise<void> {
  if (!isUuid(id)) throw notFound('token');
  const r = await db.updateTable('api_tokens').set({ revoked_at: new Date() }).where('id', '=', id).where('user_id', '=', userId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!r.numUpdatedRows) throw notFound('token');
}

// ───────────────────────────── OAuth connections

/**
 * Records the connection a person approved on the consent page (one per OAuth grant) and
 * the actor its changes will carry. Approving the same grant again updates it.
 */
export async function recordConnection(
  input: { userId: string; clientId: string; grantId: string; clientName: string; redirectHost: string; scopes: string[]; readOnly: boolean },
  db: Db = getDb(),
): Promise<{ connectionId: string; workspaceId: string }> {
  const workspaceId = await personalWorkspaceId(input.userId, db);
  if (!workspaceId) throw notFound('workspace');
  const values = {
    user_id: input.userId,
    workspace_id: workspaceId,
    client_id: input.clientId.slice(0, 2048),
    grant_id: input.grantId,
    client_name: input.clientName.slice(0, 200),
    redirect_host: input.redirectHost.slice(0, 255),
    scopes: input.scopes,
    read_only: input.readOnly,
  };
  const row = await db
    .insertInto('agent_connections')
    .values(values)
    .onConflict((oc) => oc.column('grant_id').doUpdateSet({ client_name: values.client_name, scopes: values.scopes, read_only: values.read_only, revoked_at: null }).where('agent_connections.user_id', '=', input.userId))
    .returning('id')
    .executeTakeFirst();
  if (!row) throw new DomainError('forbidden', 'grant belongs to someone else');
  await withWorkspace(workspaceId, (tx) => ensureActor(tx, workspaceId, { kind: 'agent', connectionId: row.id, label: values.client_name || 'Agent' }), { db });
  return { connectionId: row.id, workspaceId };
}

/** The principal behind an OAuth grant, or null when the connection was revoked or the account is gone. */
export async function principalFromGrant(grantId: string, accountId: string, db: Db = getDb()): Promise<AgentPrincipal | null> {
  const c = await db
    .selectFrom('agent_connections as c')
    .innerJoin('users as u', 'u.id', 'c.user_id')
    .select(['c.id', 'c.user_id', 'c.workspace_id', 'c.client_name', 'c.read_only', 'c.last_used_at'])
    .where('c.grant_id', '=', grantId)
    .where('c.user_id', '=', accountId)
    .where('c.revoked_at', 'is', null)
    .where('u.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!c) return null;
  const label = c.client_name || 'Agent';
  const actorId = await withWorkspace(c.workspace_id, (tx) => ensureActor(tx, c.workspace_id, { kind: 'agent', connectionId: c.id, label }), { db });
  if (!c.last_used_at || Date.now() - new Date(c.last_used_at).getTime() > TOUCH_MS) {
    await db.updateTable('agent_connections').set({ last_used_at: new Date() }).where('id', '=', c.id).execute();
  }
  return { kind: 'agent', id: c.id, userId: c.user_id, workspaceId: c.workspace_id, actorId, label, readOnly: c.read_only };
}

/** Revokes a connection and drops every token of its grant; the agent is out on its next call. */
export async function revokeConnection(userId: string, id: string, db: Db = getDb()): Promise<void> {
  if (!isUuid(id)) throw notFound('connection');
  const row = await db.updateTable('agent_connections').set({ revoked_at: new Date() }).where('id', '=', id).where('user_id', '=', userId).where('revoked_at', 'is', null).returning('grant_id').executeTakeFirst();
  if (!row) throw notFound('connection');
  await db.deleteFrom('oidc_payloads').where('grant_id', '=', row.grant_id).execute();
}

/**
 * The authorization server ended a grant on its own (a spent refresh token came back, or the
 * agent revoked its token): the connection ends with it, and leaves the person's list.
 */
export async function endConnectionOfGrant(grantId: string, db: Db = getDb()): Promise<{ userId: string; clientName: string } | null> {
  const row = await db.updateTable('agent_connections').set({ revoked_at: new Date() }).where('grant_id', '=', grantId).where('revoked_at', 'is', null).returning(['user_id', 'client_name']).executeTakeFirst();
  return row ? { userId: row.user_id, clientName: row.client_name } : null;
}

export async function listAgentAccess(userId: string, db: Db = getDb()): Promise<{ connections: ConnectionDto[]; tokens: TokenDto[] }> {
  const [connections, tokens] = await Promise.all([
    db.selectFrom('agent_connections').selectAll().where('user_id', '=', userId).where('revoked_at', 'is', null).orderBy('created_at', 'desc').execute(),
    db.selectFrom('api_tokens').select(['id', 'name', 'prefix', 'read_only', 'created_at', 'last_used_at', 'expires_at']).where('user_id', '=', userId).where('revoked_at', 'is', null).orderBy('created_at', 'desc').execute(),
  ]);
  return {
    connections: connections.map((c) => ({ id: c.id, clientName: c.client_name, redirectHost: c.redirect_host, readOnly: c.read_only, createdAt: iso(c.created_at)!, lastUsedAt: iso(c.last_used_at) })),
    tokens: tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, readOnly: t.read_only, createdAt: iso(t.created_at)!, lastUsedAt: iso(t.last_used_at), expiresAt: iso(t.expires_at) })),
  };
}

// ───────────────────────────── what the person has open

/** An open view counts as "open now" for this long after its last heartbeat. */
export const FOCUS_TTL_MS = 10 * 60_000;

export interface Focus {
  view: FocusView;
  boardId: string | null;
  laneId: string | null;
  at: string;
}

/** Stores what a person has on screen. Ids that are not live in the workspace are dropped. */
export async function setFocus(userId: string, workspaceId: string, focus: { view: FocusView; boardId?: string | null; laneId?: string | null }, db: Db = getDb()): Promise<void> {
  await withWorkspace(
    workspaceId,
    async (tx) => {
      const lane = focus.laneId && isUuid(focus.laneId)
        ? await tx.selectFrom('lanes').select(['id', 'board_id']).where('workspace_id', '=', workspaceId).where('id', '=', focus.laneId).where('deleted_at', 'is', null).executeTakeFirst()
        : undefined;
      const board = !lane && focus.boardId && isUuid(focus.boardId)
        ? await tx.selectFrom('boards').select('id').where('workspace_id', '=', workspaceId).where('id', '=', focus.boardId).where('deleted_at', 'is', null).executeTakeFirst()
        : undefined;
      const values = { board_id: lane?.board_id ?? board?.id ?? null, lane_id: lane?.id ?? null, view: focus.view, at: new Date() };
      await tx
        .insertInto('user_focus')
        .values({ workspace_id: workspaceId, user_id: userId, ...values })
        .onConflict((oc) => oc.columns(['workspace_id', 'user_id']).doUpdateSet(values))
        .execute();
    },
    { db },
  );
}

/** What the person has open, if they looked at it in the last ten minutes. */
export async function currentFocus(userId: string, workspaceId: string, db: Db = getDb()): Promise<Focus | null> {
  const row = await withWorkspace(
    workspaceId,
    (tx) => tx.selectFrom('user_focus').selectAll().where('workspace_id', '=', workspaceId).where('user_id', '=', userId).where('at', '>', new Date(Date.now() - FOCUS_TTL_MS)).executeTakeFirst(),
    { db, snapshot: true },
  );
  return row ? { view: row.view, boardId: row.board_id, laneId: row.lane_id, at: new Date(row.at).toISOString() } : null;
}

// ───────────────────────────── security log

export interface SecurityEventInput {
  kind: string;
  severity?: SecuritySeverity;
  reason?: string;
  target?: string;
  ip?: string | null;
  country?: string | null;
  userAgent?: string | null;
  path?: string | null;
  userId?: string | null;
}

/**
 * Records a security event, coalesced per source, kind and hour so a flood is one row with
 * a count. Never throws: losing a log line must not turn a refusal into an error page.
 */
export async function recordSecurityEvent(e: SecurityEventInput, db: Db = getDb()): Promise<void> {
  const ip = e.ip && isIP(e.ip) ? e.ip : null;
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = createHash('sha256').update(`${ip ?? '-'}|${e.userId ?? '-'}|${e.kind}|${hour}`).digest('hex').slice(0, 40);
  const country = e.country && /^[A-Z]{2}$/.test(e.country) ? e.country : null;
  const last = {
    severity: e.severity ?? 'low',
    reason: e.reason?.slice(0, 500) ?? null,
    target: e.target?.slice(0, 300) ?? null,
    ip,
    country,
    user_agent: e.userAgent?.slice(0, 300) ?? null,
    path: e.path?.slice(0, 300) ?? null,
    user_id: e.userId && isUuid(e.userId) ? e.userId : null,
  };
  try {
    await db
      .insertInto('security_events')
      .values({ key, kind: e.kind.slice(0, 80), ...last })
      .onConflict((oc) => oc.column('key').doUpdateSet((eb) => ({ ...last, count: eb('security_events.count', '+', 1), last_at: new Date(), seen_at: null })))
      .execute();
  } catch (err) {
    console.error(`[security] could not record ${e.kind}: ${(err as Error).message}`);
  }
}
