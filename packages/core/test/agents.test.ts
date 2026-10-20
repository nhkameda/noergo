import { afterAll, describe, expect, it } from 'vitest';
import {
  agentAccessAllowed,
  createApiToken,
  currentFocus,
  endConnectionOfGrant,
  listAgentAccess,
  FOCUS_TTL_MS,
  principalFromGrant,
  principalFromToken,
  recordConnection,
  recordSecurityEvent,
  revokeApiToken,
  revokeConnection,
  setFocus,
} from '../src/agents';
import { newId } from '../src/ids';
import { signInternal, verifyInternal } from '../src/internal-auth';
import { executeAtomic, executeOps } from '../src/ops/execute';
import type { Op } from '../src/ops/schema';
import { changesSince, linkBetween, nodeKindOf, outline, thoughtDetail } from '../src/read';
import { closePools, newAccount, pools, testDb } from './fixtures';

const envelopes = (...ops: Op[]) => ops.map((op) => ({ opId: newId(), op }));

async function firstLane(workspaceId: string) {
  const { jobs } = pools();
  return jobs.selectFrom('lanes').select(['id', 'board_id']).where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').limit(1).executeTakeFirstOrThrow();
}

async function seq(workspaceId: string) {
  return Number((await pools().jobs.selectFrom('workspaces').select('seq').where('id', '=', workspaceId).executeTakeFirstOrThrow()).seq);
}

describe('internal signature (web ↔ mcp)', () => {
  const secret = 'x'.repeat(40);
  const now = 1_800_000_000_000;
  const sig = signInternal(secret, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now);

  it('verifies what it signed, and nothing else', () => {
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now)).toBe(true);
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abc/confirm', '{"a":2}', now)).toBe(false);
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abd/confirm', '{"a":1}', now)).toBe(false);
    expect(verifyInternal(secret, sig, 'GET', '/internal/interaction/abc/confirm', '{"a":1}', now)).toBe(false);
    expect(verifyInternal('y'.repeat(40), sig, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now)).toBe(false);
    expect(verifyInternal(secret, undefined, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now)).toBe(false);
    expect(verifyInternal(secret, `${sig}0`, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now)).toBe(false);
  });

  it('expires after a minute either way', () => {
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now + 59_000)).toBe(true);
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now + 61_000)).toBe(false);
    expect(verifyInternal(secret, sig, 'POST', '/internal/interaction/abc/confirm', '{"a":1}', now - 61_000)).toBe(false);
  });
});

