import type { LinkDto, NoteDto } from '@noergo/core/dto';
import type { Op } from '@noergo/core/ops/schema';
import { describe, expect, it } from 'vitest';
import { Actions } from '@/components/workspace/actions';
import { fromSnapshot, notesByLane, withPending, type Data } from '@/components/workspace/model';
import type { WorkspaceStore } from '@/components/workspace/store';
import { columnRows, columnTree } from '@/components/workspace/tree';

const T = '2026-10-22T12:00:00.000Z';
const note = (id: string, laneId: string, position: string, over: Partial<NoteDto> = {}): NoteDto => ({
  id,
  laneId,
  position,
  kind: 'text',
  title: id,
  body: '',
  excerpt: '',
  bodyLength: 0,
  url: null,
  attachmentId: null,
  color: null,
  tags: [],
  doneAt: null,
  dueAt: null,
  collapsed: false,
  version: 1,
  createdBy: null,
  updatedBy: null,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});
const link = (id: string, from: string, to: string): LinkDto => ({ id, from: { kind: 'note', id: from }, to: { kind: 'note', id: to }, origin: 'manual', label: '', style: {}, version: 1, updatedBy: null, deletedAt: null });

/**
 * WOW: a welcome note, the aluminium case with its three steps, a quote; and a second
 * column with one note.
 */
function wow(over: { notes?: Partial<Record<string, Partial<NoteDto>>>; links?: LinkDto[] } = {}): Data {
  const notes = [note('w', 'l1', 'a0'), note('g', 'l1', 'a1'), note('q', 'l1', 'a2'), note('e', 'l1', 'a3'), note('c', 'l1', 'a4'), note('n', 'l1', 'a5'), note('z', 'l2', 'a0')];
  return fromSnapshot({
    seq: 1,
    inboxLaneId: null,
    boards: [{ id: 'b1', title: 'Clients', color: null, icon: null, background: null, position: 'a0', version: 1, updatedAt: T, deletedAt: null }],
    lanes: ['l1', 'l2'].map((id, i) => ({ id, boardId: 'b1', title: id, color: null, cover: null, url: null, description: '', mapLayout: 'balanced', position: `a${i}`, version: 1, updatedAt: T, deletedAt: null })),
    notes: notes.map((n) => ({ ...n, ...over.notes?.[n.id] })),
    links: [link('k1', 'g', 'e'), link('k2', 'g', 'c'), link('k3', 'g', 'n'), ...(over.links ?? [])],
    layouts: [],
  });
}

const rows = (d: Data, laneId = 'l1', hideDone = false) =>
  columnRows(notesByLane(d.notes, [laneId]).get(laneId)!, columnTree(d, laneId), hideDone).map((r) => `${'  '.repeat(r.depth)}${r.note.id}${r.folded ? ` (${r.folded})` : ''}`);

/** Actions over a store that records what is sent, and the data as it would then be. */
function recorder(start: Data) {
  let d = start;
  const sent: Array<{ ops: Op[]; undo?: Op[]; redo?: Op[] }> = [];
  const notices: string[] = [];
  const store = {
    getState: () => ({ data: d }),
    dispatch: (ops: Op | Op[], opts: { undo?: Op[]; redo?: Op[] } = {}) => {
      const list = Array.isArray(ops) ? ops : [ops];
      sent.push({ ops: list, ...opts });
      d = withPending(d, list.map((op, i) => ({ opId: `o${sent.length}.${i}`, op })));
      return [];
    },
    notify: (n: { key: string }) => notices.push(n.key),
  };
  return { actions: new Actions(store as unknown as WorkspaceStore), sent, notices, now: () => d };
}

describe('a column as a tree', () => {
  it('puts each idea under the one it hangs from, and a fold leaves its count', () => {
    expect(rows(wow())).toEqual(['w', 'g', '  e', '  c', '  n', 'q']);
    expect(rows(wow({ notes: { g: { collapsed: true } } }))).toEqual(['w', 'g (3)', 'q']);
    const [, g] = columnRows(notesByLane(wow().notes, ['l1']).get('l1')!, columnTree(wow(), 'l1'), false);
    expect(g).toMatchObject({ branch: 'fold', open: true });
  });

  it('keeps a done idea while something open hangs from it, when done notes are hidden', () => {
    const d = wow({ notes: { g: { doneAt: T }, n: { doneAt: T }, q: { doneAt: T } } });
    expect(rows(d, 'l1', true)).toEqual(['w', 'g', '  e', '  c']);
  });

  it('names the idea with two parents that keeps a branch open', () => {
    const d = wow({ links: [link('k4', 'w', 'c')] });
    const g = columnRows(notesByLane(d.notes, ['l1']).get('l1')!, columnTree(d, 'l1'), false)[1]!;
    expect(g).toMatchObject({ branch: 'blocked', blocker: 'c' });
  });
});

