import type { LaneDto, LayoutDto, LinkDto, NoteDto } from '@noergo/core/dto';
import { opSchema, type Op } from '@noergo/core/ops/schema';
import { describe, expect, it } from 'vitest';
import { autoLayout, boundary, buildPath, childSpot, edgeBetween, geometry, laneMap, ROOT_DEFAULT, viewFor, zoomAt, type Box } from '@/components/workspace/map';
import { fromSnapshot, withPending, type Data } from '@/components/workspace/model';

const T = '2026-10-18T12:00:00.000Z';
const L = '00000000-0000-7000-8000-00000000000a';
const lane: LaneDto = { id: L, boardId: 'b1', title: 'Ideas', color: null, cover: null, url: null, description: '', position: 'a0', version: 1, updatedAt: T, deletedAt: null };
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

  it('organises a tree from the centre, half to each side, loose notes below', () => {
    const size = () => ({ w: 100, h: 40 });
    const pos = new Map([
      ['r', { x: 0, y: 0 }],
      ['a', { x: 50, y: 0 }],
      ['b', { x: -50, y: 0 }],
      ['a1', { x: 0, y: 0 }],
      ['loose', { x: 0, y: 0 }],
    ]);
    const edges = [
      { from: 'r', to: 'a' },
      { from: 'r', to: 'b' },
      { from: 'a', to: 'a1' },
    ];
    const t = autoLayout('r', [...pos.keys()], edges, pos, size);
    expect(t.get('r')).toEqual({ x: 0, y: 0 });
    expect(t.get('a')!.x).toBeGreaterThan(0);
    expect(t.get('b')!.x).toBeLessThan(0);
    expect(t.get('a1')!.x).toBeGreaterThan(t.get('a')!.x);
    expect(t.get('loose')!.y).toBeGreaterThan(100);
  });

  it('rings the notes around the centre when nothing is linked', () => {
    const pos = new Map([
      ['r', { x: 0, y: 0 }],
      ['a', { x: 0, y: 0 }],
      ['b', { x: 0, y: 0 }],
    ]);
    const t = autoLayout('r', [...pos.keys()], [], pos, () => ({ w: 100, h: 40 }));
    expect(t.get('a')!.x).toBeGreaterThan(0);
    expect(t.get('b')!.x).toBeLessThan(0);
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
