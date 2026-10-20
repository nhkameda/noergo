import { afterAll, describe, expect, it } from 'vitest';
import {
  accountDetail,
  adminRevokeConnection,
  adminRevokeToken,
  endAccountSessions,
  isAdmin,
  listAccounts,
  setAccountBlocked,
  setAgentsAllowed,
  updateSettings,
} from '../src/admin';
import { agentAccessAllowed, createApiToken, principalFromGrant, principalFromToken, recordConnection } from '../src/agents';
import { googleIdentity, sessionState, signInFederated, type SignInPolicy } from '../src/identity';
import { newId } from '../src/ids';
import { instanceSettings, resetSettings } from '../src/settings';
import { closePools, newAccount, pools, testDb } from './fixtures';

const OPEN: SignInPolicy = { signup: 'open', allowlist: [], adminEmails: [] };

describe.skipIf(!testDb)('administration', () => {
  afterAll(async () => {
    await resetSettings(pools().app);
    await closePools();
  });

  /** An administrator: role admin and on NOERGO_ADMIN_EMAILS (the env passed along). */
  async function newAdmin(): Promise<{ id: string; env: NodeJS.ProcessEnv }> {
    const { jobs } = pools();
    const { userId } = await newAccount();
    const u = await jobs.updateTable('users').set({ role: 'admin' }).where('id', '=', userId).returning('email').executeTakeFirstOrThrow();
    return { id: userId, env: { NOERGO_ADMIN_EMAILS: `other@example.test, ${u.email.toUpperCase()}` } };
  }

  /** A person who signed in with Google, so sign-in can be tried again. */
  async function newPerson() {
    const identity = googleIdentity({ sub: newId(), email: `${newId()}@gmail.com`, email_verified: true })!;
    const r = await signInFederated(identity, OPEN, 'en', pools().app);
    if (!r.ok) throw new Error(r.reason);
    return { identity, userId: r.userId, epoch: r.sessionEpoch };
  }

  const auditOf = (target: string) => pools().jobs.selectFrom('audit_log').select(['user_id', 'action', 'details']).where('target', '=', target).orderBy('id').execute();

  it('knows an administrator only while they hold the role and stay on the list', async () => {
    const { app } = pools();
    const admin = await newAdmin();
    expect(await isAdmin(admin.id, app, admin.env)).toBe(true);
    expect(await isAdmin(admin.id, app, {})).toBe(false);
    const plain = await newAccount();
    expect(await isAdmin(plain.userId, app, admin.env)).toBe(false);
    expect(await isAdmin('not-a-uuid', app, admin.env)).toBe(false);
    await expect(setAccountBlocked(plain.userId, admin.id, true, app, admin.env)).rejects.toMatchObject({ code: 'forbidden' });
    // Taken off the list, an administrator's next action is refused, before their next sign-in.
    const target = await newAccount();
    await expect(setAgentsAllowed(admin.id, target.userId, true, app, {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists accounts by e-mail or name, taking % and _ literally', async () => {
    const { app, jobs } = pools();
    const tag = newId().slice(-8);
    const literal = await newAccount();
    const lookalike = await newAccount();
    await jobs.updateTable('users').set({ name: `zz${tag}%_x` }).where('id', '=', literal.userId).execute();
    await jobs.updateTable('users').set({ name: `zz${tag}aax` }).where('id', '=', lookalike.userId).execute();
    const found = await listAccounts({ search: `${tag}%_` }, app);
    expect(found.accounts.map((a) => a.id)).toEqual([literal.userId]);
    expect(found.total).toBe(1);
    const both = await listAccounts({ search: `zz${tag}` }, app);
    expect(new Set(both.accounts.map((a) => a.id))).toEqual(new Set([literal.userId, lookalike.userId]));
    expect(await listAccounts({ search: `${tag}%`, page: 2 }, app)).toMatchObject({ accounts: [], page: 2 });
  });

  it('blocks an account out of sessions, sign-in, tokens and connections, and lets it back', async () => {
    const { app } = pools();
    const admin = await newAdmin();
    const p = await newPerson();
    const { token } = await createApiToken(p.userId, { name: 'cli', readOnly: false }, app);
    const grantId = `grant-${newId()}`;
    await recordConnection({ userId: p.userId, clientId: 'dcr_b', grantId, clientName: 'Claude', redirectHost: 'claude.ai', scopes: ['notes:read'], readOnly: true }, app);

    await setAccountBlocked(admin.id, p.userId, true, app, admin.env);
    expect(await sessionState(p.userId, p.epoch, app)).toBeNull();
    expect(await sessionState(p.userId, p.epoch + 1, app)).toBeNull();
    expect(await signInFederated(p.identity, OPEN, 'en', app)).toEqual({ ok: false, reason: 'account_blocked' });
    expect(await principalFromToken(token, app)).toBeNull();
    expect(await principalFromGrant(grantId, p.userId, app)).toBeNull();
    expect(await agentAccessAllowed(p.userId, app, 'all')).toBe(false);
    expect((await listAccounts({ filter: 'blocked', search: p.identity.email! }, app)).accounts.map((a) => a.id)).toEqual([p.userId]);
    // Twice is nothing.
    await setAccountBlocked(admin.id, p.userId, true, app, admin.env);

    await setAccountBlocked(admin.id, p.userId, false, app, admin.env);
    // The session from before the block does not come back; a new sign-in does.
    expect(await sessionState(p.userId, p.epoch, app)).toBeNull();
    expect(await signInFederated(p.identity, OPEN, 'en', app)).toMatchObject({ ok: true, userId: p.userId });
    expect(await principalFromToken(token, app)).not.toBeNull();
    expect(await principalFromGrant(grantId, p.userId, app)).not.toBeNull();

    expect(await auditOf(p.userId)).toEqual([
      { user_id: admin.id, action: 'account.block', details: {} },
      { user_id: admin.id, action: 'account.unblock', details: {} },
    ]);
  });

  it('never blocks the administrator acting, nor anyone on the list', async () => {
    const { app, jobs } = pools();
    const admin = await newAdmin();
    await expect(setAccountBlocked(admin.id, admin.id, true, app, admin.env)).rejects.toMatchObject({ code: 'forbidden' });
    const listed = await newAccount();
    const email = (await jobs.selectFrom('users').select('email').where('id', '=', listed.userId).executeTakeFirstOrThrow()).email;
    const env = { NOERGO_ADMIN_EMAILS: `${admin.env.NOERGO_ADMIN_EMAILS}, ${email}` };
    await expect(setAccountBlocked(admin.id, listed.userId, true, app, env)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await accountDetail(listed.userId, app, env))?.listedAdmin).toBe(true);
    await expect(setAccountBlocked(admin.id, newId(), true, app, admin.env)).rejects.toMatchObject({ code: 'not_found' });
    await expect(setAccountBlocked(admin.id, 'not-a-uuid', true, app, admin.env)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('enables agents account by account, ends sessions and revokes what an account connected', async () => {
    const { app } = pools();
    const admin = await newAdmin();
    const p = await newPerson();
    await setAgentsAllowed(admin.id, p.userId, true, app, admin.env);
    expect(await agentAccessAllowed(p.userId, app, 'granted')).toBe(true);
    await setAgentsAllowed(admin.id, p.userId, false, app, admin.env);
    expect(await agentAccessAllowed(p.userId, app, 'granted')).toBe(false);

    await endAccountSessions(admin.id, p.userId, app, admin.env);
    expect(await sessionState(p.userId, p.epoch, app)).toBeNull();

    const { token, info } = await createApiToken(p.userId, { name: 'cli', readOnly: false }, app);
    const grantId = `grant-${newId()}`;
    const { connectionId } = await recordConnection({ userId: p.userId, clientId: 'dcr_r', grantId, clientName: 'Grok', redirectHost: 'grok.com', scopes: ['notes:read'], readOnly: true }, app);
    const detail = await accountDetail(p.userId, app, admin.env);
    expect(detail).toMatchObject({ id: p.userId, providers: ['google'], listedAdmin: false, agentsAllowed: false });
    expect(detail?.tokens.map((t) => t.id)).toEqual([info.id]);
    expect(detail?.connections.map((c) => c.id)).toEqual([connectionId]);

    // An id of someone else's connection or token is not found through this account.
    const other = await newAccount();
    await expect(adminRevokeToken(admin.id, other.userId, info.id, app, admin.env)).rejects.toMatchObject({ code: 'not_found' });
    await expect(adminRevokeConnection(admin.id, other.userId, connectionId, app, admin.env)).rejects.toMatchObject({ code: 'not_found' });

    await adminRevokeToken(admin.id, p.userId, info.id, app, admin.env);
    await adminRevokeConnection(admin.id, p.userId, connectionId, app, admin.env);
    expect(await principalFromToken(token, app)).toBeNull();
    expect(await principalFromGrant(grantId, p.userId, app)).toBeNull();
    expect((await auditOf(p.userId)).map((a) => a.action)).toEqual(['account.agents_allow', 'account.agents_deny', 'account.end_sessions', 'account.revoke_token', 'account.revoke_connection']);
  });

  it('takes a setting from the administrator, else the environment, else the default', async () => {
    const { app, jobs } = pools();
    const admin = await newAdmin();
    const env = { SIGNUP: 'open', MCP_ACCESS: 'granted' };
    expect(await instanceSettings(app, {})).toMatchObject({ signup: 'allowlist', allowlist: [], agents: 'all', source: { signup: 'default', allowlist: 'default', agents: 'default' } });
    expect(await instanceSettings(app, env)).toMatchObject({ signup: 'open', agents: 'granted', source: { signup: 'env', allowlist: 'default', agents: 'env' } });
    await expect(instanceSettings(app, { SIGNUP: 'opne' })).rejects.toThrow(/SIGNUP/);

    await updateSettings(admin.id, { signup: 'allowlist', allowlist: [' Ana@Example.org ', '@acme.com', '@acme.com'] }, app, admin.env);
    expect(await instanceSettings(app, env)).toMatchObject({ signup: 'allowlist', allowlist: ['ana@example.org', '@acme.com'], agents: 'granted', source: { signup: 'admin', allowlist: 'admin', agents: 'env' } });
    // null hands the setting back to the environment.
    await updateSettings(admin.id, { signup: null }, app, admin.env);
    expect(await instanceSettings(app, env)).toMatchObject({ signup: 'open', source: { signup: 'env' } });
    await expect(updateSettings(admin.id, { allowlist: ['not an address'] }, app, admin.env)).rejects.toThrow();

    const lines = await jobs.selectFrom('audit_log').select(['user_id', 'details']).where('action', '=', 'settings.update').where('user_id', '=', admin.id).orderBy('id').execute();
    expect(lines.map((l) => l.details)).toEqual([{ signup: 'allowlist', signup_allowlist: ['ana@example.org', '@acme.com'] }, { signup: null }]);
    await resetSettings(app);
  });
});
