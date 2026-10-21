'use client';

import type { LaneDto } from '@noergo/core/dto';
import { newId } from '@noergo/core/ids';
import { LIMITS } from '@noergo/core/limits';
import type { Op } from '@noergo/core/ops/schema';
import { between } from '@noergo/core/position';
import { useTranslations } from 'next-intl';
import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { agentProps, useAgentMarks, useAgentSeen } from './agent-marks';
import { isComposing, isEditable, useWorkspace } from './context';
import { ARROW_ICONS, DASH_ICONS, FILL_ICONS, IconBrush, IconClose, IconEdit, IconImage, IconFit, IconFold, IconFollow, IconGlobe, IconLink, IconMinus, IconNote, IconOrganize, IconPlus, IconSwap, IconTrash, IconUnfold, ROUTE_ICONS, SHAPE_ICONS, WidthIcon } from './icons';
import { splitText } from './import-ideario';
import {
  ARROWS,
  autoLayout,
  bounds,
  buildPath,
  childSpot,
  clamp,
  DASHES,
  dashArray,
  EDGE_DEFAULT,
  edgeBetween,
  FILLS,
  freeNear,
  geometry,
  GUESS,
  keyOf,
  laneMap,
  lerpView,
  NODE_DEFAULT,
  ROUTES,
  SHAPES,
  SIZES,
  tempPath,
  viewFor,
  WIDTHS,
  zoomAt,
  MAP_ZOOM,
  type Box,
  type EdgeStyle,
  type MapEdge,
  type MapNode,
  type NodeKey,
  type NodeStyle,
  type Side,
  type View,
  type WH,
  type XY,
} from './map';
import { CoverArt } from './CoverArt';
import { DescriptionField, NameField } from './Customize';
import { corProps, laneStyle } from './cover';
import { useFileDrag, useImageDrop, useLaneLook } from './cover-client';
import { Markdown } from './Markdown';
import { colorName, notesByLane, PALETTE, type Data } from './model';
import { BodyEditor, DueField, LinkField, NoteTitle, TagsField, useOpenByTitle } from './NoteDrawer';
import { siteHost } from './site';
import type { AgentMark } from './store';
import { mapTree } from './tree';
import { FOLLOW_AGENT, fromLogSlider, toLogSlider } from './view-prefs';
import './map.css';

/**
 * The mind map of a column (the prototype's map, live): the column at the centre, its
 * notes around it, links between them. Everything saves as it happens, because agents
 * edit at the same time; ⌘Z undoes through the store like on the board.
 *
 * Panning and zooming write the transform straight to the DOM, so they never re-render;
 * dragging re-renders only the nodes that move.
 */

type LayoutNode = Extract<Op, { type: 'layout.set' }>['nodes'][number];
type NodeChange = Partial<XY & NodeStyle>;
interface Sel {
  nodes: readonly NodeKey[];
  edge: string | null;
}
/** Where the text of the idea under the mouse shows, in the map's viewport. */
interface Peek {
  key: NodeKey;
  x: number;
  y: number;
  above: boolean;
}
/** The fold of the idea in the panel: how many it hides or would hide, and what stops it. */
interface FoldInfo {
  folded: number;
  count: number;
  blocker: string | null;
}
interface Ghost extends XY {
  from: NodeKey | null;
  style: NodeStyle;
}
type Gesture =
  | { kind: 'pan'; id: number; sx: number; sy: number; v0: View; moved: boolean }
  | { kind: 'move'; id: number; sx: number; sy: number; origin: ReadonlyMap<NodeKey, XY>; moved: boolean; hit: NodeKey; toggle: boolean; only: boolean }
  | { kind: 'connect'; id: number; sx: number; sy: number; from: NodeKey; side: Side; moved: boolean }
  | { kind: 'marquee'; id: number; sx: number; sy: number; base: readonly NodeKey[]; moved: boolean }
  | { kind: 'pinch'; d0: number; m0: XY; v0: View };

const NONE: Sel = { nodes: [], edge: null };
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const GHOST = 'ghost';
const MAX_NODES = 500;
const THRESHOLD = 3;
const NUDGE_MS = 700;
const LAYOUT_MS = 460;
/** How long the mouse rests on an idea before its text shows, and how wide that is. */
const PEEK_MS = 450;
const PEEK_W = 320;
const PEEK_ROOM = 200;

const refOf = (k: NodeKey) => {
  const i = k.indexOf(':');
  return { kind: k.slice(0, i) as 'note' | 'lane', id: k.slice(i + 1) };
};
const chunks = <T,>(list: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += MAX_NODES) out.push(list.slice(i, i + MAX_NODES));
  return out;
};
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

/** Only what differs from the default travels. */
function styleOp(s: EdgeStyle): { style?: Partial<EdgeStyle> } {
  const diff = Object.fromEntries(Object.entries(s).filter(([k, v]) => EDGE_DEFAULT[k as keyof EdgeStyle] !== v)) as Partial<EdgeStyle>;
  return Object.keys(diff).length ? { style: diff } : {};
}

/** The layouts every node without a stored spot gets on the first write, so none of them jumps. */
function frozen(nodes: readonly MapNode[]): LayoutNode[] {
  return nodes.filter((n) => !n.placed).map((n) => ({ kind: n.ref.kind, id: n.ref.id, x: Math.round(n.x), y: Math.round(n.y), shape: n.shape, fill: n.fill, size: n.size, color: n.color }));
}

