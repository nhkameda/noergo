import type { BoardDto, LaneDto, NoteDto } from '@noergo/core/dto';
import { COLORS } from '@noergo/core/limits';
import { opSchema } from '@noergo/core/ops/schema';
import { describe, expect, it } from 'vitest';
import { isIdeario, planIdeario, splitText } from '@/components/workspace/import-ideario';
import { applyEffects, captureLane, colorName, dueNotes, fromSnapshot, localSearch, nearestColor, notesByLane, toSnapshot, withPending, type Data } from '@/components/workspace/model';
import { makePatch, mapCaret, rebase } from '@/components/workspace/text-sync';
import { positionAt } from '@/components/workspace/actions';

const T = '2026-10-18T12:00:00.000Z';
const board = (id: string, over: Partial<BoardDto> = {}): BoardDto => ({ id, title: id, color: null, position: 'a0', version: 1, updatedAt: T, deletedAt: null, ...over });
const lane = (id: string, boardId: string, over: Partial<LaneDto> = {}): LaneDto => ({ id, boardId, title: id, color: null, position: 'a0', version: 1, updatedAt: T, deletedAt: null, ...over });
const note = (id: string, laneId: string, over: Partial<NoteDto> = {}): NoteDto => ({
  id,
  laneId,
  position: 'a0',
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
  version: 1,
  createdBy: null,
  updatedBy: null,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});

function data(over: Partial<{ boards: BoardDto[]; lanes: LaneDto[]; notes: NoteDto[]; inboxLaneId: string | null }> = {}): Data {
  return fromSnapshot({
    seq: 10,
    inboxLaneId: over.inboxLaneId ?? null,
    boards: over.boards ?? [board('b1')],
    lanes: over.lanes ?? [lane('l1', 'b1')],
    notes: over.notes ?? [note('n1', 'l1')],
    links: [],
    layouts: [],
  });
}

describe('applyEffects: the version rule', () => {
  it('lands newer versions and ignores older or equal ones', () => {
    const d = data({ notes: [note('n1', 'l1', { version: 3, title: 'three' })] });
    expect(applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 2, title: 'two' }) }]).notes.get('n1')!.title).toBe('three');
    expect(applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 3, title: 'other' }) }]).notes.get('n1')!.title).toBe('three');
    expect(applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 4, title: 'four' }) }]).notes.get('n1')!.title).toBe('four');
  });

  it('an equal version only fills in a missing body', () => {
    const d = data({ notes: [note('n1', 'l1', { version: 3, body: undefined, bodyLength: 9000 })] });
    const next = applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 3, body: 'full', bodyLength: 9000 }) }]);
    expect(next.notes.get('n1')!.body).toBe('full');
  });

  it('a move without the body keeps the body already held', () => {
    const d = data({ notes: [note('n1', 'l1', { version: 3, body: 'long text', bodyLength: 9 })] });
    const next = applyEffects(d, [{ kind: 'note', data: note('n1', 'l2', { version: 4, body: undefined, bodyLength: 9 }) }]);
    expect(next.notes.get('n1')).toMatchObject({ laneId: 'l2', body: 'long text' });
  });

  it('a deleted note stays deleted when a late, older effect arrives', () => {
    let d = data({ notes: [note('n1', 'l1', { version: 3 })] });
    d = applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 4, deletedAt: T }) }]);
    d = applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 3 }) }]);
    expect(d.notes.get('n1')!.deletedAt).toBe(T);
    expect(notesByLane(d.notes, ['l1']).get('l1')).toEqual([]);
    expect(toSnapshot(d).notes).toEqual([]);
  });

  it('copies only the tables it touches, and moves seq forward only', () => {
    const d = data();
    const next = applyEffects(d, [{ kind: 'note', data: note('n2', 'l1') }], 12);
    expect(next.notes).not.toBe(d.notes);
    expect(next.boards).toBe(d.boards);
    expect(next.lanes).toBe(d.lanes);
    expect(next.seq).toBe(12);
    expect(applyEffects(next, [], 5).seq).toBe(12);
  });
});

