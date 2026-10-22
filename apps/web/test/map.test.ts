import type { LaneDto, LayoutDto, LinkDto, NoteDto } from '@noergo/core/dto';
import { opSchema, type Op } from '@noergo/core/ops/schema';
import { describe, expect, it } from 'vitest';
import { BRANCH_COLORS, COLORS } from '@noergo/core/limits';
import { boundary, branchColors, buildPath, childSpot, edgeBetween, geometry, laneMap, ROOT_DEFAULT, treeLayout, viewFor, zoomAt, type Box, type Branch, type WH } from '@/components/workspace/map';
import { hangingPair, mapBranches, mapTree } from '@/components/workspace/tree';
import { fromSnapshot, withPending, type Data } from '@/components/workspace/model';

const T = '2026-10-18T12:00:00.000Z';
const L = '00000000-0000-7000-8000-00000000000a';
const lane: LaneDto = { id: L, boardId: 'b1', title: 'Ideas', color: null, cover: null, url: null, description: '', mapLayout: 'balanced', position: 'a0', version: 1, updatedAt: T, deletedAt: null };
const note = (id: string, over: Partial<NoteDto> = {}): NoteDto => ({
  id,
  laneId: L,
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
  collapsed: false,
  version: 1,
  createdBy: null,
  updatedBy: null,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
  ...over,
});
const link = (id: string, from: string, to: string, over: Partial<LinkDto> = {}): LinkDto => ({
  id,
  from: { kind: from === L ? 'lane' : 'note', id: from },
  to: { kind: 'note', id: to },
  origin: 'manual',
  label: '',
  style: {},
  version: 1,
  updatedBy: null,
  deletedAt: null,
  ...over,
});
const layout = (nodeId: string, x: number, y: number, over: Partial<LayoutDto> = {}): LayoutDto => ({ viewKind: 'lane_map', viewId: L, nodeKind: 'note', nodeId, x, y, shape: 'pill', fill: 'soft', size: 'm', color: null, version: 1, ...over });

function data(notes: NoteDto[], links: LinkDto[] = [], layouts: LayoutDto[] = []): Data {
  return fromSnapshot({ seq: 1, inboxLaneId: null, boards: [], lanes: [lane], notes, links, layouts });
}

const box = (x: number, y: number, w = 100, h = 40, shape: Box['shape'] = 'rect'): Box => ({ x, y, w, h, shape });
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }, w = 240, h = 56) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;

