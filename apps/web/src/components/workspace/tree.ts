import type { LinkDto, NoteDto } from '@noergo/core/dto';
import { comparePositioned } from '@noergo/core/position';
import { laneTree, thoughtTree, type LaneTree } from '@noergo/core/tree';
import type { LaneMap, NodeKey } from './map';
import { notesByLane, type Data } from './model';

export { laneTree, type LaneTree };

/** The tree of a lane's map: the notes in column order, the map's links. */
export function mapTree(map: LaneMap, rootKey: NodeKey): LaneTree {
  const notes = map.nodes.filter((n) => n.note).sort((a, b) => comparePositioned(a.note!, b.note!));
  return laneTree(
    rootKey,
    notes.map((n) => ({ key: n.key, collapsed: n.note!.collapsed })),
    map.edges,
  );
}

export const noteKey = (id: string) => `note:${id}`;
/** The note id of a key, null for the centre. */
export const noteOf = (key: string | undefined): string | null => (key?.startsWith('note:') ? key.slice(5) : null);

/** The live links that reach a note, grouped by the column of that note. */
export function linksByLane(data: Pick<Data, 'notes' | 'links'>): Map<string, LinkDto[]> {
  const out = new Map<string, LinkDto[]>();
  for (const l of data.links.values()) {
    if (l.deletedAt !== null || l.to.kind !== 'note') continue;
    const laneId = data.notes.get(l.to.id)?.laneId;
    if (laneId) out.set(laneId, [...(out.get(laneId) ?? []), l]);
  }
  return out;
}

/** The tree of each column, from its notes in column order. */
export function columnTrees(data: Pick<Data, 'notes' | 'links'>, byLane: ReadonlyMap<string, readonly NoteDto[]>): Map<string, LaneTree> {
  const links = linksByLane(data);
  return new Map([...byLane].map(([id, notes]) => [id, thoughtTree(id, notes, links.get(id) ?? [])]));
}

/** The tree of a column, read now: what the actions decide moves on. */
export function columnTree(data: Pick<Data, 'notes' | 'links'>, laneId: string): LaneTree {
  return columnTrees(data, notesByLane(data.notes, [laneId])).get(laneId)!;
}

/** The ideas hanging from `parent` (null: the top of the column), in column order. */
export function siblings(notes: readonly NoteDto[], tree: LaneTree, parent: string | null): NoteDto[] {
  return notes.filter((n) => noteOf(tree.parent.get(noteKey(n.id))) === parent);
}

/** What hangs from `id` in the column, at every level: what goes along when it moves. */
export function descendants(tree: LaneTree, id: string): string[] {
  const key = noteKey(id);
  const at = tree.order.indexOf(key);
  const depth = tree.depth.get(key) ?? 0;
  const out: string[] = [];
  for (let i = at + 1; at >= 0 && i < tree.order.length && tree.depth.get(tree.order[i]!)! > depth; i++) out.push(tree.order[i]!.slice(5));
  return out;
}

export interface ColumnRow {
  note: NoteDto;
  depth: number;
  /** How many ideas a fold of this one hides now. */
  folded: number;
  /** When nothing is folded in it: none hangs from it, it can fold, or one below has two parents. */
  branch: 'leaf' | 'fold' | 'blocked';
  /** The title of the idea that keeps it from folding. */
  blocker: string | null;
  /** Ideas of its own follow it on show. */
  open: boolean;
}

/**
 * The cards of a column, top to bottom: each idea with what hangs from it right under it,
 * less what a fold hides. With done notes hidden, a done idea still shows while an open one
 * hangs from it, so nothing loses its place.
 */
export function columnRows(notes: readonly NoteDto[], tree: LaneTree, hideDone: boolean): ColumnRow[] {
  const byKey = new Map(notes.map((n) => [noteKey(n.id), n]));
  const shown = tree.order.filter((k) => !tree.hidden.has(k) && byKey.has(k));
  const keep = new Set<string>();
  const holds = new Set<string>();
  for (let i = shown.length - 1; i >= 0; i--) {
    const k = shown[i]!;
    if (hideDone && byKey.get(k)!.doneAt !== null && !holds.has(k)) continue;
    keep.add(k);
    const p = tree.parent.get(k);
    if (p) holds.add(p);
  }
  const depthOf = (k: string) => {
    let d = 0;
    for (let p = tree.parent.get(k); p; p = tree.parent.get(p)) if (keep.has(p)) d++;
    return d;
  };
  const rows = shown.filter((k) => keep.has(k));
  return rows.map((k, i) => {
    const folded = tree.folded.get(k)?.length ?? 0;
    const b = folded ? null : tree.blocker(k);
    const by = b && b !== 'leaf' ? byKey.get(b) : undefined;
    const next = rows[i + 1];
    return {
      note: byKey.get(k)!,
      depth: depthOf(k),
      folded,
      branch: b === 'leaf' ? 'leaf' : b === null ? 'fold' : 'blocked',
      blocker: by ? by.title || by.excerpt : null,
      open: !!next && tree.parent.get(next) === k,
    };
  });
}