describe('withPending: the optimistic layer', () => {
  it('shows a created note where it was placed, at version 0', () => {
    const d = data({ notes: [note('n1', 'l1', { position: 'a1' })] });
    const shown = withPending(d, [{ opId: 'o1', op: { type: 'note.create', id: 'n2', laneId: 'l1', title: 'new', place: { position: 'a0' } } }]);
    expect(notesByLane(shown.notes, ['l1']).get('l1')!.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(shown.notes.get('n2')!.version).toBe(0);
    // The confirmed state is untouched.
    expect(d.notes.has('n2')).toBe(false);
  });

  it('lets the confirmed effect replace the guess', () => {
    const d = data();
    const pending = [{ opId: 'o1', op: { type: 'note.update' as const, id: 'n1', title: 'guess' } }];
    expect(withPending(d, pending).notes.get('n1')!.title).toBe('guess');
    const confirmed = applyEffects(d, [{ kind: 'note', data: note('n1', 'l1', { version: 2, title: 'server' }) }]);
    expect(withPending(confirmed, []).notes.get('n1')!.title).toBe('server');
  });

  it('applies tag changes, done and the local body of a patch', () => {
    const d = data({ notes: [note('n1', 'l1', { tags: ['a', 'b'], body: 'one' })] });
    const shown = withPending(d, [
      { opId: 'o1', op: { type: 'note.update', id: 'n1', tagsAdd: ['c'], tagsRemove: ['a'], done: true } },
      { opId: 'o2', op: { type: 'note.update', id: 'n1', bodyPatch: makePatch('one', 'one two') }, local: { body: 'one two' } },
    ]);
    expect(shown.notes.get('n1')).toMatchObject({ tags: ['b', 'c'], body: 'one two', bodyLength: 7 });
    expect(shown.notes.get('n1')!.doneAt).not.toBeNull();
  });

  it('moves and deletes', () => {
    const d = data({ lanes: [lane('l1', 'b1'), lane('l2', 'b1', { position: 'a1' })] });
    const moved = withPending(d, [{ opId: 'o1', op: { type: 'note.move', id: 'n1', laneId: 'l2', place: { position: 'a5' } } }]);
    expect(moved.notes.get('n1')).toMatchObject({ laneId: 'l2', position: 'a5' });
    const gone = withPending(d, [{ opId: 'o1', op: { type: 'lane.delete', id: 'l1' } }]);
    expect(gone.lanes.get('l1')!.deletedAt).not.toBeNull();
  });
});

describe('selectors', () => {
  it('capture goes to the inbox, else the first column of the current board', () => {
    const d = data({ boards: [board('b1'), board('b2', { position: 'a1' })], lanes: [lane('l1', 'b1'), lane('in', 'b2'), lane('l3', 'b2', { position: 'a1' })], inboxLaneId: 'in' });
    expect(captureLane(d, 'b1')!.id).toBe('in');
    const noInbox = applyEffects(d, [{ kind: 'lane', data: lane('in', 'b2', { version: 2, deletedAt: T }) }]);
    expect(captureLane(noInbox, 'b2')!.id).toBe('l3');
    expect(captureLane(noInbox, null)!.id).toBe('l1');
  });

  it('groups open due notes and skips done or trashed ones', () => {
    const at = new Date(2026, 9, 18, 15, 0);
    const day = (offset: number) => new Date(2026, 9, 18 + offset, 12, 0).toISOString();
    const d = data({
      notes: [
        note('late', 'l1', { dueAt: day(-2) }),
        note('today', 'l1', { dueAt: day(0) }),
        note('soon', 'l1', { dueAt: day(3) }),
        note('done', 'l1', { dueAt: day(0), doneAt: T }),
        note('trashed', 'l1', { dueAt: day(0), deletedAt: T }),
      ],
    });
    expect(dueNotes(d, at).map((i) => [i.note.id, i.group])).toEqual([
      ['late', 'overdue'],
      ['today', 'today'],
      ['soon', 'upcoming'],
    ]);
  });

  it('searches ignoring case and accents, title first, and in Chinese', () => {
    const d = data({
      notes: [note('body', 'l1', { title: 'Outra', body: 'fala de reunião' }), note('title', 'l1', { title: 'Reunião de pauta' }), note('zh', 'l1', { title: '会议记录' })],
    });
    expect(localSearch(d, 'REUNIAO').map((n) => n.id)).toEqual(['title', 'body']);
    expect(localSearch(d, '会议').map((n) => n.id)).toEqual(['zh']);
    expect(localSearch(d, '   ')).toEqual([]);
  });

  it('places by index between neighbours', () => {
    const list = [
      { id: 'a', position: 'a0' },
      { id: 'b', position: 'a1' },
      { id: 'c', position: 'a2' },
    ];
    expect(positionAt(list, 0) < 'a0').toBe(true);
    const mid = positionAt(list, 2);
    expect(mid > 'a1' && mid < 'a2').toBe(true);
    expect(positionAt(list, 3) > 'a2').toBe(true);
    // Moving 'a' to the end ignores its own slot.
    expect(positionAt(list, 2, 'a') > 'a2').toBe(true);
  });

  it('maps colours to palette names, and foreign colours to the nearest', () => {
    expect(colorName(COLORS[4])).toBe('anil');
    expect(colorName('#123456')).toBeUndefined();
    expect(nearestColor(COLORS[2])).toBe(COLORS[2]);
    expect(COLORS.slice(0, 7)).toContain(nearestColor('#000080'));
    expect(nearestColor('red')).toBeNull();
  });
});

describe('text sync', () => {
  it('patches round-trip', () => {
    expect(makePatch('a', 'a')).toBe('');
    expect(makePatch('hello', 'hello world')).toMatch(/^@@/);
  });

  it('keeps both sides when a person and an agent edit different places', () => {
    const base = 'Line one\nLine two\n';
    const local = 'Line one, edited\nLine two\n';
    const remote = 'Line one\nLine two\nAppended by an agent\n';
    expect(rebase(base, local, remote)).toEqual({ text: 'Line one, edited\nLine two\nAppended by an agent\n', clean: true });
  });

  it('short-circuits when one side did not change', () => {
    expect(rebase('a', 'a', 'b')).toEqual({ text: 'b', clean: true });
    expect(rebase('a', 'b', 'a')).toEqual({ text: 'b', clean: true });
  });

  it('keeps the caret on the same word when text is inserted before it', () => {
    const before = 'world';
    const after = 'hello world';
    expect(mapCaret(before, after, 2)).toBe(8);
    expect(mapCaret(before, before, 3)).toBe(3);
  });
});

describe('import of the prototype backup', () => {
  const labels = { boardTitle: 'Imported', attachment: (n: string) => `File: ${n}`, untitledColumn: 'Column' };
  const backup = {
    app: 'ideario',
    state: {
      version: 1,
      columns: [
        {
          title: 'Ideas',
          color: '#FF0000',
          cards: [
            { id: 'c1', kind: 'text', text: 'First idea\nwith details' },
            { id: 'c2', kind: 'link', text: '', url: 'javascript:alert(1)' },
            { id: 'c3', kind: 'link', text: '', url: 'https://example.com/x' },
            { id: 'c4', kind: 'image', text: '', fileName: 'photo.png' },
            { id: 'c1', kind: 'text', text: 'duplicate id' },
          ],
          map: {
            root: { x: 0, y: 0, shape: 'pill' },
            nodes: { c1: { x: 120, y: Number.NaN, shape: 'hexagon' }, ghost: { x: 1, y: 1 } },
            edges: [
              { from: 'root', to: 'c1', route: 'elbow', width: 3 },
              { from: 'c1', to: 'c1' },
              { from: 'c1', to: 'ghost' },
            ],
          },
        },
        { title: '   ', cards: [] },
      ],
    },
  };

  it('recognises the backup', () => {
    expect(isIdeario(backup)).toBe(true);
    expect(isIdeario({ app: 'other', state: {} })).toBe(false);
    expect(isIdeario(null)).toBe(false);
  });

  it('splits the first line into the title', () => {
    expect(splitText('  Title\n\nbody  ')).toEqual({ title: 'Title', body: 'body' });
    const long = 'x'.repeat(400);
    const s = splitText(long);
    expect(s.title).toHaveLength(300);
    expect(s.body).toBe(long);
  });

  it('plans valid operations, dropping what is unsafe or dangling', () => {
    const plan = planIdeario(backup, labels, null);
    expect(plan).toMatchObject({ columns: 2, notes: 4, links: 1, skippedFiles: 1 });
    for (const op of plan.ops) expect(opSchema.safeParse(op).success, JSON.stringify(op)).toBe(true);

    const notes = plan.ops.filter((o) => o.type === 'note.create');
    expect(notes.map((n) => n.title)).toEqual(['First idea', '', 'https://example.com/x', 'photo.png']);
    expect(notes[1]!.url).toBeNull();
    expect(notes[3]!.body).toBe('File: photo.png');

    const lanes = plan.ops.filter((o) => o.type === 'lane.create');
    expect(lanes.map((l) => l.title)).toEqual(['Ideas', 'Column']);

    const layout = plan.ops.find((o) => o.type === 'layout.set');
    expect(layout?.nodes).toHaveLength(2);
    expect(layout?.nodes[1]).toMatchObject({ kind: 'note', x: 120, y: 0, shape: undefined });

    const link = plan.ops.find((o) => o.type === 'link.create');
    expect(link).toMatchObject({ from: { kind: 'lane' }, to: { kind: 'note' }, style: { route: 'elbow', width: 3, dash: 'solid' } });

    // Board, columns and notes come before the layout and links that point at them.
    const firstLater = plan.ops.findIndex((o) => o.type === 'layout.set' || o.type === 'link.create');
    expect(plan.ops.slice(firstLater).every((o) => o.type === 'layout.set' || o.type === 'link.create')).toBe(true);
  });
});