describe('laneMap: the column as a map', () => {
  it('puts the column at the centre and every note around it, without overlaps', () => {
    const m = laneMap(data(['a', 'b', 'c', 'd', 'e'].map((id) => note(id))), L)!;
    expect(m.nodes[0]).toMatchObject({ key: `lane:${L}`, x: 0, y: 0, placed: false, ...ROOT_DEFAULT, title: 'Ideas' });
    const rest = m.nodes.slice(1);
    expect(rest.map((n) => n.key)).toEqual(['note:a', 'note:b', 'note:c', 'note:d', 'note:e']);
    for (const n of rest) expect(n.placed).toBe(false);
    for (const a of m.nodes) for (const b of m.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
    // Balanced: the first goes right, the second left.
    expect(rest[0]!.x).toBeGreaterThan(0);
    expect(rest[1]!.x).toBeLessThan(0);
  });

  it('is the same on every device, and a newer note never moves the ones already shown', () => {
    const before = laneMap(data([note('a', { createdAt: '2026-10-01T00:00:00Z' }), note('b', { createdAt: '2026-10-02T00:00:00Z' })]), L)!;
    // A note added later, even at the top of the column.
    const after = laneMap(data([note('c', { position: 'Zz', createdAt: '2026-10-03T00:00:00Z' }), note('a', { createdAt: '2026-10-01T00:00:00Z' }), note('b', { createdAt: '2026-10-02T00:00:00Z' })]), L)!;
    const at = (m: typeof before, k: string) => m.nodes.find((n) => n.key === k)!;
    expect(at(after, 'note:a')).toMatchObject({ x: at(before, 'note:a').x, y: at(before, 'note:a').y });
    expect(at(after, 'note:b')).toMatchObject({ x: at(before, 'note:b').x, y: at(before, 'note:b').y });
  });

  it('uses stored spots and styles, leaves the trash out, and draws only links inside the map', () => {
    const d = data(
      [note('a'), note('b'), note('gone', { deletedAt: T }), { ...note('elsewhere'), laneId: 'other' }],
      [link('ab', 'a', 'b', { style: { arrow: 'end', width: 3 } }), link('ra', L, 'a'), link('ax', 'a', 'elsewhere'), link('ag', 'a', 'gone'), link('dead', 'b', 'a', { deletedAt: T })],
      [layout('a', 300, -40, { shape: 'diamond', color: '#ff0000' })],
    );
    const m = laneMap(d, L)!;
    expect(m.nodes.map((n) => n.key)).toEqual([`lane:${L}`, 'note:a', 'note:b']);
    expect(m.nodes[1]).toMatchObject({ x: 300, y: -40, shape: 'diamond', color: '#ff0000', placed: true });
    expect(m.edges.map((e) => e.id).sort()).toEqual(['ab', 'ra']);
    expect(m.edges.find((e) => e.id === 'ab')!.style).toEqual({ color: null, width: 3, dash: 'solid', route: 'curve', arrow: 'end' });
    expect(edgeBetween(m.edges, 'note:b', 'note:a')?.id).toBe('ab');
  });

  it('puts a note nobody placed next to the idea it hangs from, outwards, even when the child is older', () => {
    const d = data(
      [note('kid', { createdAt: '2026-10-01T00:00:00Z' }), note('a', { createdAt: '2026-10-02T00:00:00Z' }), note('b', { createdAt: '2026-10-03T00:00:00Z' })],
      [link('ra', L, 'a'), link('rb', L, 'b'), link('akid', 'a', 'kid')],
    );
    const m = laneMap(d, L)!;
    const at = (k: string) => m.nodes.find((n) => n.key === k)!;
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    const a = at('note:a');
    const kid = at('note:kid');
    expect(dist(kid, a)).toBeLessThan(dist(kid, m.nodes[0]!));
    // Away from the centre, on the side its parent is on.
    expect(Math.sign(kid.x - a.x)).toBe(Math.sign(a.x) || 1);
    for (const p of m.nodes) for (const q of m.nodes) if (p !== q) expect(overlaps(p, q, 200, 50)).toBe(false);
  });

  it('places the same whatever order the links arrived in, and survives a cycle', () => {
    const notes = [note('a'), note('b'), note('c')];
    const links = [link('ra', L, 'a'), link('ab', 'a', 'b'), link('bc', 'b', 'c'), link('cb', 'c', 'b')];
    const one = laneMap(data(notes, links), L)!;
    const two = laneMap(data(notes, [...links].reverse()), L)!;
    expect(two.nodes.map((n) => [n.key, n.x, n.y])).toEqual(one.nodes.map((n) => [n.key, n.x, n.y]));
    const loop = laneMap(data([note('p'), note('q')], [link('pq', 'p', 'q'), link('qp', 'q', 'p')]), L)!;
    expect(loop.nodes.map((n) => n.key).sort()).toEqual([`lane:${L}`, 'note:p', 'note:q'].sort());
  });

  it('has no map for a column in the trash', () => {
    const d = fromSnapshot({ seq: 1, inboxLaneId: null, boards: [], lanes: [{ ...lane, deletedAt: T }], notes: [], links: [], layouts: [] });
    expect(laneMap(d, L)).toBeNull();
  });
});

describe('geometry ported from the prototype', () => {
  it('finds the outline of each shape', () => {
    expect(boundary(box(0, 0, 100, 40), 1, 0)).toEqual([50, 0]);
    expect(boundary(box(0, 0, 100, 40), 0, -1)).toEqual([0, -20]);
    const [ex, ey] = boundary(box(0, 0, 100, 40, 'ellipse'), 1, 1);
    expect((ex / 50) ** 2 + (ey / 20) ** 2).toBeCloseTo(1);
    const [dx, dy] = boundary(box(0, 0, 100, 40, 'diamond'), 1, 1);
    expect(Math.abs(dx) / 50 + Math.abs(dy) / 20).toBeCloseTo(1);
    // A pill's flat top, and its round cap.
    expect(boundary(box(0, 0, 100, 40, 'pill'), 0, 1)).toEqual([0, 20]);
    const [px, py] = boundary(box(0, 0, 100, 40, 'pill'), 1, 0);
    expect([px, py]).toEqual([50, 0]);
  });

  it('runs side to side along the wider gap, or straight, or elbowed', () => {
    const A = box(0, 0);
    const B = box(300, 50);
    const curve = geometry(A, B, 'curve');
    expect(curve.type).toBe('curve');
    expect(curve.pts[0]).toEqual([50, 0]);
    expect(curve.pts[3]).toEqual([250, 50]);
    const below = geometry(A, box(0, 300), 'curve');
    expect(below.pts[0]).toEqual([0, 20]);
    expect(geometry(A, B, 'elbow')).toEqual({ type: 'poly', pts: [[50, 0], [150, 0], [150, 50], [250, 50]] });
    const line = geometry(A, box(300, 0), 'straight');
    expect(line).toEqual({ type: 'line', pts: [[50, 0], [250, 0]] });
  });

  it('stops the line short of its arrow heads and finds the label point', () => {
    const geo = geometry(box(0, 0), box(300, 0), 'straight');
    const plain = buildPath(geo, 'none', 2);
    expect(plain.heads).toHaveLength(0);
    expect(plain.d).toBe('M50.0 0.0 L250.0 0.0');
    expect(plain.mid).toEqual([150, 0]);
    const end = buildPath(geo, 'end', 2);
    expect(end.heads).toHaveLength(1);
    expect(end.d).toBe('M50.0 0.0 L241.5 0.0');
    expect(buildPath(geo, 'both', 2).heads).toHaveLength(2);
  });
});

describe('placement', () => {
  it('puts a child away from the centre, on the first free row', () => {
    const root = box(0, 0, 120, 48, 'pill');
    const right = childSpot([root], root, true, 0);
    expect(right.x).toBeGreaterThan(100);
    expect(right.y).toBe(0);
    const left = box(-400, 0);
    expect(childSpot([root, left], left, false, 0).x).toBeLessThan(-400);
    // The spot is taken: the next row.
    const taken = box(right.x, right.y, 150, 42);
    expect(childSpot([root, taken], root, true, 0).y).not.toBe(0);
  });
});

/** A tree for the layouts: the centre r; a with a1, a2 (a2 holding a21); b; c with c1; and z from nothing. */
const TREE: Branch[] = [
  { key: 'a', parent: 'r' },
  { key: 'a1', parent: 'a' },
  { key: 'a2', parent: 'a' },
  { key: 'a21', parent: 'a2' },
  { key: 'b', parent: 'r' },
  { key: 'c', parent: 'r' },
  { key: 'c1', parent: 'c' },
  { key: 'z', parent: null },
];
const sized = (k: string): WH => (k === 'r' ? { w: 160, h: 56 } : { w: 100 + k.length * 10, h: 40 });
const edgesOf = (p: Map<string, { x: number; y: number }>, k: string) => {
  const { x, y } = p.get(k)!;
  const { w, h } = sized(k);
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
};
/** No two nodes on show overlap. */
const apart = (p: Map<string, { x: number; y: number }>, keys: readonly string[]) => {
  for (const [i, a] of keys.entries()) {
    for (const b of keys.slice(i + 1)) {
      const A = edgesOf(p, a);
      const B = edgesOf(p, b);
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) return `${a} overlaps ${b}`;
    }
  }
  return null;
};
const ALL = ['r', ...TREE.map((b) => b.key)];

