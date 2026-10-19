import type { LaneDto, LayoutDto, LinkDto, NoteDto } from '@noergo/core/dto';
import { layoutKey, notesByLane, type Data } from './model';

/**
 * The map of a column, as pure data and geometry (ported from the prototype's map.js).
 * The column itself is the centre; every note of it is a node; links between those
 * nodes are the edges. Positions live in node_layouts (view lane_map, view id = column).
 * A note that has no position yet gets one around the centre, computed the same way on
 * every device, and keeps it once anything on the map is written.
 */

export type Shape = 'pill' | 'rounded' | 'rect' | 'ellipse' | 'diamond' | 'plain';
export type Fill = 'solid' | 'soft' | 'outline';
export type Size = 's' | 'm' | 'l';
export type Dash = 'solid' | 'dashed' | 'dotted';
export type Route = 'curve' | 'straight' | 'elbow';
export type Arrow = 'none' | 'end' | 'start' | 'both';
export type Width = 1 | 2 | 3 | 5;

export const SHAPES: readonly Shape[] = ['pill', 'rounded', 'rect', 'ellipse', 'diamond', 'plain'];
export const FILLS: readonly Fill[] = ['solid', 'soft', 'outline'];
export const SIZES: readonly Size[] = ['s', 'm', 'l'];
export const DASHES: readonly Dash[] = ['solid', 'dashed', 'dotted'];
export const ROUTES: readonly Route[] = ['curve', 'straight', 'elbow'];
export const ARROWS: readonly Arrow[] = ['none', 'end', 'start', 'both'];
export const WIDTHS: readonly Width[] = [1, 2, 3, 5];

export interface NodeStyle {
  shape: Shape;
  fill: Fill;
  size: Size;
  color: string | null;
}

export interface EdgeStyle {
  color: string | null;
  width: Width;
  dash: Dash;
  route: Route;
  arrow: Arrow;
}

export const NODE_DEFAULT: NodeStyle = { shape: 'pill', fill: 'soft', size: 'm', color: null };
/** The column itself, at the centre. */
export const ROOT_DEFAULT: NodeStyle = { shape: 'pill', fill: 'solid', size: 'l', color: null };
export const EDGE_DEFAULT: EdgeStyle = { color: null, width: 2, dash: 'solid', route: 'curve', arrow: 'none' };

export type Point = readonly [number, number];
export interface XY {
  x: number;
  y: number;
}
export interface WH {
  w: number;
  h: number;
}
export interface Box extends XY, WH {
  shape: Shape;
}

/** `note:<id>` or `lane:<id>` (the centre). */
export type NodeKey = string;
export const keyOf = (ref: { kind: string; id: string }): NodeKey => `${ref.kind}:${ref.id}`;

export interface MapNode extends XY, NodeStyle {
  key: NodeKey;
  ref: { kind: 'note' | 'lane'; id: string };
  /** False while the position is the computed one (nothing stored yet). */
  placed: boolean;
  note: NoteDto | null;
  title: string;
}

export interface MapEdge {
  id: string;
  from: NodeKey;
  to: NodeKey;
  label: string;
  origin: LinkDto['origin'];
  style: EdgeStyle;
}

export interface LaneMap {
  lane: LaneDto;
  /** The centre first, then the notes in column order. */
  nodes: MapNode[];
  edges: MapEdge[];
}

/** What a new node is assumed to measure before the browser has drawn it. */
export const GUESS: WH = { w: 240, h: 56 };
const EST: WH = { w: 150, h: 42 };

const styleFrom = (l: LayoutDto | undefined, fallback = NODE_DEFAULT): NodeStyle => (l ? { shape: l.shape, fill: l.fill, size: l.size, color: l.color } : fallback);