export function LaneMap({ data, laneId, blocked, onClose }: { data: Data; laneId: string; blocked: boolean; onClose: () => void }) {
  const t = useTranslations('app');
  const { store, actions, openNote, customize } = useWorkspace();
  const { lanes, notes, links, layouts } = data;
  const rootKey = keyOf({ kind: 'lane', id: laneId });
  const full = useMemo(() => laneMap({ lanes, notes, links, layouts }, laneId), [lanes, notes, links, layouts, laneId]);
  const tree = useMemo(() => (full ? mapTree(full, rootKey) : null), [full, rootKey]);
  /** What is on show: a folded idea's branch is left out, with its links. */
  const map = useMemo(() => {
    if (!full || !tree?.hidden.size) return full;
    const hid = tree.hidden;
    return { ...full, nodes: full.nodes.filter((n) => !hid.has(n.key)), edges: full.edges.filter((e) => !hid.has(e.from) && !hid.has(e.to)) };
  }, [full, tree]);
  const byKey = useMemo(() => new Map(full?.nodes.map((n) => [n.key, n])), [full]);
  const look = useLaneLook(lanes.get(laneId));
  const laneColor = look.color ?? undefined;
  const files = useFileDrag();
  const bar = useRef<HTMLElement>(null);
  const personalize = (file?: File, from?: Element) => customize(laneId, (from ?? bar.current!).getBoundingClientRect(), file);
  const drop = useImageDrop(
    (file) => personalize(file),
    () => store.notify({ tone: 'error', key: 'coverNotImage' }),
  );

  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const zoomRange = useRef<HTMLInputElement>(null);
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const viewAnim = useRef(0);
  const layoutAnim = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, XY>());
  const nudging = useRef<{ keys: string; origin: ReadonlyMap<NodeKey, XY>; dx: number; dy: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastEdge = useRef<EdgeStyle>(EDGE_DEFAULT);
  const resize = useRef<ResizeObserver | null>(null);

  const [sel, setSel] = useState<Sel>(NONE);
  const [editing, setEditing] = useState<NodeKey | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [live, setLive] = useState<ReadonlyMap<NodeKey, XY> | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<NodeKey, WH>>(() => new Map());
  const [temp, setTemp] = useState<{ from: NodeKey; side: Side; to: XY; target: NodeKey | null } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [labelEdit, setLabelEdit] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const hovered = useRef<NodeKey | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agentMarks = useAgentMarks();
  const follow = FOLLOW_AGENT.use() === 'on';
  const agentSeen = useAgentSeen();
  /** When the person last moved the map (event time): the camera never follows an agent against their hand. */
  const touched = useRef(-Infinity);
  const followed = useRef(0);

  const boxes = useMemo(() => {
    const out = new Map<NodeKey, Box>();
    for (const n of map?.nodes ?? []) {
      const p = live?.get(n.key) ?? n;
      const s = sizes.get(n.key) ?? GUESS;
      out.set(n.key, { x: p.x, y: p.y, w: s.w, h: s.h, shape: n.shape });
    }
    return out;
  }, [map, live, sizes]);

  /** The colour a node shows: its own on the map, else the note's, else the column's. */
  const colors = useMemo(() => {
    const out = new Map<NodeKey, string | undefined>();
    for (const n of map?.nodes ?? []) out.set(n.key, n.color ?? n.note?.color ?? laneColor);
    return out;
  }, [map, laneColor]);

  // ───────────────────────────── view

  const applyView = useCallback(() => {
    const v = view.current;
    if (world.current) world.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    const c = canvas.current;
    if (c) {
      c.style.setProperty('--z', String(v.z));
      c.style.setProperty('--gx', `${v.x}px`);
      c.style.setProperty('--gy', `${v.y}px`);
    }
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(v.z * 100)}%`;
    const r = zoomRange.current;
    if (r) {
      r.value = String(toLogSlider(v.z, MAP_ZOOM.min, MAP_ZOOM.max));
      r.setAttribute('aria-valuetext', `${Math.round(v.z * 100)}%`);
    }
  }, []);

  const setView = useCallback(
    (v: View) => {
      view.current = v;
      applyView();
    },
    [applyView],
  );

  const animateView = useCallback(
    (to: View, ms = 320) => {
      cancelAnimationFrame(viewAnim.current);
      if (reducedMotion()) return setView(to);
      const from = view.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        setView(lerpView(from, to, easeOut(p)));
        if (p < 1) viewAnim.current = requestAnimationFrame(step);
      };
      viewAnim.current = requestAnimationFrame(step);
    },
    [setView],
  );

  const size = () => ({ w: canvas.current?.clientWidth ?? 800, h: canvas.current?.clientHeight ?? 600 });

  const fitTo = (pos?: ReadonlyMap<NodeKey, XY>, animate = true) => {
    const list = [...boxes].map(([k, b]) => ({ ...b, ...pos?.get(k) }));
    const { w, h } = size();
    const v = viewFor(bounds(list), w, h);
    if (animate) animateView(v);
    else setView(v);
  };

  const zoomBy = (f: number) => {
    const { w, h } = size();
    animateView(zoomAt(view.current, f, w / 2, h / 2), 160);
  };

  /** The slider: straight to that zoom, around the centre, no easing (the hand is the easing). */
  const zoomToSlider = (t: number) => {
    cancelAnimationFrame(viewAnim.current);
    const { w, h } = size();
    const v = view.current;
    setView(zoomAt(v, fromLogSlider(t, MAP_ZOOM.min, MAP_ZOOM.max) / v.z, w / 2, h / 2));
  };

  /** Brings a world point into view if it is off screen. */
  const reveal = (p: XY) => {
    const v = view.current;
    const { w, h } = size();
    const sx = p.x * v.z + v.x;
    const sy = p.y * v.z + v.y;
    if (sx > 90 && sy > 90 && sx < w - 90 && sy < h - 160) return;
    animateView({ ...v, x: w / 2 - p.x * v.z, y: (h - 70) / 2 - p.y * v.z });
  };

  // Follow the agent: the newest idea it added, if off screen, comes into view, unless the
  // person moved the map in the last few seconds. Focus never moves.
  useEffect(() => {
    let newest: { key: NodeKey; at: number } | null = null;
    for (const n of map?.nodes ?? []) {
      const m = n.note ? agentMarks.get(n.note.id) : undefined;
      if (m?.fresh && m.at > followed.current && (!newest || m.at > newest.at)) newest = { key: n.key, at: m.at };
    }
    if (!newest) return;
    followed.current = newest.at;
    const b = boxes.get(newest.key);
    if (follow && b && performance.now() - touched.current > 5000) reveal(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on new marks only; boxes is read as of now
  }, [agentMarks, map, follow]);

  // The first frame already framed: measure what was just drawn, before the paint.
  useLayoutEffect(() => {
    const c = canvas.current;
    const w = world.current;
    if (!c || !w) return;
    const list: (XY & WH)[] = [];
    for (const el of w.querySelectorAll<HTMLElement>('[data-key]')) list.push({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight });
    // On a phone, open at a size that can be read and let the edges run off; "fit" still shows all.
    setView(viewFor(bounds(list), c.clientWidth, c.clientHeight, c.clientWidth < 600 ? 0.7 : 0.2));
    c.focus({ preventScroll: true });
  }, [laneId, setView]);

  useEffect(
    () => () => {
      cancelAnimationFrame(viewAnim.current);
      cancelAnimationFrame(layoutAnim.current);
      clearTimeout(peekTimer.current);
      resize.current?.disconnect();
    },
    [],
  );

  const observe = useCallback((el: HTMLElement) => {
    resize.current ??= new ResizeObserver((entries) => {
      setSizes((prev) => {
        let next: Map<NodeKey, WH> | null = null;
        for (const e of entries) {
          const node = e.target as HTMLElement;
          const k = node.dataset.key;
          if (!k) continue;
          const w = node.offsetWidth;
          const h = node.offsetHeight;
          const cur = prev.get(k);
          if (cur && cur.w === w && cur.h === h) continue;
          next ??= new Map(prev);
          next.set(k, { w, h });
        }
        return next ?? prev;
      });
    });
    const ro = resize.current;
    ro.observe(el);
    return () => ro.unobserve(el);
  }, []);

  // ───────────────────────────── writes

  const current = () => {
    const d = store.getState().data;
    return d ? laneMap(d, laneId) : null;
  };

  /** Positions and styles, in one undoable step. */
  const commitLayout = (changes: ReadonlyMap<NodeKey, NodeChange>) => {
    const m = current();
    if (!m) return;
    const set: LayoutNode[] = [];
    const back: LayoutNode[] = [];
    const gone: { kind: 'note' | 'lane'; id: string }[] = [];
    for (const n of m.nodes) {
      const c = changes.get(n.key);
      const { kind, id } = n.ref;
      if (!n.placed) {
        set.push({ kind, id, x: Math.round(c?.x ?? n.x), y: Math.round(c?.y ?? n.y), shape: c?.shape ?? n.shape, fill: c?.fill ?? n.fill, size: c?.size ?? n.size, color: c?.color !== undefined ? c.color : n.color });
        gone.push({ kind, id });
        continue;
      }
      if (!c) continue;
      const next: LayoutNode = { kind, id, x: Math.round(c.x ?? n.x), y: Math.round(c.y ?? n.y) };
      const prev: LayoutNode = { kind, id, x: n.x, y: n.y };
      let changed = next.x !== n.x || next.y !== n.y;
      if (c.shape !== undefined && c.shape !== n.shape) [next.shape, prev.shape, changed] = [c.shape, n.shape, true];
      if (c.fill !== undefined && c.fill !== n.fill) [next.fill, prev.fill, changed] = [c.fill, n.fill, true];
      if (c.size !== undefined && c.size !== n.size) [next.size, prev.size, changed] = [c.size, n.size, true];
      if (c.color !== undefined && c.color !== n.color) [next.color, prev.color, changed] = [c.color, n.color, true];
      if (!changed) continue;
      set.push(next);
      back.push(prev);
    }
    if (!set.length) return;
    const where = { viewKind: 'lane_map', viewId: laneId } as const;
    const undo: Op[] = [...chunks(back).map((nodes) => ({ type: 'layout.set' as const, ...where, nodes })), ...chunks(gone).map((nodes) => ({ type: 'layout.remove' as const, ...where, nodes }))];
    store.dispatch(
      chunks(set).map((nodes) => ({ type: 'layout.set', ...where, nodes })),
      { undo },
    );
  };

  /** A new note on the map, linked from `from` when given. */
  const createNode = (at: XY, text: string, from: NodeKey | null, style: NodeStyle, url?: string): string | null => {
    const d = store.getState().data;
    const m = d && laneMap(d, laneId);
    const { title, body } = splitText(text);
    if (!d || !m || !title) return null;
    const id = newId();
    // A loose idea opens the column; one hanging from another comes after its siblings, as typed.
    const list = notesByLane(d.notes, [laneId]).get(laneId) ?? [];
    const position = from?.startsWith('note:') ? between(list.at(-1)?.position ?? null, null) : between(null, list[0]?.position ?? null);
    const ops: Op[] = [{ type: 'note.create', id, laneId, title, ...(body ? { body } : {}), ...(url ? { url } : {}), place: { position } }];
    const layout: LayoutNode[] = [...frozen(m.nodes), { kind: 'note', id, x: Math.round(at.x), y: Math.round(at.y), ...style }];
    for (const nodes of chunks(layout)) ops.push({ type: 'layout.set', viewKind: 'lane_map', viewId: laneId, nodes });
    if (from && m.nodes.some((n) => n.key === from)) ops.push({ type: 'link.create', id: newId(), from: refOf(from), to: { kind: 'note', id }, ...styleOp(lastEdge.current) });
    // A folded parent opens, or the new idea would vanish as it lands.
    const parentNote = from ? m.nodes.find((n) => n.key === from)?.note : null;
    if (parentNote?.collapsed) ops.push({ type: 'note.update', id: parentNote.id, collapsed: false });
    store.dispatch(ops, { undo: [{ type: 'note.delete', id }], redo: [{ type: 'note.restore', id }] });
    return id;
  };

  const connect = (from: NodeKey, to: NodeKey) => {
    if (!map || from === to) return;
    const dup = edgeBetween(map.edges, from, to);
    if (dup) {
      setSel({ nodes: [], edge: dup.id });
      store.notify({ tone: 'info', key: 'alreadyLinked' });
      return;
    }
    const id = newId();
    // A folded idea opens first: what it now links to would vanish under the fold.
    const source = byKey.get(from)?.note;
    if (source?.collapsed) actions.setCollapsed([source.id], false);
    store.dispatch({ type: 'link.create', id, from: refOf(from), to: refOf(to), ...styleOp(lastEdge.current) }, { undo: [{ type: 'link.delete', id }], redo: [{ type: 'link.restore', id }] });
    setSel({ nodes: [], edge: id });
  };

  const updateLink = (id: string, patch: { label?: string; style?: Partial<EdgeStyle> }) => {
    const cur = store.getState().data?.links.get(id);
    if (!cur) return;
    const style = patch.style;
    const undo: Op = {
      type: 'link.update',
      id,
      ...(patch.label !== undefined ? { label: cur.label } : {}),
      ...(style ? { style: Object.fromEntries(Object.keys(style).map((k) => [k, cur.style[k as keyof EdgeStyle] ?? EDGE_DEFAULT[k as keyof EdgeStyle]])) } : {}),
    };
    store.dispatch({ type: 'link.update', id, ...patch }, { undo: [undo] });
    if (style) lastEdge.current = { ...lastEdge.current, ...style };
  };

  /** The selected nodes still on the map (another tab or an agent may have removed one). */
  const selKeys = () => sel.nodes.filter((k) => boxes.has(k));

  /** Where `keys` are, and with each folded one what it hides, which travels along and opens where it belongs. */
  const carried = (keys: readonly NodeKey[]): Map<NodeKey, XY> => {
    const out = new Map<NodeKey, XY>();
    for (const k of keys) {
      const b = boxes.get(k);
      if (b) out.set(k, b);
    }
    for (const k of keys) {
      for (const h of tree?.folded.get(k) ?? []) {
        const n = byKey.get(h);
        if (n && !out.has(h)) out.set(h, { x: n.x, y: n.y });
      }
    }
    return out;
  };

  /** Folds or opens `keys`: open if any is folded, else fold those that can. One that cannot says why. */
  const toggleFold = (keys: readonly NodeKey[]) => {
    if (!tree) return;
    const list = keys.map((k) => byKey.get(k)?.note).filter((n) => !!n);
    const open = list.filter((n) => n.collapsed);
    if (open.length) return actions.setCollapsed(open.map((n) => n.id), false);
    const can = list.filter((n) => tree.blocker(keyOf({ kind: 'note', id: n.id })) === null);
    if (can.length) return actions.setCollapsed(can.map((n) => n.id), true);
    const why = list.map((n) => tree.blocker(keyOf({ kind: 'note', id: n.id }))).find((b) => b !== null && b !== 'leaf');
    if (why) store.notify({ tone: 'info', key: 'foldBlocked', values: { title: byKey.get(why)?.title || t('note.untitled') } });
  };

  /** Every branch that can fold, at every level; or everything open again. */
  const foldAll = (fold: boolean) => {
    if (!tree || !full) return;
    const list = full.nodes.filter((n) => n.note && (fold ? !n.note.collapsed && tree.blocker(n.key) === null : n.note.collapsed));
    actions.setCollapsed(
      list.map((n) => n.note!.id),
      fold,
    );
  };

  /** Opens a folded idea before something new hangs from it, and gives back where its branch sits. */
  const unfold = (key: NodeKey): Box[] => {
    const note = byKey.get(key)?.note;
    if (!note?.collapsed) return [];
    actions.setCollapsed([note.id], false);
    return (tree?.folded.get(key) ?? []).flatMap((h) => {
      const n = byKey.get(h);
      return n ? [{ x: n.x, y: n.y, ...(sizes.get(h) ?? GUESS), shape: n.shape }] : [];
    });
  };

  const deleteSelection = () => {
    if (sel.edge) {
      const e = map?.edges.find((x) => x.id === sel.edge);
      if (!e) return;
      if (e.origin === 'wikilink') return store.notify({ tone: 'info', key: 'wikilinkLink' });
      store.dispatch({ type: 'link.delete', id: e.id }, { undo: [{ type: 'link.restore', id: e.id }] });
      setSel(NONE);
      return;
    }
    const ids = selKeys().filter((k) => k !== rootKey).map((k) => refOf(k).id);
    if (!ids.length) return;
    const undo: Op[] = ids.map((id) => ({ type: 'note.restore', id }));
    store.dispatch(
      ids.map((id) => ({ type: 'note.delete', id })),
      { undo },
    );
    store.notify({ tone: 'info', key: 'deletedNotes', values: { count: ids.length }, undo: () => store.dispatch(undo) });
    setSel(NONE);
  };

  /** What a node linked from `k` starts as: its parent's look, unless the parent is the column. */
  const inherited = (k: NodeKey): NodeStyle => {
    const n = k === rootKey ? undefined : map?.nodes.find((x) => x.key === k);
    return n ? { shape: n.shape, fill: n.fill, size: n.size, color: n.color ?? n.note?.color ?? null } : NODE_DEFAULT;
  };

  const spawnChild = (from: Box, key: NodeKey, style: NodeStyle, side?: Side, more: readonly Box[] = []) => {
    const rootBox = boxes.get(rootKey);
    if (!rootBox) return;
    const spot = childSpot([...boxes.values(), ...more, from], from, key === rootKey, rootBox.x, side);
    setGhost({ ...spot, from: key, style });
    setEditing(null);
    reveal(spot);
  };

  const addChild = (key: NodeKey, side?: Side) => {
    const b = boxes.get(key);
    if (b) spawnChild(b, key, inherited(key), side, unfold(key));
  };

  const newThought = () => {
    if (sel.nodes.length === 1) return addChild(sel.nodes[0]!);
    const { w, h } = size();
    const v = view.current;
    const at = freeNear([...boxes.values()], (w / 2 - v.x) / v.z, ((h - 70) / 2 - v.y) / v.z);
    setSel(NONE);
    setGhost({ ...at, from: null, style: NODE_DEFAULT });
  };

  const focusCanvas = () => canvas.current?.focus({ preventScroll: true });

  const finishEdit = (key: NodeKey, text: string | null, then?: 'child') => {
    setEditing(null);
    focusCanvas();
    if (text === null) return;
    const clean = text.replace(/\s+/g, ' ').trim();
    const { kind, id } = refOf(key);
    if (clean && kind === 'lane' && clean !== map?.lane.title) actions.updateLane(id, { title: clean.slice(0, LIMITS.laneTitle) });
    if (clean && kind === 'note' && clean !== store.note(id)?.title) actions.updateNote(id, { title: clean.slice(0, LIMITS.noteTitle) });
    if (then === 'child') addChild(key);
  };

  const finishGhost = (text: string | null, then?: 'child') => {
    const g = ghost;
    setGhost(null);
    focusCanvas();
    if (!g || text === null || !text.trim()) return;
    const id = createNode(g, text, g.from, g.style);
    if (!id) return;
    const key = keyOf({ kind: 'note', id });
    setSel({ nodes: [key], edge: null });
    if (then === 'child') spawnChild({ x: g.x, y: g.y, ...(sizes.get(GHOST) ?? GUESS), shape: g.style.shape }, key, g.style);
  };

  const organize = () => {
    if (!map) return;
    const keys = map.nodes.map((n) => n.key);
    const from = new Map(keys.map((k) => [k, boxes.get(k)!] as const));
    const target = autoLayout(rootKey, keys, map.edges, from, (k) => sizes.get(k) ?? GUESS);
    // A folded branch keeps its shape and moves with the idea that holds it.
    const saved = new Map(target);
    for (const [k, hid] of tree?.folded ?? []) {
      const a = from.get(k);
      const b = target.get(k);
      if (!a || !b) continue;
      for (const h of hid) {
        const n = byKey.get(h);
        if (n) saved.set(h, { x: n.x + b.x - a.x, y: n.y + b.y - a.y });
      }
    }
    const finish = () => {
      commitLayout(saved);
      setLive(null);
      fitTo(target);
    };
    cancelAnimationFrame(layoutAnim.current);
    if (reducedMotion()) return finish();
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const p = easeOut(Math.min(1, (now - t0) / LAYOUT_MS));
      setLive(new Map(keys.map((k) => [k, { x: from.get(k)!.x + (target.get(k)!.x - from.get(k)!.x) * p, y: from.get(k)!.y + (target.get(k)!.y - from.get(k)!.y) * p }])));
      if (p < 1) layoutAnim.current = requestAnimationFrame(step);
      else finish();
    };
    layoutAnim.current = requestAnimationFrame(step);
  };

  /** Arrow keys move the selection; a run of presses is one undo step. */
  const nudge = (dx: number, dy: number) => {
    const sk = selKeys();
    const keys = sk.join(' ');
    let n = nudging.current;
    if (n && n.keys !== keys) {
      clearTimeout(n.timer);
      flushNudge();
      n = null;
    }
    const origin = n?.origin ?? carried(sk);
    const next = { keys, origin, dx: (n?.dx ?? 0) + dx, dy: (n?.dy ?? 0) + dy, timer: setTimeout(() => flushNudge(), NUDGE_MS) };
    if (n) clearTimeout(n.timer);
    nudging.current = next;
    setLive(new Map([...origin].map(([k, p]) => [k, { x: p.x + next.dx, y: p.y + next.dy }])));
  };

  const flushNudge = () => {
    const n = nudging.current;
    if (!n) return;
    nudging.current = null;
    clearTimeout(n.timer);
    commitLayout(new Map([...n.origin].map(([k, p]) => [k, { x: p.x + n.dx, y: p.y + n.dy }])));
    setLive(null);
  };
  const flushOnLeave = useEffectEvent(flushNudge);
  useEffect(() => () => flushOnLeave(), []);

  // ───────────────────────────── pointer

  const toCanvas = (p: { clientX: number; clientY: number }): XY => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const toWorld = (p: XY): XY => {
    const v = view.current;
    return { x: (p.x - v.x) / v.z, y: (p.y - v.y) / v.z };
  };
  const keyAt = (cx: number, cy: number, skip?: NodeKey): NodeKey | null => {
    const k = document.elementFromPoint(cx, cy)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    return k && k !== GHOST && k !== skip ? k : null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    touched.current = e.timeStamp;
    hover(null);
    const target = e.target as HTMLElement;
    if (target.closest('[contenteditable], [data-chip]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    focusCanvas();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a synthetic event): nothing to follow.
    }
    cancelAnimationFrame(viewAnim.current);
    if (pointers.current.size === 2) {
      // A second finger: whatever the first one started becomes a pinch.
      const g = gesture.current;
      if (g?.kind === 'move') setLive(null);
      if (g?.kind === 'connect') setTemp(null);
      if (g?.kind === 'marquee') setMarquee(null);
      const [a, b] = [...pointers.current.values()] as [XY, XY];
      gesture.current = { kind: 'pinch', d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: toCanvas({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }), v0: view.current };
      return;
    }
    if (pointers.current.size > 2) return;
    const base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    const handle = target.closest<HTMLElement>('[data-handle]');
    const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
    const edge = (target.closest('[data-edge]') as HTMLElement | SVGElement | null)?.dataset.edge;
    if (e.button === 1 || space) {
      gesture.current = { kind: 'pan', ...base, v0: view.current };
    } else if (handle && key && key !== GHOST) {
      gesture.current = { kind: 'connect', ...base, from: key, side: handle.dataset.handle as Side };
    } else if (key && key !== GHOST) {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const cur = selKeys();
      const was = cur.includes(key);
      const nodes = was ? cur : additive ? [...cur, key] : [key];
      setSel({ nodes, edge: null });
      setLabelEdit(null);
      gesture.current = { kind: 'move', ...base, origin: carried(nodes), hit: key, toggle: additive && was, only: !additive && was && nodes.length > 1 };
    } else if (edge) {
      setSel({ nodes: [], edge });
      gesture.current = null;
    } else if (e.shiftKey) {
      gesture.current = { kind: 'marquee', ...base, base: sel.nodes };
    } else {
      gesture.current = { kind: 'pan', ...base, v0: view.current };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const m = toCanvas({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const z = clamp((g.v0.z * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, 0.15, 3);
      const wx = (g.m0.x - g.v0.x) / g.v0.z;
      const wy = (g.m0.y - g.v0.y) / g.v0.z;
      setView({ z, x: m.x - wx * z, y: m.y - wy * z });
      return;
    }
    if (g.id !== e.pointerId) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      g.moved = true;
      if (g.kind === 'pan') setPanning(true);
    }
    const z = view.current.z;
    if (g.kind === 'pan') setView({ ...view.current, x: g.v0.x + dx, y: g.v0.y + dy });
    else if (g.kind === 'move') setLive(new Map([...g.origin].map(([k, p]) => [k, { x: p.x + dx / z, y: p.y + dy / z }])));
    else if (g.kind === 'connect') setTemp({ from: g.from, side: g.side, to: toWorld(toCanvas(e)), target: keyAt(e.clientX, e.clientY, g.from) });
    else {
      const a = toCanvas({ clientX: g.sx, clientY: g.sy });
      const b = toCanvas(e);
      setMarquee({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (!pointers.current.size) gesture.current = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    gesture.current = null;
    const cancelled = e.type === 'pointercancel';
    const z = view.current.z;
    switch (g.kind) {
      case 'pan':
        setPanning(false);
        if (!g.moved && !cancelled) {
          setSel(NONE);
          setLabelEdit(null);
        }
        return;
      case 'move':
        if (g.moved && !cancelled) {
          const dx = (e.clientX - g.sx) / z;
          const dy = (e.clientY - g.sy) / z;
          commitLayout(new Map([...g.origin].map(([k, p]) => [k, { x: p.x + dx, y: p.y + dy }])));
        } else if (!g.moved && g.toggle) setSel({ nodes: sel.nodes.filter((k) => k !== g.hit), edge: null });
        else if (!g.moved && g.only) setSel({ nodes: [g.hit], edge: null });
        setLive(null);
        if (!g.moved && !cancelled && !g.toggle) keepInSight(g.hit);
        return;
      case 'connect': {
        setTemp(null);
        if (cancelled) return;
        if (!g.moved) return addChild(g.from, g.side);
        const to = keyAt(e.clientX, e.clientY, g.from);
        if (to) return connect(g.from, to);
        const at = toWorld(toCanvas(e));
        setGhost({ x: Math.round(at.x), y: Math.round(at.y), from: g.from, style: inherited(g.from) });
        return;
      }
      case 'marquee': {
        setMarquee(null);
        if (!g.moved || cancelled) return;
        const a = toWorld(toCanvas({ clientX: g.sx, clientY: g.sy }));
        const b = toWorld(toCanvas(e));
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        const hit = [...boxes].filter(([, n]) => n.x + n.w / 2 >= x0 && n.x - n.w / 2 <= x1 && n.y + n.h / 2 >= y0 && n.y - n.h / 2 <= y1).map(([k]) => k);
        setSel({ nodes: [...new Set([...g.base, ...hit])], edge: null });
        return;
      }
    }
  };

  // ───────────────────────────── the text under the mouse, the panel

  /** A mouse resting on an idea shows its text after a moment; leaving it, or any gesture, hides it. */
  const hover = (key: NodeKey | null) => {
    const k = key === GHOST ? null : key;
    if (k === hovered.current) return;
    hovered.current = k;
    clearTimeout(peekTimer.current);
    setPeek(null);
    if (!k) return;
    peekTimer.current = setTimeout(() => {
      const el = world.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`);
      const box = viewport.current?.getBoundingClientRect();
      if (!el || !box || gesture.current) return;
      const r = el.getBoundingClientRect();
      const above = box.bottom - r.bottom < PEEK_ROOM && r.top - box.top > box.bottom - r.bottom;
      const half = Math.min(PEEK_W, box.width - 16) / 2;
      const x = Math.max(half + 8, Math.min(box.width - half - 8, r.left + r.width / 2 - box.left));
      setPeek({ key: k, x, y: above ? r.top - box.top - 10 : r.bottom - box.top + 10, above });
    }, PEEK_MS);
  };

  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || gesture.current) return;
    hover((e.target as Element).closest<HTMLElement>('[data-key]')?.dataset.key ?? null);
  };

  /** The idea just clicked stays in sight: beside the panel, or above the sheet on a phone. */
  const keepInSight = (key: NodeKey) => {
    const el = world.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    const c = canvas.current?.getBoundingClientRect();
    if (!el || !c) return;
    const r = el.getBoundingClientRect();
    const p = panel.current?.getBoundingClientRect();
    const covers = !!p && p.left < c.right && p.right > c.left && p.top < c.bottom && p.bottom > c.top;
    const right = c.right - 24;
    const bottom = (covers ? p.top : c.bottom) - 24;
    const dx = r.right > right ? Math.max(right - r.right, c.left + 24 - r.left) : 0;
    const dy = r.bottom > bottom ? Math.max(bottom - r.bottom, c.top + 24 - r.top) : 0;
    if (dx || dy) animateView({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
  };

  const closePanel = () => {
    setSel(NONE);
    setLabelEdit(null);
    focusCanvas();
  };

  /** The fold button and the count beside an idea: buttons inside the canvas, so their clicks land here. */
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-fold]');
    const key = b?.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) toggleFold([key]);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Under pointer capture the event lands on the canvas: look at what is really there.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || under.closest('[contenteditable], [data-chip]')) return;
    const key = under.closest<HTMLElement>('[data-key]')?.dataset.key;
    const edge = (under.closest('[data-edge]') as HTMLElement | SVGElement | null)?.dataset.edge;
    if (key === GHOST) return;
    if (key) {
      setSel({ nodes: [key], edge: null });
      setEditing(key);
    } else if (edge) {
      setSel({ nodes: [], edge });
      setLabelEdit(edge);
    } else {
      const at = toWorld(toCanvas(e));
      setSel(NONE);
      setGhost({ x: Math.round(at.x), y: Math.round(at.y), from: null, style: NODE_DEFAULT });
    }
  };

  // ───────────────────────────── keyboard, wheel, paste

  /** Keys reach the map when it has focus, or nobody has (and no drawer or search is open). */
  const forMap = (target: EventTarget | null) => {
    if (isEditable(target)) return false;
    if (target instanceof Node && root.current?.contains(target)) return true;
    return !blocked && (target === document.body || target === null);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || !map || !forMap(e.target)) return;
    const onCanvas = e.target === canvas.current || e.target === document.body;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod) {
      if (!onCanvas || e.altKey) return;
      if (k.toLowerCase() === 'a') setSel({ nodes: map.nodes.map((n) => n.key), edge: null });
      else if (k === '=' || k === '+') zoomBy(1.25);
      else if (k === '-') zoomBy(0.8);
      else if (k === '0') zoomBy(1 / view.current.z);
      else if (k === '.' && sel.nodes.length) toggleFold(sel.nodes);
      else return;
      e.preventDefault();
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      if (sel.nodes.length || sel.edge) {
        setSel(NONE);
        setLabelEdit(null);
        canvas.current?.focus({ preventScroll: true });
      } else onClose();
      return;
    }
    if (!onCanvas) return;
    const one = sel.nodes.length === 1 ? sel.nodes[0]! : null;
    if (k === 'Delete' || k === 'Backspace') {
      if (!sel.nodes.length && !sel.edge) return;
      deleteSelection();
    } else if (k === 'Tab') {
      if (!one) return;
      addChild(one);
    } else if (k === 'Enter' || k === 'F2') {
      if (one) setEditing(one);
      else if (sel.edge) setLabelEdit(sel.edge);
      else return;
    } else if (k === ' ') {
      if (!e.repeat) setSpace(true);
    } else if (k.startsWith('Arrow') && sel.nodes.length) {
      const step = e.shiftKey ? 10 : 2;
      nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
    } else return;
    e.preventDefault();
  });

  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === ' ') setSpace(false);
  });

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (!map || !forMap(e.target)) return;
    const text = e.clipboardData?.getData('text/plain').trim();
    if (!text) return;
    e.preventDefault();
    const one = sel.nodes.length === 1 ? sel.nodes[0]! : null;
    const b = one ? boxes.get(one) : undefined;
    const rootBox = boxes.get(rootKey)!;
    let at: XY;
    if (one && b) at = childSpot([...boxes.values()], b, one === rootKey, rootBox.x);
    else {
      const { w, h } = size();
      const v = view.current;
      at = freeNear([...boxes.values()], (w / 2 - v.x) / v.z, ((h - 70) / 2 - v.y) / v.z);
    }
    const id = createNode(at, text, one, one ? inherited(one) : NODE_DEFAULT, isUrl(text) ? text : undefined);
    if (id) setSel({ nodes: [keyOf({ kind: 'note', id })], edge: null });
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => onKey(e);
    const up = (e: KeyboardEvent) => onKeyUp(e);
    const paste = (e: ClipboardEvent) => onPaste(e);
    const blur = () => setSpace(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('paste', paste);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('paste', paste);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // A wheel listener React would register as passive: it must be able to stop the page zoom.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = e.timeStamp;
      clearTimeout(peekTimer.current);
      hovered.current = null;
      setPeek(null);
      cancelAnimationFrame(viewAnim.current);
      const k = e.deltaMode === 1 ? 16 : 1;
      const v = view.current;
      if (e.ctrlKey || e.metaKey) {
        const r = c.getBoundingClientRect();
        setView(zoomAt(v, Math.exp(-e.deltaY * k * 0.0105), e.clientX - r.left, e.clientY - r.top));
      } else setView({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k });
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [setView]);

  if (!map) return null;

  // ───────────────────────────── render

  const selected = new Set(sel.nodes);
  const selNodes = map.nodes.filter((n) => selected.has(n.key));
  const selEdge = sel.edge ? (map.edges.find((e) => e.id === sel.edge) ?? null) : null;
  const extra: string[] = [];
  if (temp && boxes.get(temp.from)) extra.push(tempPath(boxes.get(temp.from)!, temp.side, temp.to, temp.target ? (boxes.get(temp.target) ?? null) : null));
  const parent = ghost?.from ? boxes.get(ghost.from) : undefined;
  if (ghost && parent) extra.push(buildPath(geometry(parent, { x: ghost.x, y: ghost.y, ...(sizes.get(GHOST) ?? GUESS), shape: ghost.style.shape }, 'curve'), 'none', 2).d);
  const titleOf = (k: NodeKey) => map.nodes.find((n) => n.key === k)?.title ?? '';
  // The text under the mouse, unless the panel already shows that idea.
  const peekNode = peek && !selected.has(peek.key) && editing !== peek.key ? map.nodes.find((n) => n.key === peek.key) : undefined;
  const peekText = peekNode ? (peekNode.note ? (peekNode.note.body ?? peekNode.note.excerpt) : map.lane.description).trim() : '';

  // Folding: a count where a branch is folded, a button where one can fold.
  const xOf = (k: NodeKey) => boxes.get(k)?.x ?? byKey.get(k)?.x ?? 0;
  const foldOf = (n: MapNode): { count: number; side: 'e' | 'w'; agent: boolean } | null => {
    if (!n.note || !tree) return null;
    const hid = tree.folded.get(n.key);
    if (!hid && (n.note.collapsed || tree.blocker(n.key) !== null)) return null;
    const below = hid ?? tree.below(n.key);
    const side = below.reduce((t, k) => t + xOf(k), 0) / below.length < xOf(n.key) ? 'w' : 'e';
    return { count: hid?.length ?? 0, side, agent: !!hid?.some((k) => byKey.get(k)?.note && agentMarks.get(refOf(k).id)?.fresh) };
  };
  const canFoldAll = !!tree && !!full && full.nodes.some((n) => n.note && !n.note.collapsed && tree.blocker(n.key) === null);
  const one = selNodes.length === 1 ? selNodes[0]! : null;
  const foldInfo = ((): FoldInfo | null => {
    if (!one?.note || !tree) return null;
    const folded = tree.folded.get(one.key)?.length ?? 0;
    if (folded) return { folded, count: folded, blocker: null };
    const b = tree.blocker(one.key);
    if (b === 'leaf') return null;
    return { folded: 0, count: tree.below(one.key).length, blocker: b ? byKey.get(b)?.title || t('note.untitled') : null };
  })();

  return (
    <section ref={root} className="w-map" aria-labelledby={`map-${laneId}`} {...laneStyle(look.color)}>
      <header ref={bar} className="w-map__bar" {...drop.props} data-over={drop.over || undefined}>
        <button type="button" className="w-icon-btn" onClick={onClose} aria-label={t('map.back')} title={t('map.back')}>
          <IconClose />
        </button>
        {look.cover ? (
          <button type="button" className="w-map__cover" onClick={(e) => personalize(undefined, e.currentTarget)} aria-label={t('customize.open', { title: map.lane.title })} title={t('customize.openShort')}>
            <CoverArt look={look.cover} />
          </button>
        ) : (
          files && (
            <span className="w-map__cover w-map__cover--slot" aria-hidden="true">
              <IconImage />
            </span>
          )
        )}
        <div className="w-map__names">
          <div className="w-map__kicker">{t('map.kicker')}</div>
          <h2 id={`map-${laneId}`} className="w-map__title">
            {map.lane.title}
          </h2>
        </div>
        <div className="w-map__actions">
          {map.lane.url && (
            <a className="nr-btn nr-btn--sm nr-btn--fantasma" href={map.lane.url} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={t('site.open', { title: map.lane.title, host: siteHost(map.lane.url) })} title={siteHost(map.lane.url)}>
              <IconGlobe />
              <span className="w-hide-sm">{siteHost(map.lane.url)}</span>
            </a>
          )}
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={newThought} aria-label={t('newNote')}>
            <IconPlus />
            <span className="w-hide-sm">{t('newNote')}</span>
          </button>
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={organize} aria-label={t('map.organize')}>
            <IconOrganize />
            <span className="w-hide-sm">{t('map.organize')}</span>
          </button>
          {tree?.hidden.size ? (
            <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={() => foldAll(false)} aria-label={t('map.unfoldAll')}>
              <IconUnfold />
              <span className="w-hide-sm">{t('map.unfoldAll')}</span>
            </button>
          ) : (
            canFoldAll && (
              <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={() => foldAll(true)} aria-label={t('map.foldAll')}>
                <IconFold />
                <span className="w-hide-sm">{t('map.foldAll')}</span>
              </button>
            )
          )}
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={(e) => personalize(undefined, e.currentTarget)} aria-label={t('customize.open', { title: map.lane.title })}>
            <IconBrush />
            <span className="w-hide-sm">{t('customize.openShort')}</span>
          </button>
        </div>
      </header>

      <div className="w-map__stage">
        <div ref={viewport} className="w-map__view">
          <div
            ref={canvas}
            className={`w-map__canvas nr-tela${panning ? ' is-panning' : ''}${space ? ' is-space' : ''}`}
            tabIndex={0}
            role="application"
            aria-label={t('map.canvas', { title: map.lane.title })}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerOver={onPointerOver}
            onPointerLeave={() => hover(null)}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          >
            <div ref={world} className="w-map__world">
              <MapEdges edges={map.edges} boxes={boxes} colors={colors} selected={sel.edge} extra={extra} marks={agentMarks} />
              {map.nodes.map((n) => {
                const b = boxes.get(n.key)!;
                const fold = foldOf(n);
                return (
                  <MapNodeView
                    key={n.key}
                    node={n}
                    x={b.x}
                    y={b.y}
                    cor={colors.get(n.key)}
                    selected={selected.has(n.key)}
                    target={temp?.target === n.key}
                    editing={editing === n.key}
                    label={t('map.placeholder')}
                    linkLabel={t('note.openLink')}
                    observe={observe}
                    agent={n.note ? agentMarks.get(n.note.id) : undefined}
                    fold={fold?.count ?? -1}
                    foldSide={fold?.side}
                    foldAgent={fold?.agent}
                    foldLabel={fold ? (fold.count ? t('map.foldBadge', { count: fold.count }) : t('map.fold')) : undefined}
                    onEdited={editing === n.key ? (text, then) => finishEdit(n.key, text, then) : undefined}
                  />
                );
              })}
              {ghost && (
                <MapNodeView
                  node={{ key: GHOST, ref: { kind: 'note', id: GHOST }, x: ghost.x, y: ghost.y, ...ghost.style, placed: false, note: null, title: '' }}
                  x={ghost.x}
                  y={ghost.y}
                  cor={ghost.style.color ?? laneColor}
                  selected
                  target={false}
                  editing
                  label={t('map.placeholder')}
                  linkLabel=""
                  observe={observe}
                  onEdited={finishGhost}
                />
              )}
            </div>
            {marquee && <div className="w-map__marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
            {map.nodes.length === 1 && !ghost && (
              <div className="w-map__empty">
                <strong>{t('map.empty')}</strong>
                <span>{t('map.emptyHint')}</span>
              </div>
            )}
          </div>

          {peekNode && peekText && <MapPeek peek={peek!} title={peekNode.title} text={peekText} />}
          <ul className="w-map__hints" aria-hidden="true">
            {(['create', 'connect', 'child', 'fold', 'move', 'zoom'] as const).map((h) => (
              <li key={h}>{t(`map.hints.${h}`)}</li>
            ))}
          </ul>
          <div className="w-map__zoom" role="group" aria-label={t('zoom.map')}>
            <button type="button" className="w-icon-btn" onClick={() => zoomBy(0.8)} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>
              <IconMinus />
            </button>
            <input
              ref={zoomRange}
              type="range"
              className="w-zoom__range w-map__zoom-range"
              min={0}
              max={1}
              step={0.005}
              defaultValue={toLogSlider(1, MAP_ZOOM.min, MAP_ZOOM.max)}
              aria-label={t('zoom.map')}
              onChange={(e) => zoomToSlider(Number(e.target.value))}
            />
            <button type="button" className="w-icon-btn" onClick={() => zoomBy(1.25)} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>
              <IconPlus />
            </button>
            <button type="button" className="w-map__zoom-label" onClick={() => zoomBy(1 / view.current.z)} aria-label={t('map.zoomReset')} title={t('map.zoomReset')}>
              <span ref={zoomLabel} />
            </button>
            <button type="button" className="w-icon-btn" onClick={() => fitTo()} aria-label={t('map.fit')} title={t('map.fit')}>
              <IconFit />
            </button>
            {agentSeen && (
              <button type="button" className="w-icon-btn w-map__follow" aria-pressed={follow} onClick={() => FOLLOW_AGENT.write(follow ? 'off' : 'on')} aria-label={t('map.followAgent')} title={t('map.followAgent')}>
                <IconFollow />
              </button>
            )}
          </div>
        </div>

        {(selNodes.length > 0 || selEdge) && (
          <MapPanel
            panelRef={panel}
            nodes={selNodes}
            edge={selEdge}
            ends={selEdge ? [titleOf(selEdge.from), titleOf(selEdge.to)] : null}
            rootKey={rootKey}
            lane={map.lane}
            laneCor={laneColor}
            labelEditing={!!selEdge && labelEdit === selEdge.id}
            onNodeStyle={(patch) => commitLayout(new Map(sel.nodes.map((k) => [k, patch])))}
            onEdgeStyle={(patch) => selEdge && updateLink(selEdge.id, { style: patch })}
            onEdit={() => selNodes[0] && setEditing(selNodes[0].key)}
            onChild={() => selNodes[0] && addChild(selNodes[0].key)}
            onOpen={() => selNodes[0]?.note && openNote(selNodes[0].note.id)}
            onDelete={deleteSelection}
            fold={foldInfo}
            onFold={() => one && toggleFold([one.key])}
            onLabel={(text) => selEdge && updateLink(selEdge.id, { label: text })}
            onLabelLeft={(byKey) => {
              setLabelEdit(null);
              if (byKey) focusCanvas();
            }}
            onCustomize={(from) => personalize(undefined, from)}
            onClose={closePanel}
          />
        )}
      </div>
    </section>
  );
}

