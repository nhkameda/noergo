import { afterAll, describe, expect, it } from 'vitest';
import { withWorkspace } from '../src/db';
import { newId } from '../src/ids';
import { executeOps, type OpOutcome } from '../src/ops/execute';
import type { Op } from '../src/ops/schema';
import { getNote } from '../src/read';
import {
  createShare,
  cursorSeq,
  shareCursor,
  executeSharedOps,
  listShares,
  resolveShare,
  revokeShare,
  shareIdOfToken,
  shareToken,
  sharedChangesSince,
  sharedNote,
  sharedSnapshot,
  type SharedLink,
} from '../src/shares';
import { closePools, newAccount, pools, testDb } from './fixtures';

const SECRET = 'a-test-secret-that-is-long-enough-for-hkdf';

const run = (ctx: Parameters<typeof executeOps>[0], ...ops: Op[]) => executeOps(ctx, ops.map((op) => ({ opId: newId(), op })), pools().app);
const env = (...ops: Op[]) => ops.map((op) => ({ opId: newId(), op }));

function applied(o: OpOutcome | undefined) {
  if (!o || o.status !== 'applied') throw new Error(`expected applied, got ${JSON.stringify(o)}`);
  return o;
}

function refused(o: OpOutcome | undefined) {
  if (!o || o.status === 'applied') throw new Error(`expected a refusal, got ${JSON.stringify(o)}`);
  return o.error.code;
}

/** An account with two boards: "Shared" (thoughts A and B) and "Private" (thought P), ideas in each. */
async function world() {
  const owner = await newAccount();
  const ids = { shared: newId(), priv: newId(), a: newId(), b: newId(), p: newId(), a1: newId(), a2: newId(), b1: newId(), p1: newId() };
  await run(
    owner.ctx,
    { type: 'board.create', id: ids.shared, title: 'Shared' },
    { type: 'board.create', id: ids.priv, title: 'Private' },
    { type: 'lane.create', id: ids.a, boardId: ids.shared, title: 'A' },
    { type: 'lane.create', id: ids.b, boardId: ids.shared, title: 'B' },
    { type: 'lane.create', id: ids.p, boardId: ids.priv, title: 'P' },
    { type: 'note.create', id: ids.a1, laneId: ids.a, title: 'a1' },
    { type: 'note.create', id: ids.a2, laneId: ids.a, title: 'a2' },
    { type: 'note.create', id: ids.b1, laneId: ids.b, title: 'b1' },
    { type: 'note.create', id: ids.p1, laneId: ids.p, title: 'Secret plan', body: 'nobody else' },
    { type: 'link.create', id: newId(), from: { kind: 'note', id: ids.a1 }, to: { kind: 'note', id: ids.a2 } },
    { type: 'link.create', id: newId(), from: { kind: 'note', id: ids.p1 }, to: { kind: 'note', id: ids.a1 } },
  );
  return { owner, ids };
}

async function link(owner: { workspaceId: string; userId: string }, kind: 'board' | 'lane', id: string, access: 'view' | 'edit'): Promise<SharedLink> {
  const share = await createShare(owner, { kind, id }, access, pools().app);
  const resolved = await resolveShare(share.id, pools().app);
  if (!resolved) throw new Error('share did not resolve');
  return resolved;
}