export function laneMap(data: Pick<Data, 'lanes' | 'notes' | 'links' | 'layouts'>, laneId: string): LaneMap | null {
  const lane = data.lanes.get(laneId);
  if (!lane || lane.deletedAt !== null) return null;
  const layout = (kind: 'note' | 'lane', id: string) => data.layouts.get(layoutKey({ viewKind: 'lane_map', viewId: laneId, nodeKind: kind, nodeId: id }));

  const rootLayout = layout('lane', laneId);
  const root: MapNode = { key: keyOf({ kind: 'lane', id: laneId }), ref: { kind: 'lane', id: laneId }, x: rootLayout?.x ?? 0, y: rootLayout?.y ?? 0, ...styleFrom(rootLayout, ROOT_DEFAULT), placed: !!rootLayout, note: null, title: lane.title };

  const notes = notesByLane(data.notes, [laneId]).get(laneId) ?? [];
  const nodes: MapNode[] = [root];
  const missing: NoteDto[] = [];
  for (const note of notes) {
    const l = layout('note', note.id);
    if (!l) missing.push(note);
    else nodes.push({ key: keyOf({ kind: 'note', id: note.id }), ref: { kind: 'note', id: note.id }, x: l.x, y: l.y, ...styleFrom(l), placed: true, note, title: note.title });
  }
  // A note nobody placed goes next to the node it hangs from (its first link in, by link
  // id), parents before children, else in a ring around the centre. Same spots on every
  // device: guessed sizes, oldest first, so a note added later never moves the ones shown.
  missing.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const inMap = new Set([root.key, ...notes.map((n) => keyOf({ kind: 'note', id: n.id }))]);
  const parentOf = new Map<NodeKey, { key: NodeKey; link: string }>();
  for (const l of data.links.values()) {
    if (l.deletedAt !== null || l.to.kind !== 'note') continue;
    const from = keyOf(l.from);
    const to = keyOf(l.to);
    if (from === to || !inMap.has(from) || !inMap.has(to)) continue;
    const cur = parentOf.get(to);
    if (!cur || l.id < cur.link) parentOf.set(to, { key: from, link: l.id });
  }
  const taken: Box[] = nodes.map((n) => ({ x: n.x, y: n.y, ...GUESS, shape: n.shape }));
  const at = new Map<NodeKey, Box>(nodes.map((n, i) => [n.key, taken[i]!]));
  let queue = missing;
  while (queue.length) {
    const later: NoteDto[] = [];
    for (const note of queue) {
      const key = keyOf({ kind: 'note', id: note.id });
      const parent = parentOf.get(key)?.key;
      const from = parent ? at.get(parent) : undefined;
      // A parent still to be placed goes first; a cycle falls back to the ring below.
      if (parent && !from) {
        later.push(note);
        continue;
      }
      const spot = from && parent !== root.key ? childSpot(taken, from, false, root.x) : (([x, y]) => ({ x, y }))(ringSpot(root, GUESS, taken));
      const box: Box = { ...spot, ...GUESS, shape: 'pill' };
      taken.push(box);
      at.set(key, box);
      nodes.push({ key, ref: { kind: 'note', id: note.id }, x: spot.x, y: spot.y, ...NODE_DEFAULT, placed: false, note, title: note.title });
    }
    // No progress means what is left waits on itself: place it around the centre.
    if (later.length === queue.length) {
      for (const note of later) {
        const [x, y] = ringSpot(root, GUESS, taken);
        const key = keyOf({ kind: 'note', id: note.id });
        const box: Box = { x, y, ...GUESS, shape: 'pill' };
        taken.push(box);
        at.set(key, box);
        nodes.push({ key, ref: { kind: 'note', id: note.id }, x, y, ...NODE_DEFAULT, placed: false, note, title: note.title });
      }
      break;
    }
    queue = later;
  }

  const present = new Set(nodes.map((n) => n.key));
  const edges: MapEdge[] = [];
  for (const l of data.links.values()) {
    if (l.deletedAt !== null) continue;
    const from = keyOf(l.from);
    const to = keyOf(l.to);
    if (!present.has(from) || !present.has(to)) continue;
    edges.push({ id: l.id, from, to, label: l.label, origin: l.origin, style: { ...EDGE_DEFAULT, ...definedOnly(l.style) } });
  }
  return { lane, nodes, edges };
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The edge already joining two nodes, in either direction and of any origin. */
export function edgeBetween(edges: readonly MapEdge[], a: NodeKey, b: NodeKey): MapEdge | undefined {
  return edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

// ───────────────────────────── placement

// Angles alternating right and left, so a map is born balanced.
const RING_ANGLES = [0, 180, -32, 148, 32, -148, -64, 116, 64, -116, -90, 90].map((d) => (d * Math.PI) / 180);

/** A free spot on widening ellipses around `c`. */
export function ringSpot(c: XY, size: WH, placed: readonly (XY & WH)[]): [number, number] {
  for (let r = 200, ring = 0; r < 8000; r += 90, ring++) {
    for (const base of RING_ANGLES) {
      const a = base + ring * 0.26;
      const x = Math.round(c.x + Math.cos(a) * r * 1.5);
      const y = Math.round(c.y + Math.sin(a) * r * 0.8);
      if (placed.every((b) => Math.abs(b.x - x) >= (b.w + size.w) / 2 + 24 || Math.abs(b.y - y) >= (b.h + size.h) / 2 + 18)) return [x, y];
    }
  }
  return [c.x, c.y + 400];
}

export function isFree(boxes: readonly Box[], x: number, y: number, est: WH = EST): boolean {
  return boxes.every((b) => Math.abs(b.x - x) >= (b.w + est.w) / 2 + 16 || Math.abs(b.y - y) >= (b.h + est.h) / 2 + 10);
}

export function freeNear(boxes: readonly Box[], x: number, y: number): XY {
  if (isFree(boxes, x, y)) return { x: Math.round(x), y: Math.round(y) };
  for (let r = 1; r < 30; r++) {
    for (let i = 0; i < 8 * r; i++) {
      const a = (i / (8 * r)) * Math.PI * 2;
      const px = x + Math.cos(a) * r * 80;
      const py = y + Math.sin(a) * r * 40;
      if (isFree(boxes, px, py)) return { x: Math.round(px), y: Math.round(py) };
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export type Side = 'n' | 'e' | 's' | 'w';
const DIR: Record<Side, Point> = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };

/** Where a node linked to `from` goes: away from the centre, on the first free row. */
export function childSpot(boxes: readonly Box[], from: Box, isRoot: boolean, rootX: number, side?: Side): XY {
  const s = side ?? (!isRoot && from.x < rootX ? 'w' : 'e');
  const dir = DIR[s];
  const x0 = from.x + dir[0] * (from.w / 2 + 100 + EST.w / 2);
  const y0 = from.y + dir[1] * (from.h / 2 + 64 + EST.h / 2);
  const perp = dir[0] ? [0, 1] : [1, 0];
  const step = dir[0] ? 58 : 175;
  for (let i = 0; i < 40; i++) {
    const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const cx = x0 + perp[0]! * k * step;
    const cy = y0 + perp[1]! * k * step;
    if (isFree(boxes, cx, cy)) return { x: Math.round(cx), y: Math.round(cy) };
  }
  return { x: Math.round(x0), y: Math.round(y0) };
}

/**
 * "Organise": a tree from the centre along the links, half to each side. Nodes that hang
 * from nothing go in a ring when nothing is linked, else in rows below the tree.
 */
export function autoLayout(rootKey: NodeKey, keys: readonly NodeKey[], edges: readonly { from: NodeKey; to: NodeKey }[], pos: ReadonlyMap<NodeKey, XY>, size: (k: NodeKey) => WH): Map<NodeKey, XY> {
  const at = (k: NodeKey) => pos.get(k) ?? { x: 0, y: 0 };
  const adj = new Map<NodeKey, NodeKey[]>(keys.map((k) => [k, []]));
  for (const e of edges) {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      adj.get(e.to)!.push(e.from);
    }
  }
  const kids = new Map<NodeKey, NodeKey[]>();
  const seen = new Set([rootKey]);
  const queue = [rootKey];
  while (queue.length) {
    const k = queue.shift()!;
    const list = adj.get(k)!.filter((nb) => !seen.has(nb));
    for (const nb of list) {
      seen.add(nb);
      queue.push(nb);
    }
    list.sort((a, b) => at(a).y - at(b).y);
    kids.set(k, list);
  }
  const GAP_X = 90;
  const GAP_Y = 22;
  const memo = new Map<NodeKey, number>();
  const subH = (k: NodeKey): number => {
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const sum = (kids.get(k) ?? []).reduce((t, c) => t + subH(c), 0);
    const v = Math.max(size(k).h + GAP_Y, sum);
    memo.set(k, v);
    return v;
  };
  const R = at(rootKey);
  const target = new Map<NodeKey, XY>([[rootKey, { x: R.x, y: R.y }]]);
  const place = (parent: NodeKey, list: readonly NodeKey[], dir: 1 | -1, extra = 0) => {
    const p = target.get(parent)!;
    let y = p.y - list.reduce((t, c) => t + subH(c), 0) / 2;
    for (const c of list) {
      const hh = subH(c);
      target.set(c, { x: Math.round(p.x + dir * (size(parent).w / 2 + GAP_X + extra + size(c).w / 2)), y: Math.round(y + hh / 2) });
      place(c, kids.get(c) ?? [], dir);
      y += hh;
    }
  };
  const first = kids.get(rootKey) ?? [];
  let right = first.filter((c) => at(c).x >= R.x);
  let left = first.filter((c) => at(c).x < R.x);
  if (first.length > 3 && (!left.length || !right.length)) {
    const half = Math.ceil(first.length / 2);
    right = first.slice(0, half);
    left = first.slice(half);
  }
  place(rootKey, right, 1, 30);
  place(rootKey, left, -1, 30);

  const loose = keys.filter((k) => !target.has(k)).sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x);
  if (loose.length && target.size === 1) {
    const placed: (XY & WH)[] = [{ ...R, ...size(rootKey) }];
    for (const k of loose) {
      const [x, y] = ringSpot(R, size(k), placed);
      target.set(k, { x, y });
      placed.push({ x, y, ...size(k) });
    }
  } else if (loose.length) {
    let y = -Infinity;
    for (const [k, p] of target) y = Math.max(y, p.y + size(k).h / 2);
    y += 110;
    const GAP = 28;
    const ROW_MAX = 1000;
    const rows: NodeKey[][] = [[]];
    let w = 0;
    for (const k of loose) {
      if (rows.at(-1)!.length && w + size(k).w > ROW_MAX) {
        rows.push([]);
        w = 0;
      }
      rows.at(-1)!.push(k);
      w += size(k).w + GAP;
    }
    for (const row of rows) {
      const total = row.reduce((t, k) => t + size(k).w, 0) + GAP * (row.length - 1);
      const rh = Math.max(...row.map((k) => size(k).h));
      let x = R.x - total / 2;
      for (const k of row) {
        target.set(k, { x: Math.round(x + size(k).w / 2), y: Math.round(y + rh / 2) });
        x += size(k).w + GAP;
      }
      y += rh + 36;
    }
  }
  return target;
}

// ───────────────────────────── edges

/** The point on the outline of a shape, in direction (dx, dy) from its centre. */
export function boundary(b: Box, dx: number, dy: number): [number, number] {
  if (!dx && !dy) return [b.x, b.y];
  const hw = b.w / 2;
  const hh = b.h / 2;
  let t: number;
  if (b.shape === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (b.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (b.shape === 'pill' && b.w >= b.h) {
    const r = hh;
    const a = hw - hh;
    if (dy) {
      const ty = r / Math.abs(dy);
      if (Math.abs(dx * ty) <= a) return [b.x + dx * ty, b.y + dy * ty];
    }
    const cx = Math.sign(dx) * a;
    const A = dx * dx + dy * dy;
    const B = -2 * dx * cx;
    const C = cx * cx - r * r;
    t = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
  } else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [b.x + dx * t, b.y + dy * t];
}

export interface Geometry {
  type: 'line' | 'poly' | 'curve';
  pts: Point[];
}

/** Where an edge runs: side to side along the wider gap, straight centre to centre, or elbowed. */
export function geometry(A: Box, B: Box, route: Route): Geometry {
  if (route === 'straight') return { type: 'line', pts: [boundary(A, B.x - A.x, B.y - A.y), boundary(B, A.x - B.x, A.y - B.y)] };
  const gapX = Math.abs(B.x - A.x) - (A.w + B.w) / 2;
  const gapY = Math.abs(B.y - A.y) - (A.h + B.h) / 2;
  const horiz = gapX >= gapY;
  // "Text only" joins along its underline.
  const sideY = (b: Box) => (b.shape === 'plain' ? b.y + b.h / 2 - 1.5 : b.y);
  let p1: Point;
  let p2: Point;
  let dir: Point;
  if (horiz) {
    const sx = B.x >= A.x ? 1 : -1;
    p1 = [A.x + (sx * A.w) / 2, sideY(A)];
    p2 = [B.x - (sx * B.w) / 2, sideY(B)];
    dir = [sx, 0];
  } else {
    const sy = B.y >= A.y ? 1 : -1;
    p1 = [A.x, A.y + (sy * A.h) / 2];
    p2 = [B.x, B.y - (sy * B.h) / 2];
    dir = [0, sy];
  }
  if (route === 'elbow') {
    if (horiz) {
      const mx = (p1[0] + p2[0]) / 2;
      return { type: 'poly', pts: [p1, [mx, p1[1]], [mx, p2[1]], p2] };
    }
    const my = (p1[1] + p2[1]) / 2;
    return { type: 'poly', pts: [p1, [p1[0], my], [p2[0], my], p2] };
  }
  const span = horiz ? Math.abs(p2[0] - p1[0]) : Math.abs(p2[1] - p1[1]);
  const k = Math.max(26, span * 0.5);
  return { type: 'curve', pts: [p1, [p1[0] + dir[0] * k, p1[1] + dir[1] * k], [p2[0] - dir[0] * k, p2[1] - dir[1] * k], p2] };
}

function towards(a: Point, b: Point, d: number): Point {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!L) return a;
  const k = Math.min(d, L * 0.5) / L;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

function neighbor(pts: readonly Point[], i: number, step: 1 | -1): Point {
  for (let j = i + step; j >= 0 && j < pts.length; j += step) {
    if (Math.hypot(pts[j]![0] - pts[i]![0], pts[j]![1] - pts[i]![1]) > 0.5) return pts[j]!;
  }
  return pts[i + step]!;
}

function arrowHead(tip: Point, from: Point, len: number): Point[] {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const bx = tip[0] - ux * len;
  const by = tip[1] - uy * len;
  const hw = len * 0.52;
  return [tip, [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]];
}

/** The SVG path of an edge, its arrow heads (the line stops short of them) and the label point. */
export function buildPath(geo: Geometry, arrow: Arrow, width: number): { d: string; heads: string[]; mid: Point } {
  const pts: Point[] = geo.pts.map((p) => [p[0], p[1]]);
  const len = 7 + width * 2.6;
  const heads: Point[][] = [];
  const last = pts.length - 1;
  if (arrow === 'end' || arrow === 'both') {
    const from = neighbor(geo.pts, last, -1);
    heads.push(arrowHead(geo.pts[last]!, from, len));
    pts[last] = towards(geo.pts[last]!, from, len * 0.7);
  }
  if (arrow === 'start' || arrow === 'both') {
    const from = neighbor(geo.pts, 0, 1);
    heads.push(arrowHead(geo.pts[0]!, from, len));
    pts[0] = towards(geo.pts[0]!, from, len * 0.7);
  }
  const f = (p: Point) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let d: string;
  let mid: Point;
  if (geo.type === 'curve') {
    d = `M${f(pts[0]!)} C${f(pts[1]!)} ${f(pts[2]!)} ${f(pts[3]!)}`;
    const [a, b, c, q] = geo.pts as [Point, Point, Point, Point];
    mid = [(a[0] + 3 * b[0] + 3 * c[0] + q[0]) / 8, (a[1] + 3 * b[1] + 3 * c[1] + q[1]) / 8];
  } else {
    d = 'M' + pts.map(f).join(' L');
    const g = geo.pts;
    const i = Math.floor((g.length - 1) / 2);
    mid = [(g[i]![0] + g[i + 1]![0]) / 2, (g[i]![1] + g[i + 1]![1]) / 2];
  }
  return { d, heads: heads.map((tri) => `M${tri.map(f).join(' L')} Z`), mid };
}

export function dashArray(dash: Dash, w: number): string | undefined {
  return dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `0.01 ${w * 2.6}` : undefined;
}

/** The path drawn while dragging a new edge out of a handle. */
export function tempPath(from: Box, side: Side, to: XY, target: Box | null): string {
  const dir = DIR[side];
  const sx = from.x + (dir[0] * from.w) / 2;
  const sy = from.y + (dir[1] * from.h) / 2;
  const [ex, ey] = target ? boundary(target, sx - target.x, sy - target.y) : [to.x, to.y];
  const k = Math.max(30, Math.hypot(ex - sx, ey - sy) * 0.4);
  return `M${sx} ${sy} Q${sx + dir[0] * k} ${sy + dir[1] * k} ${ex} ${ey}`;
}

// ───────────────────────────── view

export interface View {
  x: number;
  y: number;
  z: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function bounds(boxes: readonly (XY & WH)[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x - b.w / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y0 = Math.min(y0, b.y - b.h / 2);
    y1 = Math.max(y1, b.y + b.h / 2);
  }
  if (!Number.isFinite(x0)) return { x0: -100, y0: -50, x1: 100, y1: 50 };
  return { x0, y0, x1, y1 };
}

/**
 * The view that frames `b` in a canvas of cw × ch, leaving room for the style bar at the bottom.
 * `min` keeps text readable when framing everything would shrink it too far (a phone).
 */
export function viewFor(b: ReturnType<typeof bounds>, cw: number, ch: number, min = 0.2): View {
  const pad = cw < 600 ? 32 : 90;
  const h = ch - 70;
  const z = clamp(Math.min((cw - pad * 2) / Math.max(1, b.x1 - b.x0), (h - pad * 2) / Math.max(1, b.y1 - b.y0)), min, 1.1);
  return { z, x: cw / 2 - ((b.x0 + b.x1) / 2) * z, y: h / 2 - ((b.y0 + b.y1) / 2) * z };
}

/** How far the map zooms out and in. */
export const MAP_ZOOM = { min: 0.15, max: 3 } as const;

/** Zoom by `factor` keeping the canvas point (cx, cy) still. */
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const z = clamp(v.z * factor, MAP_ZOOM.min, MAP_ZOOM.max);
  return { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
}

export const lerpView = (a: View, b: View, t: number): View => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** Black or white text on a colour, whichever reads better. */
export function inkOn(hex: string): '#ffffff' | '#142b45' {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  return 1.05 / (L + 0.05) >= 2.9 ? '#ffffff' : '#142b45';
}
