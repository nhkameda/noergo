import { excerptOf, type BoardDto, type Effect, type LaneDto, type LayoutDto, type LinkDto, type NoteDto } from '@noergo/core/dto';
import { COLORS } from '@noergo/core/limits';
import type { Op } from '@noergo/core/ops/schema';
import { comparePositioned } from '@noergo/core/position';
import type { Snapshot } from '@noergo/core/read';

/**
 * The workspace as the browser holds it, and the pure functions that change it. Nothing
 * here talks to the network: the store (store.ts) feeds it the snapshot, the effects that
 * the server confirmed and the operations still on their way.
 *
 * Deleted items stay in the maps with deletedAt set until the next snapshot, so that a
 * late, older effect can never bring them back: an effect only lands when its version is
 * at least the one held (the version rule). Selectors hide them.
 */
export interface Data {
  seq: number;
  inboxLaneId: string | null;
  boards: ReadonlyMap<string, BoardDto>;
  lanes: ReadonlyMap<string, LaneDto>;
  notes: ReadonlyMap<string, NoteDto>;
  links: ReadonlyMap<string, LinkDto>;
  layouts: ReadonlyMap<string, LayoutDto>;
}

interface Rows {
  boards: BoardDto;
  lanes: LaneDto;
  notes: NoteDto;
  links: LinkDto;
  layouts: LayoutDto;
}
type Table = keyof Rows;

export const layoutKey = (l: Pick<LayoutDto, 'viewKind' | 'viewId' | 'nodeKind' | 'nodeId'>) => `${l.viewKind}:${l.viewId}:${l.nodeKind}:${l.nodeId}`;

export function fromSnapshot(s: Snapshot): Data {
  return {
    seq: s.seq,
    inboxLaneId: s.inboxLaneId,
    boards: new Map(s.boards.map((b) => [b.id, b])),
    // A cache written before covers existed has lanes without the field.
    lanes: new Map(s.lanes.map((l) => [l.id, { ...l, cover: l.cover ?? null }])),
    notes: new Map(s.notes.map((n) => [n.id, n])),
    links: new Map(s.links.map((l) => [l.id, l])),
    layouts: new Map(s.layouts.map((l) => [layoutKey(l), l])),
  };
}

/** The serialisable form, for the IndexedDB cache. */
export function toSnapshot(d: Data): Snapshot {
  return {
    seq: d.seq,
    inboxLaneId: d.inboxLaneId,
    boards: [...d.boards.values()].filter(alive),
    lanes: [...d.lanes.values()].filter(alive),
    notes: [...d.notes.values()].filter(alive),
    links: [...d.links.values()].filter(alive),
    layouts: [...d.layouts.values()],
  };
}

/**
 * Copy-on-write over Data: each map is copied at most once, however many changes land,
 * and untouched maps keep their identity (React memos and selectors depend on that).
 */
class Draft {
  private out: { -readonly [K in keyof Data]: Data[K] };
  private copied = new Set<Table>();

  constructor(base: Data) {
    this.out = { ...base };
  }

  get<T extends Table>(t: T): ReadonlyMap<string, Rows[T]> {
    return this.out[t] as ReadonlyMap<string, Rows[T]>;
  }

  write<T extends Table>(t: T): Map<string, Rows[T]> {
    if (!this.copied.has(t)) {
      (this.out as Record<Table, unknown>)[t] = new Map(this.get(t));
      this.copied.add(t);
    }
    return this.out[t] as Map<string, Rows[T]>;
  }

  set seq(v: number) {
    this.out.seq = v;
  }

  done(): Data {
    return this.out;
  }
}

const alive = (x: { deletedAt: string | null }) => x.deletedAt === null;

function landNote(cur: NoteDto | undefined, inc: NoteDto): NoteDto | null {
  if (cur && inc.version < cur.version) return null;
  if (cur && inc.version === cur.version && (inc.body === undefined || cur.body !== undefined)) return null;
  // Moves and deletes travel without the long body; it did not change, keep the one held.
  if (inc.body === undefined && cur?.body !== undefined && cur.bodyLength === inc.bodyLength) return { ...inc, body: cur.body };
  return inc;
}

function landVersioned<T extends { version: number }>(cur: T | undefined, inc: T): T | null {
  return cur && inc.version <= cur.version ? null : inc;
}