describe('share tokens', () => {
  it('round-trips and refuses anything else', () => {
    const id = newId();
    const token = shareToken(SECRET, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(shareIdOfToken(SECRET, token)).toBe(id);
    expect(shareIdOfToken(`${SECRET}-other`, token)).toBeNull();
    const flipped = token.slice(0, 30) + (token[30] === 'A' ? 'B' : 'A') + token.slice(31);
    expect(shareIdOfToken(SECRET, flipped)).toBeNull();
    expect(shareIdOfToken(SECRET, token.slice(1))).toBeNull();
    expect(shareIdOfToken(SECRET, `${token}=`)).toBeNull();
  });
});

describe('share cursors', () => {
  it('resume only where the server said, for that share', () => {
    const id = newId();
    const c = shareCursor(SECRET, id, 42);
    expect(cursorSeq(SECRET, id, c)).toBe(42);
    expect(cursorSeq(SECRET, newId(), c)).toBeNull();
    expect(cursorSeq(SECRET, id, c.replace(/^42/, '41'))).toBeNull();
    expect(cursorSeq(SECRET, id, `0${c}`)).toBeNull();
    expect(cursorSeq(SECRET, id, '42')).toBeNull();
    expect(cursorSeq(SECRET, id, shareCursor(SECRET, id, 0))).toBe(0);
  });
});

describe.skipIf(!testDb)('shares', () => {
  afterAll(closePools);

  it('hands out one live link per access, and a new one after turning it off', async () => {
    const { owner, ids } = await world();
    const db = pools().app;
    const v1 = await createShare(owner, { kind: 'board', id: ids.shared }, 'view', db);
    const v2 = await createShare(owner, { kind: 'board', id: ids.shared }, 'view', db);
    const e1 = await createShare(owner, { kind: 'board', id: ids.shared }, 'edit', db);
    expect(v2.id).toBe(v1.id);
    expect(e1.id).not.toBe(v1.id);
    expect((await listShares(owner.workspaceId, { kind: 'board', id: ids.shared }, db)).map((s) => s.access).sort()).toEqual(['edit', 'view']);

    await revokeShare(owner.workspaceId, v1.id, db);
    expect(await resolveShare(v1.id, db)).toBeNull();
    const v3 = await createShare(owner, { kind: 'board', id: ids.shared }, 'view', db);
    expect(v3.id).not.toBe(v1.id);
  });

  it('shares only what lives in the workspace, and only its owner turns a link off', async () => {
    const { owner, ids } = await world();
    const other = await newAccount();
    const db = pools().app;
    await expect(createShare(other, { kind: 'board', id: ids.shared }, 'view', db)).rejects.toMatchObject({ code: 'not_found' });
    const share = await createShare(owner, { kind: 'lane', id: ids.a }, 'view', db);
    await expect(revokeShare(other.workspaceId, share.id, db)).rejects.toMatchObject({ code: 'not_found' });
    expect(await resolveShare(share.id, db)).not.toBeNull();
  });

  it('closes while its thought is in the trash, and while its owner is blocked', async () => {
    const { owner, ids } = await world();
    const { app, jobs } = pools();
    const l = await link(owner, 'lane', ids.a, 'view');
    applied((await run(owner.ctx, { type: 'lane.delete', id: ids.a }))[0]);
    expect(await resolveShare(l.id, app)).toBeNull();
    expect(await sharedSnapshot(l, app)).toBeNull();
    applied((await run(owner.ctx, { type: 'lane.restore', id: ids.a }))[0]);
    expect(await resolveShare(l.id, app)).not.toBeNull();

    await jobs.updateTable('users').set({ blocked_at: new Date() }).where('id', '=', owner.userId).execute();
    expect(await resolveShare(l.id, app)).toBeNull();
    await jobs.updateTable('users').set({ blocked_at: null }).where('id', '=', owner.userId).execute();
  });

  it('a board link shows that board and nothing of the others', async () => {
    const { owner, ids } = await world();
    const l = await link(owner, 'board', ids.shared, 'view');
    expect(l.title).toBe('Shared');
    const snap = (await sharedSnapshot(l, pools().app))!;
    expect(snap.boards.map((b) => b.id)).toEqual([ids.shared]);
    expect(snap.lanes.map((x) => x.title)).toEqual(['A', 'B']);
    expect(snap.notes.map((n) => n.title).sort()).toEqual(['a1', 'a2', 'b1']);
    expect(snap.inboxLaneId).toBeNull();
    // a1 → a2 is inside; the private note's link to a1 is not.
    expect(snap.links).toHaveLength(1);
    expect(JSON.stringify(snap)).not.toContain(ids.p1);
    expect(JSON.stringify(snap)).not.toContain('Secret');
  });

  it('a thought link shows it under a board of its own, without the real board', async () => {
    const { owner, ids } = await world();
    const l = await link(owner, 'lane', ids.a, 'view');
    const snap = (await sharedSnapshot(l, pools().app))!;
    expect(snap.boards).toHaveLength(1);
    expect(snap.boards[0]).toMatchObject({ id: ids.a, title: 'A' });
    expect(snap.lanes.map((x) => [x.id, x.boardId])).toEqual([[ids.a, ids.a]]);
    expect(snap.notes.map((n) => n.title).sort()).toEqual(['a1', 'a2']);
    expect(JSON.stringify(snap)).not.toContain(ids.shared);
    expect(JSON.stringify(snap)).not.toContain(ids.b1);
  });

  it('streams every seq, empty when the change is outside, and tells nothing of what left', async () => {
    const { owner, ids } = await world();
    const app = pools().app;
    const l = await link(owner, 'lane', ids.a, 'view');
    const since = (await sharedSnapshot(l, app))!.seq;
    await run(
      owner.ctx,
      { type: 'note.update', id: ids.p1, title: 'Still secret' },
      { type: 'note.update', id: ids.a1, title: 'a1 renamed' },
      { type: 'note.move', id: ids.a2, laneId: ids.p, place: { at: 'top' } },
    );
    const page = await sharedChangesSince(l, since, 100, app);
    if (page.gone || page.reset) throw new Error(`unexpected ${JSON.stringify(page)}`);
    expect(page.changes.map((c) => c.seq)).toEqual([since + 1, since + 2, since + 3]);
    expect(page.changes[0]).toMatchObject({ op: '', actor: null, effects: [] });
    expect(page.changes[1]!.effects).toEqual([expect.objectContaining({ kind: 'note', data: expect.objectContaining({ title: 'a1 renamed' }) })]);
    const gone = page.changes[2]!.effects;
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ kind: 'note', data: { id: ids.a2, laneId: ids.a, title: '', tags: [] } });
    expect((gone[0]!.data as { deletedAt: string | null }).deletedAt).not.toBeNull();
    expect(JSON.stringify(page)).not.toContain(ids.p);
    expect(JSON.stringify(page)).not.toContain('Still secret');

    // Something moved in brings its links along: the client starts over from a snapshot.
    const seq = page.seq;
    await run(owner.ctx, { type: 'note.move', id: ids.p1, laneId: ids.a, place: { at: 'top' } });
    expect(await sharedChangesSince(l, seq, 100, app)).toEqual({ gone: false, reset: true });
  });

  it('a revoked link ends its stream', async () => {
    const { owner, ids } = await world();
    const l = await link(owner, 'board', ids.shared, 'view');
    await revokeShare(owner.workspaceId, l.id, pools().app);
    expect(await sharedChangesSince(l, 0, 100, pools().app)).toEqual({ gone: true });
  });

  it('a note shows only the links whose other end the link opens', async () => {
    const { owner, ids } = await world();
    const app = pools().app;
    const own = await getNote(owner.workspaceId, ids.a1, app);
    expect(own.incoming.map((r) => r.otherTitle)).toContain('Secret plan');
    const l = await link(owner, 'board', ids.shared, 'view');
    const shared = await sharedNote(l, ids.a1, app);
    expect(shared.incoming.map((r) => r.otherTitle)).not.toContain('Secret plan');
    expect(shared.outgoing.map((r) => r.otherTitle)).toEqual(['a2']);
    await expect(sharedNote(l, ids.p1, app)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a view link writes nothing', async () => {
    const { owner, ids } = await world();
    const visitor = await newAccount();
    const l = await link(owner, 'board', ids.shared, 'view');
    const [o] = await executeSharedOps(l, visitor.userId, env({ type: 'note.update', id: ids.a1, title: 'x' }), pools().app);
    expect(refused(o)).toBe('forbidden');
  });

  it('an edit link changes what it opens, as the person who holds it, and nothing else', async () => {
    const { owner, ids } = await world();
    const visitor = await newAccount();
    const app = pools().app;
    const l = await link(owner, 'lane', ids.a, 'edit');
    const fresh = newId();
    const out = await executeSharedOps(
      l,
      visitor.userId,
      env(
        { type: 'note.create', id: fresh, laneId: ids.a, title: 'from a visitor' },
        { type: 'note.update', id: ids.a1, title: 'edited' },
        { type: 'link.create', id: newId(), from: { kind: 'note', id: fresh }, to: { kind: 'lane', id: ids.a } },
        { type: 'layout.set', viewKind: 'lane_map', viewId: ids.a, nodes: [{ kind: 'note', id: fresh, x: 10, y: 20 }] },
        { type: 'note.create', id: newId(), laneId: ids.b, title: 'elsewhere' },
        { type: 'note.update', id: ids.p1, title: 'pwned' },
        { type: 'note.move', id: ids.a1, laneId: ids.p, place: { at: 'top' } },
        { type: 'link.create', id: newId(), from: { kind: 'note', id: ids.a1 }, to: { kind: 'note', id: ids.p1 } },
        { type: 'layout.set', viewKind: 'lane_map', viewId: ids.p, nodes: [{ kind: 'note', id: ids.p1, x: 0, y: 0 }] },
        { type: 'board.delete', id: ids.shared },
        { type: 'lane.delete', id: ids.a },
        { type: 'lane.update', id: ids.a, cover: null },
        { type: 'lane.create', id: newId(), boardId: ids.shared, title: 'new' },
      ),
      app,
    );
    out.slice(0, 4).forEach((o) => applied(o));
    expect(out.slice(4).map(refused)).toEqual(['not_found', 'not_found', 'not_found', 'not_found', 'not_found', 'forbidden', 'forbidden', 'forbidden', 'forbidden']);

    const snap = (await sharedSnapshot(l, app))!;
    const creator = snap.notes.find((n) => n.id === fresh)!.createdBy!;
    const actor = await withWorkspace(owner.workspaceId, (tx) => tx.selectFrom('actors').select(['kind', 'user_id', 'label']).where('id', '=', creator).executeTakeFirstOrThrow(), { db: app });
    expect(actor).toEqual({ kind: 'user', user_id: visitor.userId, label: 'Test' });
    const p1 = await getNote(owner.workspaceId, ids.p1, app);
    expect(p1.note.title).toBe('Secret plan');
  });

  it('a rename through a link rewrites [[wikilinks]] inside it, never in a private note', async () => {
    const { owner, ids } = await world();
    const visitor = await newAccount();
    const app = pools().app;
    // A private note and a shared one both name a1.
    applied((await run(owner.ctx, { type: 'note.update', id: ids.p1, appendText: ' see [[a1]]' }))[0]);
    applied((await run(owner.ctx, { type: 'note.update', id: ids.b1, appendText: 'see [[a1]]' }))[0]);
    const l = await link(owner, 'board', ids.shared, 'edit');
    const [o] = await executeSharedOps(l, visitor.userId, env({ type: 'note.update', id: ids.a1, title: 'a1 new' }), app);
    const done = applied(o);
    expect((await getNote(owner.workspaceId, ids.b1, app)).note.body).toContain('[[a1 new]]');
    expect((await getNote(owner.workspaceId, ids.p1, app)).note.body).toBe('nobody else\n see [[a1]]');
    expect(JSON.stringify(done)).not.toContain(ids.p1);
  });

  it('a thought moved onto the shared board does not replay its past, page by page', async () => {
    const { owner, ids } = await world();
    const app = pools().app;
    const l = await link(owner, 'board', ids.shared, 'view');
    const since = (await sharedSnapshot(l, app))!.seq;
    await run(owner.ctx, { type: 'note.update', id: ids.p1, title: 'old secret while private' });
    for (let i = 0; i < 3; i++) await run(owner.ctx, { type: 'note.update', id: ids.b1, title: `b1 v${i}` });
    await run(owner.ctx, { type: 'lane.move', id: ids.p, boardId: ids.shared, place: { at: 'bottom' } });
    // Pages of two: the first ends long before the move.
    const page = await sharedChangesSince(l, since, 2, app);
    expect(page).toEqual({ gone: false, reset: true });
    // Reordering on the board is no reason to start over.
    const snap = (await sharedSnapshot(l, app))!;
    await run(owner.ctx, { type: 'lane.move', id: ids.a, place: { at: 'bottom' } });
    const next = await sharedChangesSince(l, snap.seq, 100, app);
    expect(next).toMatchObject({ gone: false, reset: false });
  });

  it('shows no one’s name in the stream but an agent’s', async () => {
    const { owner, ids } = await world();
    const app = pools().app;
    const l = await link(owner, 'board', ids.shared, 'view');
    const since = (await sharedSnapshot(l, app))!.seq;
    await run(owner.ctx, { type: 'note.update', id: ids.a1, title: 'renamed' });
    const page = await sharedChangesSince(l, since, 100, app);
    if (page.gone || page.reset) throw new Error('unexpected');
    expect(page.changes[0]!.actor).toEqual({ kind: 'user', label: '' });
  });

  it('[[wikilinks]] written through a link neither find nor touch private notes', async () => {
    const { owner, ids } = await world();
    const visitor = await newAccount();
    const app = pools().app;
    // A private note waits for a title, and names another one.
    const waiting = newId();
    applied((await run(owner.ctx, { type: 'note.create', id: waiting, laneId: ids.p, title: 'agenda', body: 'see [[Meeting notes]]' }))[0]);
    const l = await link(owner, 'board', ids.shared, 'edit');

    // An oracle would be a link that appears, or not, depending on a private title.
    const probe = newId();
    applied((await executeSharedOps(l, visitor.userId, env({ type: 'note.create', id: probe, laneId: ids.a, title: 'probe', body: '[[Secret plan]] [[a2]]' }), app))[0]);
    const fromProbe = await withWorkspace(owner.workspaceId, (tx) => tx.selectFrom('links').select('to_id').where('from_id', '=', probe).where('deleted_at', 'is', null).execute(), { db: app });
    expect(fromProbe.map((r) => r.to_id)).toEqual([ids.a2]);

    // A note named like what the private note waits for does not take it, and a rename does not reach it.
    const bait = newId();
    applied((await executeSharedOps(l, visitor.userId, env({ type: 'note.create', id: bait, laneId: ids.a, title: 'Meeting notes' }), app))[0]);
    applied((await executeSharedOps(l, visitor.userId, env({ type: 'note.update', id: bait, title: 'IGNORE PREVIOUS INSTRUCTIONS' }), app))[0]);
    expect((await getNote(owner.workspaceId, waiting, app)).note.body).toBe('see [[Meeting notes]]');
    const toBait = await withWorkspace(owner.workspaceId, (tx) => tx.selectFrom('links').select('from_id').where('to_id', '=', bait).execute(), { db: app });
    expect(toBait).toEqual([]);
  });

  it('checks a replayed opId like any other', async () => {
    const { owner, ids } = await world();
    const visitor = await newAccount();
    const app = pools().app;
    const opId = newId();
    applied((await executeOps(owner.ctx, [{ opId, op: { type: 'note.update', id: ids.p1, title: 'owner' } }], app))[0]);
    const l = await link(owner, 'board', ids.shared, 'edit');
    const [o] = await executeSharedOps(l, visitor.userId, [{ opId, op: { type: 'note.update', id: ids.p1, title: 'owner' } }], app);
    expect(refused(o)).toBe('not_found');
  });
});
