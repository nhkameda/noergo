import { afterAll, describe, expect, it } from 'vitest';
import { sql, withWorkspace } from '../src/db';
import { newId } from '../src/ids';
import { executeOps, type OpOutcome } from '../src/ops/execute';
import type { Op } from '../src/ops/schema';
import { changesSince, getNote, search, snapshot } from '../src/read';
import { closePools, newAccount, pools, testDb } from './fixtures';

/** SQLSTATE insufficient_privilege, raised when a row fails a row-level security policy. */
const RLS_VIOLATION = '42501';

const run = (ctx: Parameters<typeof executeOps>[0], ...ops: Op[]) =>
  executeOps(ctx, ops.map((op) => ({ opId: newId(), op })), pools().app);

function applied(o: OpOutcome | undefined) {
  if (!o || o.status !== 'applied') throw new Error(`expected applied, got ${JSON.stringify(o)}`);
  return o;
}

describe.skipIf(!testDb)('database', () => {
  afterAll(closePools);

  describe('row-level security', () => {
    it('returns nothing and refuses writes without a workspace context', async () => {
      await newAccount();
      const { app, jobs } = pools();
      const all = await jobs.selectFrom('notes').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      expect(Number(all.n)).toBeGreaterThan(0);
      const seen = await app.selectFrom('notes').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      expect(Number(seen.n)).toBe(0);
      const lane = await jobs.selectFrom('lanes').select(['id', 'workspace_id']).limit(1).executeTakeFirstOrThrow();
      await expect(
        app.insertInto('notes').values({ id: newId(), workspace_id: lane.workspace_id, lane_id: lane.id, position: 'a0' }).execute(),
      ).rejects.toMatchObject({ code: RLS_VIOLATION });
    });

    it('keeps one workspace out of another, even with a forged workspace_id', async () => {
      const a = await newAccount();
      const b = await newAccount();
      const { app } = pools();
      const rows = await withWorkspace(a.workspaceId, (tx) => tx.selectFrom('notes').select('workspace_id').where('workspace_id', '=', b.workspaceId).execute(), { db: app });
      expect(rows).toEqual([]);
      const laneB = (await snapshot(b.workspaceId, app)).lanes[0]!;
      await expect(
        withWorkspace(a.workspaceId, (tx) => tx.insertInto('notes').values({ id: newId(), workspace_id: b.workspaceId, lane_id: laneB.id, position: 'a0' }).execute(), { db: app }),
      ).rejects.toMatchObject({ code: RLS_VIOLATION });
    });

    it('answers not_found for every op that names an object of another workspace', async () => {
      const a = await newAccount();
      const b = await newAccount();
      const sb = await snapshot(b.workspaceId, pools().app);
      const board = sb.boards[0]!.id;
      const lane = sb.lanes[0]!.id;
      const note = sb.notes[0]!.id;
      const link = sb.links[0]!.id;
      const ops: Op[] = [
        { type: 'board.update', id: board, title: 'x' },
        { type: 'board.move', id: board, place: { at: 'top' } },
        { type: 'board.delete', id: board },
        { type: 'lane.create', id: newId(), boardId: board, title: 'x' },
        { type: 'lane.update', id: lane, title: 'x' },
        { type: 'lane.delete', id: lane },
        { type: 'note.create', id: newId(), laneId: lane, title: 'x' },
        { type: 'note.update', id: note, title: 'x' },
        { type: 'note.move', id: note, laneId: lane, place: { at: 'top' } },
        { type: 'note.delete', id: note },
        { type: 'note.restore', id: note },
        { type: 'link.create', id: newId(), from: { kind: 'note', id: note }, to: { kind: 'lane', id: lane } },
        { type: 'link.update', id: link, label: 'x' },
        { type: 'link.delete', id: link },
        { type: 'link.restore', id: link },
        { type: 'layout.set', viewKind: 'lane_map', viewId: lane, nodes: [{ kind: 'note', id: note, x: 0, y: 0 }] },
        { type: 'layout.set', viewKind: 'graph', viewId: b.workspaceId, nodes: [{ kind: 'note', id: note, x: 0, y: 0 }] },
      ];
      const out = await run(a.ctx, ...ops);
      for (const [i, o] of out.entries()) {
        expect(o.status, ops[i]!.type).toBe('rejected');
        expect(o.status !== 'applied' && o.error.code, ops[i]!.type).toBe('not_found');
      }
      // Moving an own note into a foreign column, or linking to a foreign note, too.
      const sa = await snapshot(a.workspaceId, pools().app);
      const [m, l] = await run(
        a.ctx,
        { type: 'note.move', id: sa.notes[0]!.id, laneId: lane, place: { at: 'top' } },
        { type: 'link.create', id: newId(), from: { kind: 'note', id: sa.notes[0]!.id }, to: { kind: 'note', id: note } },
      );
      expect(m!.status !== 'applied' && m!.error.code).toBe('not_found');
      expect(l!.status !== 'applied' && l!.error.code).toBe('not_found');
      expect((await snapshot(b.workspaceId, pools().app)).seq).toBe(sb.seq);
    });
  });

  describe('change log', () => {
    it('replays a repeated opId instead of applying it twice', async () => {
      const a = await newAccount();
      const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!.id;
      const env = { opId: newId(), op: { type: 'note.create' as const, id: newId(), laneId: lane, title: 'once' } };
      const [first] = await executeOps(a.ctx, [env], pools().app);
      const [second] = await executeOps(a.ctx, [env], pools().app);
      expect(second).toEqual(first);
      const notes = (await snapshot(a.workspaceId, pools().app)).notes.filter((n) => n.title === 'once');
      expect(notes).toHaveLength(1);
    });

    it('numbers concurrent writes without gaps, in commit order', async () => {
      const a = await newAccount();
      const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!.id;
      const writers = Array.from({ length: 24 }, (_, i) => run(a.ctx, { type: 'note.create', id: newId(), laneId: lane, title: `w${i}` }));
      const seqs = (await Promise.all(writers)).map(([o]) => applied(o).seq!).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: 24 }, (_, i) => seqs[0]! + i));
      const page = await changesSince(a.workspaceId, seqs[0]! - 1, 500, pools().app);
      expect(page.reset).toBe(false);
      if (!page.reset) expect(page.changes.map((c) => c.seq)).toEqual(seqs);
    });

    it('spends no seq on an op that changes nothing', async () => {
      const a = await newAccount();
      const s = await snapshot(a.workspaceId, pools().app);
      const board = s.boards[0]!;
      const [o] = await run(a.ctx, { type: 'board.update', id: board.id, title: board.title });
      expect(applied(o).seq).toBeNull();
      expect((await snapshot(a.workspaceId, pools().app)).seq).toBe(s.seq);
    });

    it('spends no seq on a layout that did not move', async () => {
      const a = await newAccount();
      const s = await snapshot(a.workspaceId, pools().app);
      const lane = s.lanes[0]!.id;
      const node = { kind: 'note' as const, id: s.notes[0]!.id, x: 10, y: -20, shape: 'diamond' as const };
      applied((await run(a.ctx, { type: 'layout.set', viewKind: 'lane_map', viewId: lane, nodes: [node] }))[0]);
      const after = (await snapshot(a.workspaceId, pools().app)).seq;
      const [again] = await run(a.ctx, { type: 'layout.set', viewKind: 'lane_map', viewId: lane, nodes: [node] });
      expect(applied(again).seq).toBeNull();
      expect((await snapshot(a.workspaceId, pools().app)).seq).toBe(after);
      const [moved] = await run(a.ctx, { type: 'layout.set', viewKind: 'lane_map', viewId: lane, nodes: [{ ...node, x: 11 }] });
      expect(applied(moved).effects).toHaveLength(1);
    });

    it('restores a deleted link, unless its twin was made meanwhile', async () => {
      const a = await newAccount();
      const s = await snapshot(a.workspaceId, pools().app);
      const lane = s.lanes[0]!.id;
      const [n1, n2] = s.notes.filter((n) => n.laneId === lane);
      const id = newId();
      const pair = { from: { kind: 'note' as const, id: n1!.id }, to: { kind: 'note' as const, id: n2!.id } };
      await run(a.ctx, { type: 'link.create', id, ...pair }, { type: 'link.delete', id });
      const [back] = await run(a.ctx, { type: 'link.restore', id });
      expect(applied(back).effects[0]).toMatchObject({ kind: 'link', data: { id, deletedAt: null } });
      expect(applied((await run(a.ctx, { type: 'link.restore', id }))[0]).seq).toBeNull();

      const twin = newId();
      await run(a.ctx, { type: 'link.delete', id }, { type: 'link.create', id: twin, ...pair });
      expect(applied((await run(a.ctx, { type: 'link.restore', id }))[0]).seq).toBeNull();
      const alive = (await snapshot(a.workspaceId, pools().app)).links.filter((l) => l.from.id === n1!.id && l.to.id === n2!.id);
      expect(alive.map((l) => l.id)).toEqual([twin]);

      // Its ends in the trash: the link waits for them.
      await run(a.ctx, { type: 'link.delete', id: twin }, { type: 'note.delete', id: n2!.id });
      const [blocked] = await run(a.ctx, { type: 'link.restore', id: twin });
      expect(blocked!.status !== 'applied' && blocked!.error.code).toBe('not_found');
    });

    it('asks a client that is too far behind to reload', async () => {
      const a = await newAccount();
      const s = await snapshot(a.workspaceId, pools().app);
      expect(await changesSince(a.workspaceId, s.seq + 5, 500, pools().app)).toEqual({ reset: true });
    });
  });

  describe('note bodies', () => {
    it('refuses a stale full replace and reports the current version', async () => {
      const a = await newAccount();
      const note = (await snapshot(a.workspaceId, pools().app)).notes[0]!;
      applied((await run(a.ctx, { type: 'note.update', id: note.id, body: 'agent', baseVersion: note.version }))[0]);
      const [o] = await run(a.ctx, { type: 'note.update', id: note.id, body: 'person', baseVersion: note.version });
      expect(o!.status).toBe('conflict');
      expect(o!.status === 'conflict' && o!.error.details?.currentVersion).toBe(note.version + 1);
    });

    it('appends, replaces a unique passage, and refuses an ambiguous one', async () => {
      const a = await newAccount();
      const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!.id;
      const id = newId();
      await run(a.ctx, { type: 'note.create', id, laneId: lane, title: 'Diário', body: 'um dois' });
      applied((await run(a.ctx, { type: 'note.update', id, appendText: 'três' }))[0]);
      applied((await run(a.ctx, { type: 'note.update', id, replaceText: { old: 'dois', new: '2' } }))[0]);
      expect((await getNote(a.workspaceId, id, pools().app)).note.body).toBe('um 2\ntrês');
      await run(a.ctx, { type: 'note.update', id, appendText: 'um' });
      const [o] = await run(a.ctx, { type: 'note.update', id, replaceText: { old: 'um', new: 'x' } });
      expect(o!.status !== 'applied' && o!.error.code).toBe('invalid');
    });

    it('keeps a revision before an agent rewrites a note', async () => {
      const a = await newAccount();
      const note = (await snapshot(a.workspaceId, pools().app)).notes[0]!;
      const agent = { ...a.ctx, actorKind: 'agent' as const };
      await run(agent, { type: 'note.update', id: note.id, appendText: 'by agent' });
      const revs = await withWorkspace(a.workspaceId, (tx) => tx.selectFrom('note_revisions').select(['version', 'body']).where('note_id', '=', note.id).execute(), { db: pools().app });
      expect(revs).toEqual([{ version: note.version, body: note.body }]);
    });
  });

  describe('wikilinks', () => {
    it('links when the target appears later, and follows renames', async () => {
      const a = await newAccount('pt-BR');
      const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!.id;
      const src = newId();
      const dst = newId();
      await run(a.ctx, { type: 'note.create', id: src, laneId: lane, title: 'Origem', body: 'ver [[Destino futuro]]' });
      expect((await getNote(a.workspaceId, src, pools().app)).outgoing).toEqual([]);
      await run(a.ctx, { type: 'note.create', id: dst, laneId: lane, title: 'Destino futuro' });
      const out = (await getNote(a.workspaceId, src, pools().app)).outgoing;
      expect(out.map((l) => [l.to.id, l.origin])).toEqual([[dst, 'wikilink']]);
      await run(a.ctx, { type: 'note.update', id: dst, title: 'Destino' });
      const after = await getNote(a.workspaceId, src, pools().app);
      expect(after.note.body).toBe('ver [[Destino]]');
      expect(after.outgoing.map((l) => l.to.id)).toEqual([dst]);
      expect((await getNote(a.workspaceId, dst, pools().app)).incoming.map((l) => l.from.id)).toEqual([src]);
    });

    it('resolves the seeded tour link', async () => {
      const a = await newAccount('zh-CN');
      const s = await snapshot(a.workspaceId, pools().app);
      expect(s.links.filter((l) => l.origin === 'wikilink')).toHaveLength(1);
      expect(s.seq).toBe(0);
    });
  });

  describe('search', () => {
    it('ignores accents and finds Chinese by substring', async () => {
      const a = await newAccount('zh-CN');
      const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!.id;
      await run(
        a.ctx,
        { type: 'note.create', id: newId(), laneId: lane, title: 'Plano de ação', body: 'revisar orçamento' },
        { type: 'note.create', id: newId(), laneId: lane, title: '会议记录', body: '讨论下周的产品发布计划' },
      );
      expect((await search(a.workspaceId, 'acao', {}, pools().app)).map((h) => h.title)).toContain('Plano de ação');
      expect((await search(a.workspaceId, 'orcamento', {}, pools().app)).map((h) => h.title)).toContain('Plano de ação');
      expect((await search(a.workspaceId, '发布', {}, pools().app)).map((h) => h.title)).toEqual(['会议记录']);
      expect(await search(a.workspaceId, '%', {}, pools().app)).toEqual([]);
    });
  });

  it('keeps fractional positions in bytewise order in the database', async () => {
    const { app } = pools();
    const rows = await sql<{ p: string }>`SELECT p FROM unnest(ARRAY['a0', 'Zz', 'a0V', 'b00', 'A0']) AS p ORDER BY p`.execute(app);
    expect(rows.rows.map((r) => r.p)).toEqual(['A0', 'Zz', 'a0', 'a0V', 'b00']);
  });
});