// ───────────────────────────── nodes and edges

const MapNodeView = memo(function MapNodeView({
  node,
  x,
  y,
  cor,
  selected,
  target,
  editing,
  label,
  linkLabel,
  observe,
  agent,
  fold = -1,
  foldSide,
  foldAgent,
  foldLabel,
  onEdited,
}: {
  node: MapNode;
  x: number;
  y: number;
  cor: string | undefined;
  selected: boolean;
  target: boolean;
  editing: boolean;
  label: string;
  linkLabel: string;
  observe: (el: HTMLElement) => () => void;
  agent?: AgentMark;
  /** -1: nothing to fold; 0: it can fold; more: that many ideas folded inside it. */
  fold?: number;
  foldSide?: 'e' | 'w';
  /** An agent just added something inside the fold. */
  foldAgent?: boolean;
  foldLabel?: string;
  onEdited?: (text: string | null, then?: 'child') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => observe(ref.current!), [observe]);
  const url = node.note?.url;
  const paint = corProps(cor);
  return (
    <div
      ref={ref}
      className="w-map__node"
      data-key={node.key}
      data-shape={node.shape}
      data-fill={node.fill}
      data-size={node.size}
      data-cor={paint['data-cor']}
      data-root={node.ref.kind === 'lane' || undefined}
      data-selected={selected || undefined}
      data-target={target || undefined}
      data-done={node.note?.doneAt ? true : undefined}
      data-editing={editing || undefined}
      data-folded={fold > 0 || undefined}
      {...agentProps(agent)}
      style={{ ...paint.style, left: x, top: y }}
    >
      {agent?.fresh && (
        <span className="w-map__agent" aria-hidden="true">
          {agent.label}
        </span>
      )}
      {editing && onEdited ? <TitleEditor initial={node.title} label={label} onDone={onEdited} /> : <span className="w-map__text">{node.title}</span>}
      {url && !editing && (
        <a className="w-map__chip" href={url} target="_blank" rel="noopener noreferrer" data-chip aria-label={linkLabel} title={url}>
          <IconLink />
        </a>
      )}
      {!editing && SIDES.map((s) => <span key={s} className="w-map__handle" data-handle={s} aria-hidden="true" />)}
      {fold >= 0 && !editing && (
        <button type="button" className="w-map__fold" data-fold data-chip data-side={foldSide} data-agent-inside={foldAgent || undefined} tabIndex={-1} aria-label={foldLabel} title={foldLabel}>
          {fold > 0 ? (fold > 99 ? '99+' : fold) : <IconMinus />}
        </button>
      )}
    </div>
  );
});

