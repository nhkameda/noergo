import { revokeApiToken, revokeConnection, type ConnectionDto, type TokenDto, listAgentAccess } from './agents';
import { getDb, isUuid, sql, type Db, type Tx } from './db';
import { DomainError, notFound } from './errors';
import { adminEmails, settingsPatchSchema, type SettingsPatch } from './settings';

/**
 * What an administrator does: the accounts (block, agents, sessions, connections) and the
 * instance's settings. The web checks the administrator before calling (requireAdmin);
 * every write here checks again, in its own transaction, and leaves a line in audit_log.
 */

export const ADMIN_PAGE_SIZE = 50;

export type AccountFilter = 'all' | 'blocked' | 'agents';

export interface AdminAccountRow {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  agentsAllowed: boolean;
  blockedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  providers: string[];
}

export interface AdminAccountDetail extends AdminAccountRow {
  locale: string;
  /** On NOERGO_ADMIN_EMAILS: cannot be blocked from here. */
  listedAdmin: boolean;
  logins: { provider: string; createdAt: string; lastLoginAt: string | null }[];
  connections: ConnectionDto[];
  tokens: TokenDto[];
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** A LIKE pattern that matches the text literally, wherever it appears. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listAccounts(
  input: { search?: string; filter?: AccountFilter; page?: number },
  db: Db = getDb(),
): Promise<{ accounts: AdminAccountRow[]; total: number; page: number; pageSize: number }> {
  const search = (input.search ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.floor(input.page ?? 1)) || 1;
  let q = db.selectFrom('users as u').where('u.deleted_at', 'is', null);
  if (search) q = q.where((eb) => eb.or([eb('u.email', 'ilike', contains(search)), eb('u.name', 'ilike', contains(search))]));
  if (input.filter === 'blocked') q = q.where('u.blocked_at', 'is not', null);
  if (input.filter === 'agents') q = q.where('u.agents_allowed', '=', true);
  const [rows, count] = await Promise.all([
    q
      .leftJoin('accounts as a', 'a.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.name', 'u.role', 'u.agents_allowed', 'u.blocked_at', 'u.created_at'])
      .select((eb) => [eb.fn.max('a.last_login_at').as('last_login_at'), sql<string[]>`coalesce(array_agg(DISTINCT a.provider) FILTER (WHERE a.provider IS NOT NULL), '{}')`.as('providers')])
      .groupBy('u.id')
      .orderBy('u.created_at', 'desc')
      .orderBy('u.id', 'desc')
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE)
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
  ]);
  return {
    accounts: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      agentsAllowed: r.agents_allowed,
      blockedAt: iso(r.blocked_at),
      createdAt: iso(r.created_at)!,
      lastLoginAt: iso(r.last_login_at as Date | null),
      providers: [...r.providers].sort(),
    })),
    total: Number(count.n),
    page,
    pageSize: ADMIN_PAGE_SIZE,
  };
}

export async function accountDetail(userId: string, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<AdminAccountDetail | null> {
  if (!isUuid(userId)) return null;
  const u = await db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'locale', 'agents_allowed', 'blocked_at', 'created_at'])
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!u) return null;
  const [logins, access] = await Promise.all([
    db.selectFrom('accounts').select(['provider', 'created_at', 'last_login_at']).where('user_id', '=', userId).orderBy('created_at').execute(),
    listAgentAccess(userId, db),
  ]);
  const lastLogin = logins.reduce<Date | null>((m, l) => (l.last_login_at && (!m || l.last_login_at > m) ? l.last_login_at : m), null);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    locale: u.locale,
    agentsAllowed: u.agents_allowed,
    blockedAt: iso(u.blocked_at),
    createdAt: iso(u.created_at)!,
    lastLoginAt: iso(lastLogin),
    providers: [...new Set(logins.map((l) => l.provider))].sort(),
    listedAdmin: adminEmails(env).includes(u.email.toLowerCase()),
    logins: logins.map((l) => ({ provider: l.provider, createdAt: iso(l.created_at)!, lastLoginAt: iso(l.last_login_at) })),
    connections: access.connections,
    tokens: access.tokens,
  };
}

/**
 * The person acting is an administrator right now: role admin, not blocked, and still on
 * NOERGO_ADMIN_EMAILS (taken off the list, they lose the admin at once, not at their next
 * sign-in).
 */
export async function isAdmin(userId: string, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const u = await db.selectFrom('users').select(['email', 'role', 'blocked_at', 'deleted_at']).where('id', '=', userId).executeTakeFirst();
  return !!u && u.role === 'admin' && !u.blocked_at && !u.deleted_at && adminEmails(env).includes(u.email.toLowerCase());
}