describe('layouts from the tree', () => {
  it('to the right: each idea beside its parent, its own stacked in column order, nothing overlapping', () => {
    const p = treeLayout('right', 'r', { x: 10, y: 20 }, TREE, new Set(), sized);
    expect(p.get('r')).toEqual({ x: 10, y: 20 });
    // Children start a fixed gap after their parent's edge, all on one line.
    expect(edgesOf(p, 'a1').x0).toBe(edgesOf(p, 'a2').x0);
    expect(edgesOf(p, 'a1').x0).toBeGreaterThan(edgesOf(p, 'a').x1);
    expect(p.get('a')!.y).toBeLessThan(p.get('b')!.y);
    expect(p.get('b')!.y).toBeLessThan(p.get('c')!.y);
    expect(p.get('a1')!.y).toBeLessThan(p.get('a2')!.y);
    // A parent sits in the middle of what hangs from it.
    expect(Math.abs(p.get('a')!.y - (p.get('a1')!.y + p.get('a2')!.y) / 2)).toBeLessThanOrEqual(1);
    expect(apart(p, ALL)).toBeNull();
    // The tree from nothing goes under the map.
    expect(edgesOf(p, 'z').y0).toBeGreaterThan(Math.max(...ALL.filter((k) => k !== 'z').map((k) => edgesOf(p, k).y1)));
  });

  it('balanced: the main branches split by the room they take, clockwise, both sides around the centre', () => {
    const p = treeLayout('balanced', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    // a (three ideas tall) against b and c (one and two).
    expect(p.get('a')!.x).toBeGreaterThan(0);
    expect(p.get('b')!.x).toBeLessThan(0);
    expect(p.get('c')!.x).toBeLessThan(0);
    // The left side reads from the bottom up: c above b.
    expect(p.get('c')!.y).toBeLessThan(p.get('b')!.y);
    expect(p.get('c1')!.x).toBeLessThan(p.get('c')!.x);
    expect(apart(p, ALL)).toBeNull();
    // To the left is the mirror of to the right.
    const r = treeLayout('right', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    const l = treeLayout('left', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    for (const k of ['a', 'a21', 'c1']) expect(l.get(k)).toEqual({ x: -r.get(k)!.x, y: r.get(k)!.y });
  });

  it('downward: levels one under the other, siblings side by side', () => {
    const p = treeLayout('down', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    expect(p.get('a')!.y).toBe(p.get('b')!.y);
    expect(p.get('a1')!.y).toBeGreaterThan(p.get('a')!.y);
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
    expect(Math.abs(p.get('a')!.x - (p.get('a1')!.x + p.get('a2')!.x) / 2)).toBeLessThanOrEqual(1);
    expect(apart(p, ALL)).toBeNull();
  });

  it('closes up around a fold, and still gives what it hides a spot beside the idea that hides it', () => {
    const open = treeLayout('right', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    const hidden = new Set(['a1', 'a2', 'a21']);
    const p = treeLayout('right', 'r', { x: 0, y: 0 }, TREE, hidden, sized);
    const shown = ALL.filter((k) => !hidden.has(k));
    expect(apart(p, shown)).toBeNull();
    // b moves up into the room the branch left.
    expect(p.get('b')!.y - p.get('a')!.y).toBeLessThan(open.get('b')!.y - open.get('a')!.y);
    // The hidden ideas keep their shape, around a.
    expect(p.get('a1')!.x - p.get('a')!.x).toBe(open.get('a1')!.x - open.get('a')!.x);
    expect(p.get('a21')!.x).toBeGreaterThan(p.get('a2')!.x);
  });

  it('is the same for the same tree, and a new idea makes room where it lands', () => {
    const p = treeLayout('balanced', 'r', { x: 0, y: 0 }, TREE, new Set(), sized);
    expect(treeLayout('balanced', 'r', { x: 0, y: 0 }, [...TREE], new Set(), sized)).toEqual(p);
    const more = [...TREE, { key: 'b1', parent: 'b' }];
    const q = treeLayout('balanced', 'r', { x: 0, y: 0 }, more, new Set(), sized);
    expect(q.get('b1')!.x).toBeLessThan(q.get('b')!.x);
    expect(apart(q, [...ALL, 'b1'])).toBeNull();
  });

  it('reads the tree of a column: what hangs from the centre is a main branch, the rest from nothing', () => {
    const d = data([note('a', { position: 'a0' }), note('a1', { position: 'a1' }), note('z', { position: 'a2' })], [link('k1', L, 'a'), link('k2', 'a', 'a1')]);
    const m = laneMap(d, L)!;
    const rootKey = `lane:${L}`;
    expect(mapBranches(m, mapTree(m, rootKey), rootKey)).toEqual([
      { key: 'note:a', parent: rootKey },
      { key: 'note:a1', parent: 'note:a' },
      { key: 'note:z', parent: null },
    ]);
  });
});

describe('a line drawn by hand', () => {
  // A main branch with an idea under it, a fresh main branch, two loose ideas (one with an idea of its own).
  const d = data(
    [note('a', { position: 'a0' }), note('a1', { position: 'a1' }), note('n', { position: 'a2', createdAt: '2026-10-19T12:00:00.000Z' }), note('x', { position: 'a3' }), note('y', { position: 'a4', createdAt: '2026-10-19T12:00:00.000Z' }), note('y1', { position: 'a5' })],
    [link('k1', L, 'a'), link('k2', 'a', 'a1'), link('k3', L, 'n'), link('k4', 'y', 'y1')],
  );
  const m = laneMap(d, L)!;
  const rootKey = `lane:${L}`;
  const tree = mapTree(m, rootKey);
  const branches = mapBranches(m, tree, rootKey);
  const older = (p: string, q: string) => d.notes.get(p.slice(5))!.createdAt < d.notes.get(q.slice(5))!.createdAt;
  const pair = (from: string, to: string) => hangingPair(tree, branches, rootKey, `note:${from}`, to === 'root' ? rootKey : `note:${to}`, older);

  it('hangs an idea with no place yet from the other end, whichever way the line was drawn', () => {
    // The sub-idea drawn to its parent, and the parent to it: the same tree.
    expect(pair('x', 'a')).toEqual({ child: 'note:x', parent: 'note:a' });
    expect(pair('a1', 'x')).toEqual({ child: 'note:x', parent: 'note:a1' });
    // A main branch just made, with nothing below it, has no place of its own yet.
    expect(pair('n', 'a1')).toEqual({ child: 'note:n', parent: 'note:a1' });
    expect(pair('x', 'root')).toEqual({ child: 'note:x', parent: rootKey });
  });

  it('between two with no place, the one with ideas of its own, else the older, is the parent', () => {
    expect(pair('x', 'y')).toEqual({ child: 'note:x', parent: 'note:y' });
    expect(pair('n', 'x')).toEqual({ child: 'note:n', parent: 'note:x' });
    expect(pair('x', 'n')).toEqual({ child: 'note:n', parent: 'note:x' });
  });

  it('leaves a line between two ideas with their place as a line, and never closes a loop', () => {
    expect(pair('a1', 'y1')).toBeNull();
    expect(pair('a', 'a1')).toBeNull();
    expect(pair('y1', 'y')).toBeNull();
  });
});

describe('branch colours', () => {
  it('gives each main branch its turn, and what hangs from it the same colour', () => {
    const c = branchColors('r', TREE, () => null, null);
    expect(c.get('a')).toBe(BRANCH_COLORS[0]);
    expect(c.get('a21')).toBe(BRANCH_COLORS[0]);
    expect(c.get('b')).toBe(BRANCH_COLORS[1]);
    expect(c.get('c1')).toBe(BRANCH_COLORS[2]);
    // The centre and a tree from nothing take the thought's colour.
    expect(c.get('r')).toBeNull();
    expect(c.get('z')).toBeNull();
  });

  it('keeps an idea’s own colour, passes it down, and never paints a branch the thought’s colour', () => {
    const own = (k: string) => (k === 'a2' ? COLORS[3] : k === 'b' ? COLORS[0] : null);
    const c = branchColors('r', TREE, own, BRANCH_COLORS[0]);
    expect(c.get('a1')).toBe(BRANCH_COLORS[1]);
    expect(c.get('a2')).toBe(COLORS[3]);
    expect(c.get('a21')).toBe(COLORS[3]);
    expect(c.get('b')).toBe(COLORS[0]);
    // c keeps its turn whatever b chose: colours never shift to a neighbour.
    expect(c.get('c')).toBe(BRANCH_COLORS[3]);
    expect([...c.values()].filter((x) => x === BRANCH_COLORS[0])).toEqual([BRANCH_COLORS[0], BRANCH_COLORS[0]]);
  });
});

describe('view', () => {
  it('frames the content and zooms around the pointer', () => {
    const v = viewFor({ x0: -100, y0: -50, x1: 100, y1: 50 }, 1000, 700);
    expect(v.z).toBe(1.1);
    expect(v.x).toBe(500);
    const z = zoomAt(v, 2, 200, 100);
    expect(z.z).toBe(2.2);
    // The world point under (200, 100) stays under it.
    expect((200 - v.x) / v.z).toBeCloseTo((200 - z.x) / z.z);
    expect(zoomAt(v, 100, 0, 0).z).toBe(3);
  });

  it('keeps text readable on a phone, centred on the content', () => {
    const wide = { x0: -420, y0: -30, x1: 420, y1: 30 };
    expect(viewFor(wide, 390, 600).z).toBeLessThan(0.5);
    const v = viewFor(wide, 390, 600, 0.7);
    expect(v.z).toBe(0.7);
    expect(v.x).toBe(195);
  });
});

describe('withPending: links and positions', () => {
  const ops = (list: Op[]) => list.map((op, i) => ({ opId: String(i), op: opSchema.parse(op) }));
  const A = '00000000-0000-7000-8000-000000000001';
  const B = '00000000-0000-7000-8000-000000000002';
  const K = '00000000-0000-7000-8000-000000000003';

  it('shows a link as soon as it is made, styled, then deleted and restored', () => {
    const d = data([note(A), note(B)]);
    const made = withPending(d, ops([{ type: 'link.create', id: K, from: { kind: 'note', id: A }, to: { kind: 'note', id: B }, style: { arrow: 'end' } }]));
    expect(made.links.get(K)).toMatchObject({ origin: 'manual', label: '', style: { arrow: 'end' }, version: 0, deletedAt: null });
    const styled = withPending(made, ops([{ type: 'link.update', id: K, label: 'causes', style: { width: 3 } }]));
    expect(styled.links.get(K)).toMatchObject({ label: 'causes', style: { arrow: 'end', width: 3 } });
    const deleted = withPending(styled, ops([{ type: 'link.delete', id: K }]));
    expect(deleted.links.get(K)!.deletedAt).not.toBeNull();
    expect(withPending(deleted, ops([{ type: 'link.restore', id: K }])).links.get(K)!.deletedAt).toBeNull();
  });

  it('moves and restyles a node, keeping what the op leaves out', () => {
    const d = data([note(A)], [], [layout(A, 10, 20, { shape: 'diamond', version: 4 })]);
    const key = `lane_map:${L}:note:${A}`;
    const moved = withPending(d, ops([{ type: 'layout.set', viewKind: 'lane_map', viewId: L, nodes: [{ kind: 'note', id: A, x: 100, y: 200, color: '#ff0000' }] }]));
    expect(moved.layouts.get(key)).toMatchObject({ x: 100, y: 200, shape: 'diamond', color: '#ff0000', version: 4 });
    const fresh = withPending(data([note(B)]), ops([{ type: 'layout.set', viewKind: 'lane_map', viewId: L, nodes: [{ kind: 'note', id: B, x: 1, y: 2 }] }]));
    expect(fresh.layouts.get(`lane_map:${L}:note:${B}`)).toMatchObject({ shape: 'pill', fill: 'soft', size: 'm', color: null, version: 0 });
    const removed = withPending(d, ops([{ type: 'layout.remove', viewKind: 'lane_map', viewId: L, nodes: [{ kind: 'note', id: A }] }]));
    expect(removed.layouts.has(key)).toBe(false);
  });
});