/** The title typed in place. Enter keeps it, Esc gives up, Tab keeps it and starts a linked thought. */
function TitleEditor({ initial, label, onDone }: { initial: string; label: string; onDone: (text: string | null, then?: 'child') => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const [start] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = start;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [start]);
  const finish = (save: boolean, then?: 'child') => {
    if (done.current) return;
    done.current = true;
    onDone(save ? (ref.current?.textContent ?? '') : null, then);
  };
  return (
    <span
      ref={ref}
      className="w-map__text"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-placeholder={label}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(true, 'child');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

const MapEdges = memo(function MapEdges({ edges, boxes, colors, selected, extra, marks }: { edges: readonly MapEdge[]; boxes: ReadonlyMap<NodeKey, Box>; colors: ReadonlyMap<NodeKey, string | undefined>; selected: string | null; extra: readonly string[]; marks: ReadonlyMap<string, AgentMark> }) {
  return (
    <svg className="w-map__edges" aria-hidden="true">
      {edges.map((e) => {
        const A = boxes.get(e.from);
        const B = boxes.get(e.to);
        if (!A || !B) return null;
        const { d, heads, mid } = buildPath(geometry(A, B, e.style.route), e.style.arrow, e.style.width);
        return (
          <g key={e.id} className="w-map__edge" data-edge={e.id} {...corProps(e.style.color ?? colors.get(e.to))} {...agentProps(marks.get(e.id))} data-selected={selected === e.id || undefined}>
            <path className="w-map__hit" d={d} />
            <path className="w-map__line" d={d} strokeWidth={e.style.width} strokeDasharray={dashArray(e.style.dash, e.style.width)} strokeLinecap={e.style.dash === 'dashed' ? 'butt' : 'round'} />
            {heads.map((h, i) => (
              <path key={i} className="w-map__head" d={h} />
            ))}
            {e.label && (
              <text className="w-map__label" x={mid[0]} y={mid[1]}>
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {extra.map((d, i) => (
        <path key={i} className="w-map__temp" d={d} />
      ))}
    </svg>
  );
});

// ───────────────────────────── the panel beside the map

function Group({ label, radio, children }: { label: string; radio?: boolean; children: ReactNode }) {
  return (
    <div className="w-map__tb-group" role={radio ? 'radiogroup' : 'group'} aria-label={label}>
      <span className="w-map__tb-label" aria-hidden="true">
        {label}
      </span>
      <div className="w-map__tb-items">{children}</div>
    </div>
  );
}

function Btn({ label, on, danger, onClick, children }: { label: string; on?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`w-map__tb-btn${danger ? ' w-map__tb-btn--danger' : ''}`} aria-pressed={on} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** One value for all, or undefined when they differ. */
function common<T, V>(list: readonly T[], f: (x: T) => V): V | undefined {
  const first = list[0];
  if (first === undefined) return undefined;
  const v = f(first);
  return list.every((x) => f(x) === v) ? v : undefined;
}

function ColorGroup({ value, laneCor, onChange }: { value: string | null | undefined; laneCor: string | undefined; onChange: (hex: string | null) => void }) {
  const t = useTranslations('app');
  const name = value ? colorName(value) : undefined;
  return (
    <Group label={t('map.color')} radio>
      <button type="button" role="radio" aria-checked={value === null} className="w-swatch w-swatch--auto" {...corProps(laneCor)} aria-label={t('map.auto')} title={t('map.auto')} onClick={() => onChange(null)}>
        A
      </button>
      {PALETTE.map((c) => (
        <button key={c.name} type="button" role="radio" aria-checked={name === c.name} className="w-swatch" data-cor={c.name} aria-label={t(`colors.${c.name}`)} title={t(`colors.${c.name}`)} onClick={() => onChange(c.hex)} />
      ))}
    </Group>
  );
}

interface PanelProps {
  nodes: readonly MapNode[];
  edge: MapEdge | null;
  /** The titles at the two ends of the selected link. */
  ends: readonly [string, string] | null;
  rootKey: NodeKey;
  lane: LaneDto;
  laneCor: string | undefined;
  labelEditing: boolean;
  onNodeStyle: (patch: Partial<NodeStyle>) => void;
  onEdgeStyle: (patch: Partial<EdgeStyle>) => void;
  onEdit: () => void;
  onChild: () => void;
  onOpen: () => void;
  onDelete: () => void;
  fold: FoldInfo | null;
  onFold: () => void;
  onLabel: (text: string) => void;
  onLabelLeft: (byKey: boolean) => void;
  onCustomize: (from: Element) => void;
  onClose: () => void;
}

/**
 * What is selected on the map, beside it (a sheet over it on a phone): the idea's title, its
 * text and its details, then its look and what can be done with it. A link shows its label
 * and its stroke. A click on empty canvas, Esc or the close button puts it away.
 */
function MapPanel({ panelRef, ...props }: PanelProps & { panelRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const openByTitle = useOpenByTitle();
  const { nodes, edge } = props;
  const one = nodes.length === 1 ? nodes[0]! : null;
  const note = one?.note ?? null;
  const isRoot = one?.key === props.rootKey;
  const kicker = edge ? t('map.link') : isRoot ? t('map.centre') : one ? t('map.thought') : t('map.selected', { count: nodes.length });
  return (
    <aside ref={panelRef} className="w-map__panel" aria-label={t('map.panel')}>
      <header className="w-map__panel-head">
        <h3 className="w-map__panel-kicker">{kicker}</h3>
        <button type="button" className="w-icon-btn" onClick={props.onClose} aria-label={t('map.closePanel')} title={t('map.closePanel')}>
          <IconClose />
        </button>
      </header>

      {edge ? (
        <>
          {props.ends && (
            <p className="w-map__panel-ends">
              <span>{props.ends[0] || t('note.untitled')}</span>
              <span aria-hidden="true">{edge.style.arrow === 'start' ? '←' : edge.style.arrow === 'both' ? '↔' : '→'}</span>
              <span>{props.ends[1] || t('note.untitled')}</span>
            </p>
          )}
          <LabelField key={edge.id} value={edge.label} label={t('map.label')} focus={props.labelEditing} onSave={props.onLabel} onLeft={props.onLabelLeft} />
        </>
      ) : isRoot ? (
        <>
          <NameField id="w-map-panel-title" value={props.lane.title} label={t('customize.name')} maxLength={LIMITS.laneTitle} onSave={(title) => actions.updateLane(props.lane.id, { title })} />
          <DescriptionField id="w-map-panel-description" lane={props.lane} />
          <div className="w-map__panel-row">
            {props.lane.url && (
              <a className="nr-btn nr-btn--sm nr-btn--fantasma" href={props.lane.url} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={t('site.open', { title: props.lane.title, host: siteHost(props.lane.url) })}>
                <IconGlobe />
                {siteHost(props.lane.url)}
              </a>
            )}
            <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={(e) => props.onCustomize(e.currentTarget)}>
              <IconBrush />
              {t('customize.openShort')}
            </button>
          </div>
        </>
      ) : note ? (
        <>
          <NoteTitle note={note} onEscape={() => {}} />
          <BodyEditor key={note.id} note={note} onWikilink={openByTitle} />
          <section className="w-map__panel-section" aria-labelledby="w-map-panel-details">
            <h4 id="w-map-panel-details" className="w-map__panel-label">
              {t('map.details')}
            </h4>
            <dl className="w-fields">
              <TagsField note={note} />
              <DueField note={note} />
              <LinkField note={note} />
            </dl>
          </section>
        </>
      ) : (
        <ul className="w-map__panel-list">
          {nodes.slice(0, 12).map((n) => (
            <li key={n.key}>{n.title || t('note.untitled')}</li>
          ))}
          {nodes.length > 12 && <li aria-hidden="true">…</li>}
        </ul>
      )}

      {props.fold && (
        <div className="w-map__panel-fold">
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" disabled={!!props.fold.blocker} onClick={props.onFold}>
            {props.fold.folded ? <IconUnfold /> : <IconFold />}
            {props.fold.folded ? t('map.unfold') : t('map.fold')}
            <span className="w-map__fold-count">{props.fold.count}</span>
          </button>
          {props.fold.blocker && <p className="w-map__panel-hint">{t('notices.foldBlocked', { title: props.fold.blocker })}</p>}
        </div>
      )}

      <section className="w-map__panel-section" aria-labelledby="w-map-panel-look">
        <h4 id="w-map-panel-look" className="w-map__panel-label">
          {t('map.look')}
        </h4>
        <StyleTools {...props} />
      </section>
    </aside>
  );
}

function StyleTools(props: PanelProps) {
  const t = useTranslations('app');
  const { nodes, edge } = props;
  if (edge) {
    const s = edge.style;
    return (
      <div className="w-map__toolbar" role="toolbar" aria-label={t('map.toolbar')}>
        <ColorGroup value={s.color} laneCor={props.laneCor} onChange={(color) => props.onEdgeStyle({ color })} />
        <Group label={t('map.width')}>
          {WIDTHS.map((w) => (
            <Btn key={w} label={t('map.widthValue', { width: w })} on={s.width === w} onClick={() => props.onEdgeStyle({ width: w })}>
              <WidthIcon w={w} />
            </Btn>
          ))}
        </Group>
        <Group label={t('map.dash')}>
          {DASHES.map((d) => {
            const I = DASH_ICONS[d];
            return (
              <Btn key={d} label={t(`map.dashes.${d}`)} on={s.dash === d} onClick={() => props.onEdgeStyle({ dash: d })}>
                <I />
              </Btn>
            );
          })}
        </Group>
        <Group label={t('map.route')}>
          {ROUTES.map((r) => {
            const I = ROUTE_ICONS[r];
            return (
              <Btn key={r} label={t(`map.routes.${r}`)} on={s.route === r} onClick={() => props.onEdgeStyle({ route: r })}>
                <I />
              </Btn>
            );
          })}
        </Group>
        <Group label={t('map.arrow')}>
          {ARROWS.map((a) => {
            const I = ARROW_ICONS[a];
            return (
              <Btn key={a} label={t(`map.arrows.${a}`)} on={s.arrow === a} onClick={() => props.onEdgeStyle({ arrow: a })}>
                <I />
              </Btn>
            );
          })}
        </Group>
        <Group label={t('map.link')}>
          {(s.arrow === 'end' || s.arrow === 'start') && (
            <Btn label={t('map.reverse')} onClick={() => props.onEdgeStyle({ arrow: s.arrow === 'end' ? 'start' : 'end' })}>
              <IconSwap />
            </Btn>
          )}
          <Btn label={t('map.deleteLink')} danger onClick={props.onDelete}>
            <IconTrash />
          </Btn>
        </Group>
      </div>
    );
  }
  const one = nodes.length === 1 ? nodes[0]! : null;
  const notes = nodes.filter((n) => n.key !== props.rootKey);
  const fill = common(nodes, (n) => n.fill);
  const shape = common(nodes, (n) => n.shape);
  const size = common(nodes, (n) => n.size);
  return (
    <div className="w-map__toolbar" role="toolbar" aria-label={t('map.toolbar')}>
      <ColorGroup value={common(nodes, (n) => n.color)} laneCor={props.laneCor} onChange={(color) => props.onNodeStyle({ color })} />
      <Group label={t('map.fill')}>
        {FILLS.map((f) => {
          const I = FILL_ICONS[f];
          return (
            <Btn key={f} label={t(`map.fills.${f}`)} on={fill === f} onClick={() => props.onNodeStyle({ fill: f })}>
              <I />
            </Btn>
          );
        })}
      </Group>
      <Group label={t('map.shape')}>
        {SHAPES.map((sh) => {
          const I = SHAPE_ICONS[sh];
          return (
            <Btn key={sh} label={t(`map.shapes.${sh}`)} on={shape === sh} onClick={() => props.onNodeStyle({ shape: sh })}>
              <I />
            </Btn>
          );
        })}
      </Group>
      <Group label={t('map.size')}>
        {SIZES.map((z) => (
          <Btn key={z} label={t(`map.sizes.${z}`)} on={size === z} onClick={() => props.onNodeStyle({ size: z })}>
            <span className="w-map__tb-txt">{z.toUpperCase()}</span>
          </Btn>
        ))}
      </Group>
      <Group label={t('map.thought')}>
        {one && (
          <Btn label={t('map.edit')} onClick={props.onEdit}>
            <IconEdit />
          </Btn>
        )}
        {one && (
          <Btn label={t('map.child')} onClick={props.onChild}>
            <IconPlus />
          </Btn>
        )}
        {one?.note && (
          <Btn label={t('map.openNote')} onClick={props.onOpen}>
            <IconNote />
          </Btn>
        )}
        {notes.length > 0 && (
          <Btn label={t('map.delete')} danger onClick={props.onDelete}>
            <IconTrash />
          </Btn>
        )}
      </Group>
    </div>
  );
}

/** A link's label, always at hand: leaving or Enter saves, Esc gives up. Double-click on a link lands here. */
function LabelField({ value, label, focus, onSave, onLeft }: { value: string; label: string; focus: boolean; onSave: (text: string) => void; onLeft: (byKey: boolean) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const byKey = useRef(false);
  const skip = useRef(false);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <input
      ref={ref}
      className="w-input w-map__panel-input"
      aria-label={label}
      placeholder={label}
      value={draft ?? value}
      maxLength={LIMITS.linkLabel}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const text = draft?.trim();
        if (!skip.current && text !== undefined && text !== value) onSave(text);
        skip.current = false;
        setDraft(null);
        onLeft(byKey.current);
        byKey.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposing(e)) {
          e.preventDefault();
          byKey.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          skip.current = true;
          byKey.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The text of an idea under the mouse, for a moment, without selecting it. */
function MapPeek({ peek, title, text }: { peek: Peek; title: string; text: string }) {
  return (
    <div className="w-map__peek" data-above={peek.above || undefined} style={{ left: peek.x, top: peek.y }} aria-hidden="true">
      {title && <strong className="w-map__peek-title">{title}</strong>}
      <div className="w-map__peek-text">
        <Markdown text={text} onWikilink={() => {}} />
      </div>
    </div>
  );
}