function applyEffect(d: Draft, e: Effect): void {
  switch (e.kind) {
    case 'board': {
      const next = landVersioned(d.get('boards').get(e.data.id), e.data);
      if (next) d.write('boards').set(next.id, next);
      return;
    }
    case 'lane': {
      const next = landVersioned(d.get('lanes').get(e.data.id), e.data);
      if (next) d.write('lanes').set(next.id, next);
      return;
    }
    case 'note': {
      const next = landNote(d.get('notes').get(e.data.id), e.data);
      if (next) d.write('notes').set(next.id, next);
      return;
    }
    case 'link': {
      const next = landVersioned(d.get('links').get(e.data.id), e.data);
      if (next) d.write('links').set(next.id, next);
      return;
    }
    case 'layout': {
      const key = layoutKey(e.data);
      const next = landVersioned(d.get('layouts').get(key), e.data);
      if (next) d.write('layouts').set(key, next);
      return;
    }
    case 'layout.removed': {
      const key = layoutKey(e.data);
      if (d.get('layouts').has(key)) d.write('layouts').delete(key);
      return;
    }
  }
}

/** Lands confirmed effects (from an op result or the live stream). */
export function applyEffects(data: Data, effects: readonly Effect[], seq?: number): Data {
  const d = new Draft(data);
  for (const e of effects) applyEffect(d, e);
  if (seq !== undefined && seq > data.seq) d.seq = seq;
  return d.done();
}

/** A note fetched whole (GET /api/notes/:id) fills in a body that travelled as an excerpt. */
export function withFullNote(data: Data, note: NoteDto): Data {
  return applyEffects(data, [{ kind: 'note', data: note }]);
}

// ───────────────────────────── optimistic layer

/** An operation not yet confirmed. `local` carries what the client already knows the outcome to be. */
export interface Pending {
  opId: string;
  op: Op;
  local?: { body?: string };
  /** The caller handles a conflict itself (the body editor merges); no notice. */
  quiet?: boolean;
}

const now = () => new Date().toISOString();

/**
 * What the browser shows while an op travels. The client always sends explicit positions,
 * so the guess matches the server; versions stay as they were, so the confirmed effect
 * (one version higher) replaces the guess without a flicker.
 */