describe('moving in a column as a tree', () => {
  it('moves an idea among the ones beside it, and what hangs from it follows', () => {
    const r = recorder(wow());
    expect(r.actions.moveNoteNear('g', 'w', 'top')).toEqual({ index: 0, total: 3 });
    expect(r.sent[0]!.ops.map((o) => o.type)).toEqual(['note.move']);
    expect(rows(r.now())).toEqual(['g', '  e', '  c', '  n', 'w', 'q']);
    expect(r.actions.nudgeNote('c', 'up')).toMatchObject({ index: 0, total: 3 });
    expect(rows(r.now())).toEqual(['g', '  c', '  e', '  n', 'w', 'q']);
    expect(r.actions.nudgeNote('c', 'up')).toBeNull();
  });

  it('lands under another idea by moving the link it hangs by, and undoes both', () => {
    const r = recorder(wow());
    // Above the first step of the case: q now hangs from the case.
    r.actions.moveNoteNear('q', 'e', 'top');
    expect(rows(r.now())).toEqual(['w', 'g', '  q', '  e', '  c', '  n']);
    // Below the quote, out of the case: e's link from it goes.
    r.actions.moveNoteNear('e', 'w', 'bottom');
    expect(rows(r.now())).toEqual(['w', 'e', 'g', '  q', '  c', '  n']);
    const last = r.sent.at(-1)!;
    expect(last.ops.filter((o) => o.type.startsWith('link.'))).toEqual([{ type: 'link.delete', id: 'k1' }]);
    expect(last.undo?.[0]).toEqual({ type: 'link.restore', id: 'k1' });
    // Below an open idea is its first.
    r.actions.moveNoteNear('w', 'g', 'bottom', true);
    expect(rows(r.now())).toEqual(['e', 'g', '  w', '  q', '  c', '  n']);
  });

  it('never lands an idea under itself, and one with two parents stays in its group', () => {
    const r = recorder(wow({ links: [link('k4', 'w', 'c')] }));
    expect(r.actions.moveNoteNear('g', 'c', 'top')).toBeNull();
    expect(r.actions.moveNoteNear('c', 'q', 'bottom')).toBeNull();
    expect(r.notices).toEqual(['moveBlocked']);
    expect(r.sent).toEqual([]);
    // Among its siblings it moves.
    expect(r.actions.moveNoteNear('c', 'e', 'top')).toEqual({ index: 0, total: 3 });
  });

  it('dropped on the centre of the map, an idea becomes a main branch: linked from the thought', () => {
    const r = recorder(wow());
    expect(r.actions.moveNote('e', { laneId: 'l1', parent: null, centre: true, index: Number.MAX_SAFE_INTEGER })).toEqual({ index: 3, total: 4 });
    expect(rows(r.now())).toEqual(['w', 'g', '  c', '  n', 'q', 'e']);
    const links = r.sent[0]!.ops.filter((o) => o.type.startsWith('link.'));
    expect(links).toEqual([{ type: 'link.delete', id: 'k1' }, expect.objectContaining({ type: 'link.create', from: { kind: 'lane', id: 'l1' }, to: { kind: 'note', id: 'e' } })]);
    // A loose idea at the top gains the link and keeps its place; one linked already is left be.
    r.actions.moveNote('w', { laneId: 'l1', parent: null, centre: true, index: 0 });
    expect(r.sent[1]!.ops.map((o) => o.type)).toEqual(['note.move', 'link.create']);
    expect(r.actions.moveNote('w', { laneId: 'l1', parent: null, centre: true, index: 0 })).toBeNull();
  });

  it('turns round a line drawn from an idea to its new parent, which then folds it', () => {
    // The case hangs from the centre; the quote was linked to it the wrong way, from below.
    const centre: LinkDto = { ...link('k0', 'l1', 'g'), from: { kind: 'lane', id: 'l1' } };
    const r = recorder(wow({ links: [centre, link('k4', 'q', 'g')] }));
    expect(rows(r.now())).toEqual(['w', 'g', '  e', '  c', '  n', 'q']);
    expect(r.actions.moveNote('q', { laneId: 'l1', parent: 'g', index: Number.MAX_SAFE_INTEGER })).toEqual({ index: 3, total: 4 });
    expect(rows(r.now())).toEqual(['w', 'g', '  e', '  c', '  n', '  q']);
    const sent = r.sent[0]!;
    expect(sent.ops.filter((o) => o.type.startsWith('link.'))).toEqual([{ type: 'link.delete', id: 'k4' }, expect.objectContaining({ type: 'link.create', from: { kind: 'note', id: 'g' }, to: { kind: 'note', id: 'q' } })]);
    expect(sent.undo).toContainEqual({ type: 'link.restore', id: 'k4' });
    expect(columnTree(r.now(), 'l1').blocker('note:g')).toBeNull();
  });

  it('takes the whole branch to another column, in its order, and brings it back', () => {
    const r = recorder(wow({ notes: { g: { collapsed: true } } }));
    r.actions.moveNoteNear('g', 'z', 'bottom');
    expect(rows(r.now(), 'l2')).toEqual(['z', 'g (3)']);
    expect(rows(r.now())).toEqual(['w', 'q']);
    expect(r.sent[0]!.ops.filter((o) => o.type.startsWith('link.'))).toEqual([]);
    r.actions.setCollapsed(['g'], false);
    expect(rows(r.now(), 'l2')).toEqual(['z', 'g', '  e', '  c', '  n']);
    // Alt + ←: back, second from the top as it was in the other column.
    r.actions.nudgeNote('g', 'left');
    expect(rows(r.now())).toEqual(['w', 'g', '  e', '  c', '  n', 'q']);
    expect(rows(r.now(), 'l2')).toEqual(['z']);
  });
});