describe.skipIf(!testDb)('agents', () => {
  afterAll(closePools);

  describe('access (settings.agents)', () => {
    it('lets everyone in with "all", and only admins and enabled accounts with "granted"; never a blocked or deleted one', async () => {
      const { app, jobs } = pools();
      const plain = await newAccount();
      const admin = await newAccount();
      const enabled = await newAccount();
      const gone = await newAccount();
      const blocked = await newAccount();
      await jobs.updateTable('users').set({ role: 'admin' }).where('id', '=', admin.userId).execute();
      await jobs.updateTable('users').set({ agents_allowed: true }).where('id', '=', enabled.userId).execute();
      await jobs.updateTable('users').set({ deleted_at: new Date() }).where('id', '=', gone.userId).execute();
      await jobs.updateTable('users').set({ blocked_at: new Date(), agents_allowed: true }).where('id', '=', blocked.userId).execute();
      expect(await agentAccessAllowed(plain.userId, app, 'all')).toBe(true);
      expect(await agentAccessAllowed(plain.userId, app, 'granted')).toBe(false);
      expect(await agentAccessAllowed(admin.userId, app, 'granted')).toBe(true);
      expect(await agentAccessAllowed(enabled.userId, app, 'granted')).toBe(true);
      expect(await agentAccessAllowed(gone.userId, app, 'all')).toBe(false);
      expect(await agentAccessAllowed(blocked.userId, app, 'all')).toBe(false);
      expect(await agentAccessAllowed('not-a-uuid', app, 'all')).toBe(false);
    });
  });

  describe('personal tokens', () => {
    it('are shown once, stored only as a hash, and stop working the moment they are revoked', async () => {
      const { app, jobs } = pools();
      const a = await newAccount();
      const { token, info } = await createApiToken(a.userId, { name: 'Script', readOnly: false }, app);
      expect(token).toMatch(/^nrg_[A-Za-z0-9_-]{43}$/);
      expect(info.prefix).toBe(token.slice(0, 12));
      const row = await jobs.selectFrom('api_tokens').selectAll().where('id', '=', info.id).executeTakeFirstOrThrow();
      expect(JSON.stringify(row)).not.toContain(token.slice(12));

      const p = await principalFromToken(token, app);
      expect(p).toMatchObject({ kind: 'token', id: info.id, userId: a.userId, workspaceId: a.workspaceId, label: 'Script', readOnly: false });
      const actor = await jobs.selectFrom('actors').select(['kind', 'label']).where('id', '=', p!.actorId).executeTakeFirstOrThrow();
      expect(actor).toEqual({ kind: 'token', label: 'Script' });

      expect(await principalFromToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, app)).toBeNull();
      expect(await principalFromToken('nrg_short', app)).toBeNull();

      // Someone else cannot revoke it, and learns nothing.
      const b = await newAccount();
      await expect(revokeApiToken(b.userId, info.id, app)).rejects.toMatchObject({ code: 'not_found' });
      expect(await principalFromToken(token, app)).not.toBeNull();

      await revokeApiToken(a.userId, info.id, app);
      expect(await principalFromToken(token, app)).toBeNull();
    });

    it('read-only tokens carry it, and an account has at most 20', async () => {
      const { app } = pools();
      const a = await newAccount();
      const { token } = await createApiToken(a.userId, { name: 'Reader', readOnly: true }, app);
      expect((await principalFromToken(token, app))?.readOnly).toBe(true);
      await expect(createApiToken(a.userId, { name: '   ', readOnly: false }, app)).rejects.toMatchObject({ code: 'invalid' });
      for (let i = 1; i < 20; i++) await createApiToken(a.userId, { name: `t${i}`, readOnly: false }, app);
      await expect(createApiToken(a.userId, { name: 'one too many', readOnly: false }, app)).rejects.toMatchObject({ code: 'limit_reached' });
    });
  });

  describe('OAuth connections', () => {
    it('resolve to their account and workspace, and revoking drops the grant’s tokens', async () => {
      const { app, jobs } = pools();
      const a = await newAccount();
      const grantId = `grant-${newId()}`;
      const { connectionId, workspaceId } = await recordConnection({ userId: a.userId, clientId: 'dcr_x', grantId, clientName: 'Grok', redirectHost: 'grok.com', scopes: ['notes:read', 'notes:write'], readOnly: false }, app);
      expect(workspaceId).toBe(a.workspaceId);
      await jobs.insertInto('oidc_payloads').values({ id: `at-${newId()}`, type: 'AccessToken', payload: JSON.stringify({ grantId }), grant_id: grantId }).execute();

      expect(await principalFromGrant(grantId, a.userId, app)).toMatchObject({ kind: 'agent', id: connectionId, label: 'Grok', workspaceId: a.workspaceId });
      // A grant is someone's: another account id does not resolve it.
      const b = await newAccount();
      expect(await principalFromGrant(grantId, b.userId, app)).toBeNull();
      await expect(recordConnection({ userId: b.userId, clientId: 'dcr_x', grantId, clientName: 'Evil', redirectHost: 'evil.test', scopes: [], readOnly: false }, app)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(revokeConnection(b.userId, connectionId, app)).rejects.toMatchObject({ code: 'not_found' });

      await revokeConnection(a.userId, connectionId, app);
      expect(await principalFromGrant(grantId, a.userId, app)).toBeNull();
      const left = await jobs.selectFrom('oidc_payloads').select('id').where('grant_id', '=', grantId).execute();
      expect(left).toEqual([]);
    });

    it('end with their grant when the authorization server revokes it, and leave the list', async () => {
      const { app } = pools();
      const a = await newAccount();
      const grantId = `grant-${newId()}`;
      await recordConnection({ userId: a.userId, clientId: 'dcr_y', grantId, clientName: 'Claude', redirectHost: 'claude.ai', scopes: ['notes:read'], readOnly: true }, app);
      expect(await endConnectionOfGrant(grantId, app)).toEqual({ userId: a.userId, clientName: 'Claude' });
      expect(await principalFromGrant(grantId, a.userId, app)).toBeNull();
      expect((await listAgentAccess(a.userId, app)).connections).toEqual([]);
      // Twice is nothing.
      expect(await endConnectionOfGrant(grantId, app)).toBeNull();
    });
  });

  describe('what is open on screen', () => {
    it('keeps a thought of this workspace only, and forgets it after ten minutes', async () => {
      const { app, jobs } = pools();
      const a = await newAccount();
      const b = await newAccount();
      const mine = await firstLane(a.workspaceId);
      const theirs = await firstLane(b.workspaceId);

      await setFocus(a.userId, a.workspaceId, { view: 'map', laneId: mine.id }, app);
      expect(await currentFocus(a.userId, a.workspaceId, app)).toMatchObject({ view: 'map', laneId: mine.id, boardId: mine.board_id });

      await setFocus(a.userId, a.workspaceId, { view: 'map', laneId: theirs.id, boardId: theirs.board_id }, app);
      expect(await currentFocus(a.userId, a.workspaceId, app)).toMatchObject({ laneId: null, boardId: null });

      await jobs.updateTable('user_focus').set({ at: new Date(Date.now() - FOCUS_TTL_MS - 1000) }).where('user_id', '=', a.userId).execute();
      expect(await currentFocus(a.userId, a.workspaceId, app)).toBeNull();
    });
  });

  describe('executeAtomic', () => {
    it('applies all or nothing: a refusal rolls back the ops before it and consumes no seq', async () => {
      const { app } = pools();
      const a = await newAccount();
      const b = await newAccount();
      const lane = await firstLane(a.workspaceId);
      const before = await seq(a.workspaceId);
      const note = newId();
      const r = await executeAtomic(
        a.ctx,
        envelopes({ type: 'note.create', id: note, laneId: lane.id, title: 'first' }, { type: 'note.create', id: newId(), laneId: (await firstLane(b.workspaceId)).id, title: 'elsewhere' }),
        app,
      );
      expect(r).toMatchObject({ ok: false, index: 1, outcome: { error: { code: 'not_found' } } });
      expect(await nodeKindOf(a.workspaceId, note, app)).toBeNull();
      expect(await seq(a.workspaceId)).toBe(before);
    });

    it('gives one seq per op, in order, and refuses read-only connections', async () => {
      const { app } = pools();
      const a = await newAccount();
      const lane = await firstLane(a.workspaceId);
      const before = await seq(a.workspaceId);
      const x = newId();
      const r = await executeAtomic(a.ctx, envelopes({ type: 'note.create', id: x, laneId: lane.id, title: 'x' }, { type: 'link.create', id: newId(), from: { kind: 'lane', id: lane.id }, to: { kind: 'note', id: x } }), app);
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect(r.outcomes.map((o) => o.seq)).toEqual([before + 1, before + 2]);
      expect(await linkBetween(a.workspaceId, { kind: 'note', id: x }, { kind: 'lane', id: lane.id }, app)).not.toBeNull();

      const ro = await executeAtomic({ ...a.ctx, actorKind: 'agent', readOnly: true }, envelopes({ type: 'note.create', id: newId(), laneId: lane.id, title: 'no' }), app);
      expect(ro).toMatchObject({ ok: false, outcome: { error: { code: 'read_only_connection' } } });
    });
  });

  describe('reads for agents', () => {
    it('answer not_found for a thought of another workspace, and changes say who made them', async () => {
      const { app } = pools();
      const a = await newAccount();
      const b = await newAccount();
      const theirs = await firstLane(b.workspaceId);
      await expect(thoughtDetail(a.workspaceId, theirs.id, app)).rejects.toMatchObject({ code: 'not_found' });
      expect(await nodeKindOf(a.workspaceId, theirs.id, app)).toBeNull();
      expect((await outline(a.workspaceId, app)).flatMap((x) => x.thoughts.map((t) => t.id))).not.toContain(theirs.id);

      const { token } = await createApiToken(a.userId, { name: 'Grok', readOnly: false }, app);
      const p = (await principalFromToken(token, app))!;
      const since = await seq(a.workspaceId);
      const lane = await firstLane(a.workspaceId);
      await executeOps({ workspaceId: a.workspaceId, actorId: p.actorId, actorKind: 'token' }, envelopes({ type: 'note.create', id: newId(), laneId: lane.id, title: 'from the agent' }), app);
      const page = await changesSince(a.workspaceId, since, 10, app);
      if (page.reset) throw new Error('reset');
      expect(page.changes[0]!.actor).toEqual({ kind: 'token', label: 'Grok' });
    });
  });

  describe('security log', () => {
    it('folds a flood from one source into one row with a count', async () => {
      const { app, jobs } = pools();
      const kind = `test_${newId()}`;
      await recordSecurityEvent({ kind, severity: 'high', ip: '203.0.113.9', path: '/mcp' }, app);
      await recordSecurityEvent({ kind, severity: 'high', ip: '203.0.113.9', path: '/mcp' }, app);
      await recordSecurityEvent({ kind, ip: 'not an ip' }, app);
      const rows = await jobs.selectFrom('security_events').select(['count', 'severity', 'ip']).where('kind', '=', kind).orderBy('count', 'desc').execute();
      expect(rows.map((r) => ({ count: r.count, severity: r.severity, ip: r.ip }))).toEqual([
        { count: 2, severity: 'high', ip: '203.0.113.9' },
        { count: 1, severity: 'low', ip: null },
      ]);
    });
  });
});
