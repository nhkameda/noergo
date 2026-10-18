import { newId } from '@noergo/core/ids';
import { LIMITS } from '@noergo/core/limits';
import type { NodeRef, Op } from '@noergo/core/ops/schema';
import { between, nBetween } from '@noergo/core/position';
import { nearestColor } from './model';

/**
 * Import of a backup exported by the prototype ("Ideário", app: 'ideario'). Every column
 * becomes a column of one new board, every card a note, and each column's mind map keeps
 * its node positions, styles and connections. Attached files are not carried over yet
 * (attachments arrive in phase F6): such a card becomes a note naming the file.
 *
 * The file is untrusted input. Everything is re-validated here, the same way the
 * prototype's normalize() did, and again by the server's schema.
 */
export interface IdearioLabels {
  boardTitle: string;
  attachment: (fileName: string) => string;
  untitledColumn: string;
}

export interface IdearioPlan {
  ops: Op[];
  columns: number;
  notes: number;
  links: number;
  skippedFiles: number;
}

const SHAPES = new Set(['pill', 'rounded', 'rect', 'ellipse', 'diamond', 'plain'] as const);
const FILLS = new Set(['solid', 'soft', 'outline'] as const);
const SIZES = new Set(['s', 'm', 'l'] as const);
const DASHES = new Set(['solid', 'dashed', 'dotted'] as const);
const ROUTES = new Set(['curve', 'straight', 'elbow'] as const);
const ARROWS = new Set(['none', 'end', 'start', 'both'] as const);
const WIDTHS = new Set([1, 2, 3, 5] as const);

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0);
function pick<T>(set: ReadonlySet<T>, v: unknown): T | undefined {
  return set.has(v as T) ? (v as T) : undefined;
}

function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMITS.url) return null;
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(v).protocol) ? v : null;
  } catch {
    return null;
  }
}

/** The first line is the title; whatever does not fit stays in the body. */
export function splitText(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const nl = trimmed.indexOf('\n');
  const first = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
  if (first.length <= LIMITS.noteTitle) return { title: first, body: nl === -1 ? '' : trimmed.slice(nl + 1).trim() };
  return { title: `${first.slice(0, LIMITS.noteTitle - 1)}…`, body: trimmed };
}

export function isIdeario(data: unknown): boolean {
  const d = obj(data);
  return d.app === 'ideario' && typeof d.state === 'object' && d.state !== null;
}

/** The operations that recreate the backup as a new board placed after `afterBoard`. */
export function planIdeario(data: unknown, labels: IdearioLabels, afterBoard: string | null): IdearioPlan {
  const columns = arr(obj(obj(data).state).columns).slice(0, 500);
  const boardId = newId();
  const ops: Op[] = [{ type: 'board.create', id: boardId, title: labels.boardTitle.slice(0, LIMITS.boardTitle), place: { position: between(afterBoard, null) } }];
  const lanePositions = columns.length ? nBetween(null, null, columns.length) : [];
  let notes = 0;
  let links = 0;
  let skippedFiles = 0;
  const later: Op[] = [];

  columns.forEach((rawCol, i) => {
    const col = obj(rawCol);
    const laneId = newId();
    const title = str(col.title, LIMITS.laneTitle).trim() || labels.untitledColumn;
    ops.push({ type: 'lane.create', id: laneId, boardId, title, color: nearestColor(str(col.color, 7)), place: { position: lanePositions[i]! } });

    const ids = new Map<string, string>();
    const cards = arr(col.cards).slice(0, LIMITS.notesPerWorkspace);
    const notePositions = cards.length ? nBetween(null, null, cards.length) : [];
    cards.forEach((rawCard, j) => {
      const card = obj(rawCard);
      const oldId = typeof card.id === 'string' ? card.id : '';
      if (!oldId || ids.has(oldId)) return;
      const id = newId();
      ids.set(oldId, id);
      const kind = card.kind;
      let { title, body } = splitText(str(card.text, 20_000));
      let url: string | null = null;
      if (kind === 'link') url = safeUrl(card.url);
      if (kind === 'image' || kind === 'file') {
        const name = str(card.fileName, 300) || '?';
        skippedFiles++;
        if (!title) title = name.slice(0, LIMITS.noteTitle);
        body = [body, labels.attachment(name)].filter(Boolean).join('\n\n');
      }
      if (!title && url) title = url.slice(0, LIMITS.noteTitle);
      ops.push({ type: 'note.create', id, laneId, title, body: body.slice(0, LIMITS.noteBody), url, place: { position: notePositions[j]! } });
      notes++;
    });

    // The mind map of the column: 'root' is the column itself.
    const map = obj(col.map);
    const ref = (old: unknown): NodeRef | null => (old === 'root' ? { kind: 'lane', id: laneId } : typeof old === 'string' && ids.has(old) ? { kind: 'note', id: ids.get(old)! } : null);
    const nodes: Extract<Op, { type: 'layout.set' }>['nodes'] = [];
    const style = (st: Raw) => ({
      x: coord(st.x),
      y: coord(st.y),
      shape: pick(SHAPES, st.shape),
      fill: pick(FILLS, st.fill),
      size: pick(SIZES, st.size),
      color: nearestColor(str(st.color, 7)),
    });
    if (Object.keys(obj(map.root)).length) nodes.push({ kind: 'lane', id: laneId, ...style(obj(map.root)) });
    for (const [old, st] of Object.entries(obj(map.nodes))) {
      const r = ref(old);
      if (r?.kind === 'note') nodes.push({ kind: 'note', id: r.id, ...style(obj(st)) });
    }
    for (let k = 0; k < nodes.length; k += 500) later.push({ type: 'layout.set', viewKind: 'lane_map', viewId: laneId, nodes: nodes.slice(k, k + 500) });

    for (const rawEdge of arr(map.edges)) {
      const e = obj(rawEdge);
      const from = ref(e.from);
      const to = ref(e.to);
      if (!from || !to || (from.kind === to.kind && from.id === to.id)) continue;
      const label = str(e.label, LIMITS.linkLabel).trim();
      later.push({
        type: 'link.create',
        id: newId(),
        from,
        to,
        ...(label ? { label } : {}),
        style: {
          color: nearestColor(str(e.color, 7)),
          width: pick(WIDTHS, e.width) ?? 2,
          dash: pick(DASHES, e.dash) ?? 'solid',
          route: pick(ROUTES, e.route) ?? 'curve',
          arrow: pick(ARROWS, e.arrow) ?? 'none',
        },
      });
      links++;
    }
  });

  return { ops: [...ops, ...later], columns: columns.length, notes, links, skippedFiles };
}