function applyOptimistic(d: Draft, p: Pending): void {
  const { op } = p;
  const t = now();
  switch (op.type) {
    case 'board.create': {
      if (d.get('boards').has(op.id)) return;
      const position = op.place && 'position' in op.place ? op.place.position : 'a0';
      d.write('boards').set(op.id, { id: op.id, title: op.title, color: op.color ?? null, position, version: 0, updatedAt: t, deletedAt: null });
      return;
    }
    case 'lane.create': {
      if (d.get('lanes').has(op.id)) return;
      const position = op.place && 'position' in op.place ? op.place.position : 'a0';
      d.write('lanes').set(op.id, { id: op.id, boardId: op.boardId, title: op.title, color: op.color ?? null, cover: null, position, version: 0, updatedAt: t, deletedAt: null });
      return;
    }
    case 'note.create': {
      if (d.get('notes').has(op.id)) return;
      const body = op.body ?? '';
      const position = op.place && 'position' in op.place ? op.place.position : 'a0';
      d.write('notes').set(op.id, {
        id: op.id,
        laneId: op.laneId,
        position,
        kind: op.url ? 'link' : (op.kind ?? 'text'),
        title: op.title,
        body,
        excerpt: excerptOf(body),
        bodyLength: body.length,
        url: op.url ?? null,
        attachmentId: null,
        color: op.color ?? null,
        tags: [...new Set(op.tags ?? [])],
        doneAt: null,
        dueAt: op.dueAt ?? null,
        version: 0,
        createdBy: null,
        updatedBy: null,
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      });
      return;
    }
    case 'board.update': {
      const cur = d.get('boards').get(op.id);
      if (cur) d.write('boards').set(op.id, { ...cur, ...(op.title !== undefined ? { title: op.title } : {}), ...(op.color !== undefined ? { color: op.color } : {}) });
      return;
    }
    case 'lane.update': {
      const cur = d.get('lanes').get(op.id);
      if (cur) d.write('lanes').set(op.id, { ...cur, ...(op.title !== undefined ? { title: op.title } : {}), ...(op.color !== undefined ? { color: op.color } : {}), ...(op.cover !== undefined ? { cover: op.cover } : {}) });
      return;
    }
    case 'note.update': {
      const cur = d.get('notes').get(op.id);
      if (!cur) return;
      const next: NoteDto = { ...cur, updatedAt: t };
      if (op.title !== undefined) next.title = op.title;
      const body = op.body ?? p.local?.body ?? (op.appendText !== undefined && cur.body !== undefined ? cur.body + (cur.body && !cur.body.endsWith('\n') ? '\n' : '') + op.appendText : undefined);
      if (body !== undefined) Object.assign(next, { body, excerpt: excerptOf(body), bodyLength: body.length });
      if (op.url !== undefined) {
        next.url = op.url;
        if (cur.kind === 'text' || cur.kind === 'link') next.kind = op.url ? 'link' : 'text';
      }
      if (op.color !== undefined) next.color = op.color;
      if (op.tagsAdd || op.tagsRemove) {
        const set = new Set(cur.tags);
        for (const tag of op.tagsAdd ?? []) set.add(tag);
        for (const tag of op.tagsRemove ?? []) set.delete(tag);
        next.tags = [...set];
      }
      if (op.done !== undefined && op.done !== (cur.doneAt !== null)) next.doneAt = op.done ? t : null;
      if (op.dueAt !== undefined) next.dueAt = op.dueAt;
      d.write('notes').set(op.id, next);
      return;
    }
    case 'board.move': {
      const cur = d.get('boards').get(op.id);
      if (cur && 'position' in op.place) d.write('boards').set(op.id, { ...cur, position: op.place.position });
      return;
    }
    case 'lane.move': {
      const cur = d.get('lanes').get(op.id);
      if (cur && 'position' in op.place) d.write('lanes').set(op.id, { ...cur, boardId: op.boardId ?? cur.boardId, position: op.place.position });
      return;
    }
    case 'note.move': {
      const cur = d.get('notes').get(op.id);
      if (cur && 'position' in op.place) d.write('notes').set(op.id, { ...cur, laneId: op.laneId, position: op.place.position });
      return;
    }
    case 'board.delete':
    case 'board.restore': {
      const cur = d.get('boards').get(op.id);
      if (cur) d.write('boards').set(op.id, { ...cur, deletedAt: op.type === 'board.delete' ? t : null });
      return;
    }
    case 'lane.delete':
    case 'lane.restore': {
      const cur = d.get('lanes').get(op.id);
      if (cur) d.write('lanes').set(op.id, { ...cur, deletedAt: op.type === 'lane.delete' ? t : null });
      return;
    }
    case 'note.delete':
    case 'note.restore': {
      const cur = d.get('notes').get(op.id);
      if (cur) d.write('notes').set(op.id, { ...cur, deletedAt: op.type === 'note.delete' ? t : null });
      return;
    }
    case 'link.create': {
      if (d.get('links').has(op.id)) return;
      d.write('links').set(op.id, { id: op.id, from: op.from, to: op.to, origin: 'manual', label: op.label ?? '', style: op.style ?? {}, version: 0, updatedBy: null, deletedAt: null });
      return;
    }
    case 'link.update': {
      const cur = d.get('links').get(op.id);
      if (cur) d.write('links').set(op.id, { ...cur, label: op.label ?? cur.label, style: op.style ? { ...cur.style, ...op.style } : cur.style });
      return;
    }
    case 'link.delete':
    case 'link.restore': {
      const cur = d.get('links').get(op.id);
      if (cur) d.write('links').set(op.id, { ...cur, deletedAt: op.type === 'link.delete' ? t : null });
      return;
    }
    case 'layout.set': {
      const map = d.write('layouts');
      for (const n of op.nodes) {
        const ref = { viewKind: op.viewKind, viewId: op.viewId, nodeKind: n.kind, nodeId: n.id };
        const key = layoutKey(ref);
        const cur = map.get(key);
        map.set(key, {
          ...ref,
          x: n.x,
          y: n.y,
          shape: n.shape ?? cur?.shape ?? 'pill',
          fill: n.fill ?? cur?.fill ?? 'soft',
          size: n.size ?? cur?.size ?? 'm',
          color: n.color !== undefined ? n.color : (cur?.color ?? null),
          version: cur?.version ?? 0,
        });
      }
      return;
    }
    case 'layout.remove': {
      const map = d.write('layouts');
      for (const n of op.nodes) map.delete(layoutKey({ viewKind: op.viewKind, viewId: op.viewId, nodeKind: n.kind, nodeId: n.id }));
      return;
    }
  }
}

/** Confirmed state with the operations still in flight laid over it. */
export function withPending(data: Data, pending: readonly Pending[]): Data {
  if (!pending.length) return data;
  const d = new Draft(data);
  for (const p of pending) applyOptimistic(d, p);
  return d.done();
}

// ───────────────────────────── selectors

// They take the maps they read, so that React memos can depend on exactly those.

export function boardsOf(boards: Data['boards']): BoardDto[] {
  return [...boards.values()].filter(alive).sort(comparePositioned);
}