/** Runs an administrator's write and its audit line in one transaction, after checking the administrator again. */
async function asAdmin<T>(
  adminId: string,
  db: Db,
  env: NodeJS.ProcessEnv,
  fn: (tx: Tx, audit: (action: string, target: string | null, details: Record<string, unknown>) => Promise<void>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    if (!(await isAdmin(adminId, tx, env))) throw new DomainError('forbidden', 'only an administrator can do this');
    return fn(tx, async (action, target, details) => {
      await tx.insertInto('audit_log').values({ user_id: adminId, action, target, details: JSON.stringify(details) }).execute();
    });
  });
}

/** The account an administrator acts on, locked for the rest of the transaction. */
async function targetAccount(tx: Tx, userId: string) {
  if (!isUuid(userId)) throw notFound('account');
  const u = await tx.selectFrom('users').select(['id', 'email', 'blocked_at', 'agents_allowed']).where('id', '=', userId).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
  if (!u) throw notFound('account');
  return u;
}

/**
 * Blocks or unblocks an account. Blocked, the person is out of every session at their next
 * request, and their agents' tokens and connections answer as unknown until unblocked;
 * nothing they wrote is touched. An administrator cannot block themself, nor anyone on
 * NOERGO_ADMIN_EMAILS (that is undone in the environment, where it was granted).
 */
export async function setAccountBlocked(adminId: string, userId: string, blocked: boolean, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await asAdmin(adminId, db, env, async (tx, audit) => {
    const u = await targetAccount(tx, userId);
    if (blocked && (u.id === adminId || adminEmails(env).includes(u.email.toLowerCase()))) throw new DomainError('forbidden', 'an administrator cannot be blocked from here');
    if (!!u.blocked_at === blocked) return;
    await tx
      .updateTable('users')
      .set((eb) => ({
        blocked_at: blocked ? new Date() : null,
        // A session from before the block must not come back when it is lifted.
        session_epoch: blocked ? eb('session_epoch', '+', 1) : eb.ref('session_epoch'),
        updated_at: new Date(),
      }))
      .where('id', '=', u.id)
      .execute();
    await audit(blocked ? 'account.block' : 'account.unblock', u.id, {});
  });
}

/** Lets the account use agents while the instance's agents setting is "granted", or stops it. */
export async function setAgentsAllowed(adminId: string, userId: string, allowed: boolean, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await asAdmin(adminId, db, env, async (tx, audit) => {
    const u = await targetAccount(tx, userId);
    if (u.agents_allowed === allowed) return;
    await tx.updateTable('users').set({ agents_allowed: allowed, updated_at: new Date() }).where('id', '=', u.id).execute();
    await audit(allowed ? 'account.agents_allow' : 'account.agents_deny', u.id, {});
  });
}

/** Ends every session of the account, on every device, at its next request. */
export async function endAccountSessions(adminId: string, userId: string, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await asAdmin(adminId, db, env, async (tx, audit) => {
    const u = await targetAccount(tx, userId);
    await tx
      .updateTable('users')
      .set((eb) => ({ session_epoch: eb('session_epoch', '+', 1), updated_at: new Date() }))
      .where('id', '=', u.id)
      .execute();
    await audit('account.end_sessions', u.id, {});
  });
}

/** Revokes one of the account's agent connections, with every token of its grant. */
export async function adminRevokeConnection(adminId: string, userId: string, connectionId: string, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await asAdmin(adminId, db, env, async (tx, audit) => {
    const u = await targetAccount(tx, userId);
    await revokeConnection(u.id, connectionId, tx);
    await audit('account.revoke_connection', u.id, { connectionId });
  });
}

/** Revokes one of the account's personal tokens. */
export async function adminRevokeToken(adminId: string, userId: string, tokenId: string, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await asAdmin(adminId, db, env, async (tx, audit) => {
    const u = await targetAccount(tx, userId);
    await revokeApiToken(u.id, tokenId, tx);
    await audit('account.revoke_token', u.id, { tokenId });
  });
}

/** Saves what an administrator changed in the settings; null puts a setting back to what the environment says. */
export async function updateSettings(adminId: string, patch: SettingsPatch, db: Db = getDb(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const p = settingsPatchSchema.parse(patch);
  const set = {
    ...(p.signup !== undefined ? { signup: p.signup } : {}),
    ...(p.allowlist !== undefined ? { signup_allowlist: p.allowlist && [...new Set(p.allowlist)] } : {}),
    ...(p.agents !== undefined ? { agents: p.agents } : {}),
    ...(p.storageQuotaBytes !== undefined ? { storage_quota_bytes: p.storageQuotaBytes } : {}),
  };
  if (!Object.keys(set).length) return;
  await asAdmin(adminId, db, env, async (tx, audit) => {
    await tx
      .updateTable('settings')
      .set({ ...set, updated_at: new Date(), updated_by: adminId })
      .execute();
    await audit('settings.update', null, set);
  });
}