export function lanesOf(lanes: Data['lanes'], boardId: string): LaneDto[] {
  return [...lanes.values()].filter((l) => l.boardId === boardId && alive(l)).sort(comparePositioned);
}

/** The visible notes of each given lane, in order. */
export function notesByLane(notes: Data['notes'], laneIds: readonly string[]): Map<string, NoteDto[]> {
  const out = new Map<string, NoteDto[]>(laneIds.map((id) => [id, []]));
  for (const n of notes.values()) {
    if (n.deletedAt !== null) continue;
    out.get(n.laneId)?.push(n);
  }
  for (const list of out.values()) list.sort(comparePositioned);
  return out;
}

/** A note is shown when it, its column and its board are all out of the trash. */
export function locate(data: Data, noteId: string): { note: NoteDto; lane: LaneDto; board: BoardDto } | null {
  const note = data.notes.get(noteId);
  const lane = note && data.lanes.get(note.laneId);
  const board = lane && data.boards.get(lane.boardId);
  if (!note || !lane || !board || !alive(note) || !alive(lane) || !alive(board)) return null;
  return { note, lane, board };
}

/** Where the capture bar writes: the inbox column while it exists, else the first column. */
export function captureLane(data: Data, currentBoardId: string | null): LaneDto | null {
  const inbox = data.inboxLaneId ? data.lanes.get(data.inboxLaneId) : undefined;
  if (inbox && alive(inbox) && data.boards.get(inbox.boardId)?.deletedAt === null) return inbox;
  if (currentBoardId) {
    const first = lanesOf(data.lanes, currentBoardId)[0];
    if (first) return first;
  }
  for (const b of boardsOf(data.boards)) {
    const first = lanesOf(data.lanes, b.id)[0];
    if (first) return first;
  }
  return null;
}

export interface DueItem {
  note: NoteDto;
  lane: LaneDto;
  board: BoardDto;
  group: 'overdue' | 'today' | 'upcoming';
}

/** Open notes with a due date, across every board, soonest first. */
export function dueNotes(data: Data, at: Date = new Date()): DueItem[] {
  const startOfDay = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const endOfDay = startOfDay + 86_400_000;
  const out: DueItem[] = [];
  for (const n of data.notes.values()) {
    if (!n.dueAt || n.doneAt) continue;
    const where = locate(data, n.id);
    if (!where) continue;
    const due = new Date(n.dueAt).getTime();
    out.push({ ...where, group: due < startOfDay ? 'overdue' : due < endOfDay ? 'today' : 'upcoming' });
  }
  return out.sort((a, b) => a.note.dueAt!.localeCompare(b.note.dueAt!) || comparePositioned(a.note, b.note));
}

/** Accent- and case-insensitive match over what the browser holds (works offline, and in Chinese). */
export function localSearch(data: Data, query: string, limit = 20): NoteDto[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: Array<{ n: NoteDto; s: number }> = [];
  for (const n of data.notes.values()) {
    if (!locate(data, n.id)) continue;
    const title = fold(n.title);
    const s = title.startsWith(q) ? 3 : title.includes(q) ? 2 : n.tags.some((t) => t.includes(q)) ? 1.5 : fold(n.body ?? n.excerpt).includes(q) ? 1 : 0;
    if (s) scored.push({ n, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || b.n.updatedAt.localeCompare(a.n.updatedAt))
    .slice(0, limit)
    .map((x) => x.n);
}

export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ───────────────────────────── colours

/** Content colours by name (data-cor in the design system). Uva is reserved for agents. */
export const PALETTE = [
  { name: 'faisca', hex: COLORS[0] },
  { name: 'tangerina', hex: COLORS[1] },
  { name: 'urucum', hex: COLORS[2] },
  { name: 'goiaba', hex: COLORS[3] },
  { name: 'anil', hex: COLORS[4] },
  { name: 'lagoa', hex: COLORS[5] },
  { name: 'broto', hex: COLORS[6] },
] as const;

export type ColorName = (typeof PALETTE)[number]['name'];

/** The data-cor of a stored colour; colours outside the palette render as none. */
export function colorName(hex: string | null): ColorName | undefined {
  return PALETTE.find((c) => c.hex === hex)?.name;
}

/** The palette colour closest to any hex, for imports from tools with other colours. */
export function nearestColor(hex: string | null | undefined): string | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const [r, g, b] = rgb(hex.toLowerCase());
  let best: string = PALETTE[0].hex;
  let bestD = Infinity;
  for (const c of PALETTE) {
    const [cr, cg, cb] = rgb(c.hex);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestD) [best, bestD] = [c.hex, dist];
  }
  return best;
}
