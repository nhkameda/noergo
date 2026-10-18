import type { LaneCover, NoteDto } from '@noergo/core/dto';
import { newId } from '@noergo/core/ids';
import type { Op } from '@noergo/core/ops/schema';
import { between } from '@noergo/core/position';
import { splitText } from './import-ideario';
import { boardsOf, lanesOf, notesByLane, type Data } from './model';
import type { WorkspaceStore } from './store';

type Positioned = { id: string; position: string };
type NoteFields = Pick<Extract<Op, { type: 'note.update' }>, 'title' | 'url' | 'color' | 'done' | 'dueAt'>;

/** The key that puts an item at `index` of `list`, the item itself left out. */
export function positionAt(list: readonly Positioned[], index: number, selfId?: string): string {
  const others = selfId ? list.filter((x) => x.id !== selfId) : list;
  const i = Math.max(0, Math.min(index, others.length));
  return between(others[i - 1]?.position ?? null, others[i]?.position ?? null);
}

/**
 * Every change a person makes on the board, as operations with their inverse (⌘Z). The
 * current state is read at call time, never from a render that may be stale.
 */
export class Actions {
  constructor(private readonly store: WorkspaceStore) {}

  private get data(): Data | null {
    return this.store.getState().data;
  }

  // ───────────────────────────── boards

  createBoard(title: string): string | null {
    const data = this.data;
    if (!data || !title.trim()) return null;
    const id = newId();
    const last = boardsOf(data.boards).at(-1);
    this.store.dispatch({ type: 'board.create', id, title, place: { position: between(last?.position ?? null, null) } }, { undo: [{ type: 'board.delete', id }], redo: [{ type: 'board.restore', id }] });
    return id;
  }

  updateBoard(id: string, patch: { title?: string; color?: string | null }) {
    const cur = this.data?.boards.get(id);
    if (!cur) return;
    const before = { ...(patch.title !== undefined ? { title: cur.title } : {}), ...(patch.color !== undefined ? { color: cur.color } : {}) };
    this.store.dispatch({ type: 'board.update', id, ...patch }, { undo: [{ type: 'board.update', id, ...before }] });
  }

  deleteBoard(id: string) {
    const cur = this.data?.boards.get(id);
    if (!cur) return;
    const undo: Op[] = [{ type: 'board.restore', id }];
    this.store.dispatch({ type: 'board.delete', id }, { undo });
    this.store.notify({ tone: 'info', key: 'deletedBoard', values: { title: cur.title }, undo: () => this.store.dispatch(undo) });
  }

  // ───────────────────────────── columns

  createLane(boardId: string, title: string): string | null {
    const data = this.data;
    if (!data || !title.trim()) return null;
    const id = newId();
    const last = lanesOf(data.lanes, boardId).at(-1);
    this.store.dispatch({ type: 'lane.create', id, boardId, title, place: { position: between(last?.position ?? null, null) } }, { undo: [{ type: 'lane.delete', id }], redo: [{ type: 'lane.restore', id }] });
    return id;
  }

  updateLane(id: string, patch: { title?: string; color?: string | null }) {
    const cur = this.data?.lanes.get(id);
    if (!cur) return;
    const before = { ...(patch.title !== undefined ? { title: cur.title } : {}), ...(patch.color !== undefined ? { color: cur.color } : {}) };
    this.store.dispatch({ type: 'lane.update', id, ...patch }, { undo: [{ type: 'lane.update', id, ...before }] });
  }

  /**
   * A column's cover (null removes it), and with it, when given, a colour: dropping a logo
   * on a column without one paints the column in the logo's colour, in one undo step.
   */
  setCover(id: string, cover: LaneCover | null, color?: string | null) {
    const cur = this.data?.lanes.get(id);
    if (!cur) return;
    const paint = color !== undefined && color !== cur.color ? { color } : {};
    this.store.dispatch({ type: 'lane.update', id, cover, ...paint }, { undo: [{ type: 'lane.update', id, cover: cur.cover ?? null, ...('color' in paint ? { color: cur.color } : {}) }] });
  }

  deleteLane(id: string) {
    const cur = this.data?.lanes.get(id);
    if (!cur) return;
    const undo: Op[] = [{ type: 'lane.restore', id }];
    this.store.dispatch({ type: 'lane.delete', id }, { undo });
    this.store.notify({ tone: 'info', key: 'deletedColumn', values: { title: cur.title }, undo: () => this.store.dispatch(undo) });
  }

  /** Moves a column to `index` among the columns of its board. */
  moveLane(id: string, index: number): { index: number; total: number } | null {
    const data = this.data;
    const cur = data?.lanes.get(id);
    if (!data || !cur) return null;
    const lanes = lanesOf(data.lanes, cur.boardId);
    const position = positionAt(lanes, index, id);
    if (position === cur.position) return null;
    this.store.dispatch({ type: 'lane.move', id, place: { position } }, { undo: [{ type: 'lane.move', id, boardId: cur.boardId, place: { position: cur.position } }] });
    return { index: Math.min(index, lanes.length - 1), total: lanes.length };
  }

  /** Moves a thought to the end of another board, its notes with it. */
  moveLaneToBoard(id: string, boardId: string): boolean {
    const data = this.data;
    const cur = data?.lanes.get(id);
    const board = data?.boards.get(boardId);
    if (!data || !cur || !board || board.deletedAt !== null || boardId === cur.boardId) return false;
    const position = between(lanesOf(data.lanes, boardId).at(-1)?.position ?? null, null);
    const undo: Op[] = [{ type: 'lane.move', id, boardId: cur.boardId, place: { position: cur.position } }];
    this.store.dispatch({ type: 'lane.move', id, boardId, place: { position } }, { undo });
    this.store.notify({ tone: 'info', key: 'movedToBoard', values: { title: cur.title, board: board.title }, undo: () => this.store.dispatch(undo) });
    return true;
  }

  /** Drop of a column on another, at the edge the pointer was closest to. */
  moveLaneNear(id: string, targetId: string, edge: 'left' | 'right' | null) {
    const data = this.data;
    const target = data?.lanes.get(targetId);
    if (!data || !target || id === targetId) return;
    const others = lanesOf(data.lanes, target.boardId).filter((l) => l.id !== id);
    const i = others.findIndex((l) => l.id === targetId);
    this.moveLane(id, edge === 'left' ? i : i + 1);
  }

  // ───────────────────────────── notes

  /** A note from free text: the first line is its title, the rest its body. */
  createNote(laneId: string, text: string, at: 'top' | 'bottom' = 'top'): string | null {
    const data = this.data;
    const { title, body } = splitText(text);
    if (!data || !title) return null;
    const list = notesByLane(data.notes, [laneId]).get(laneId) ?? [];
    const position = at === 'top' ? between(null, list[0]?.position ?? null) : between(list.at(-1)?.position ?? null, null);
    const id = newId();
    this.store.dispatch({ type: 'note.create', id, laneId, title, ...(body ? { body } : {}), place: { position } }, { undo: [{ type: 'note.delete', id }], redo: [{ type: 'note.restore', id }] });
    return id;
  }

  updateNote(id: string, patch: NoteFields) {
    const cur = this.data?.notes.get(id);
    if (!cur) return;
    const before: NoteFields = {};
    if (patch.title !== undefined) before.title = cur.title;
    if (patch.url !== undefined) before.url = cur.url;
    if (patch.color !== undefined) before.color = cur.color;
    if (patch.done !== undefined) before.done = cur.doneAt !== null;
    if (patch.dueAt !== undefined) before.dueAt = cur.dueAt;
    this.store.dispatch({ type: 'note.update', id, ...patch }, { undo: [{ type: 'note.update', id, ...before }] });
  }

  toggleDone(note: NoteDto) {
    this.updateNote(note.id, { done: note.doneAt === null });
  }

  addTag(id: string, tag: string) {
    this.store.dispatch({ type: 'note.update', id, tagsAdd: [tag] }, { undo: [{ type: 'note.update', id, tagsRemove: [tag.trim().replace(/^#/, '').toLowerCase()] }] });
  }

  removeTag(id: string, tag: string) {
    this.store.dispatch({ type: 'note.update', id, tagsRemove: [tag] }, { undo: [{ type: 'note.update', id, tagsAdd: [tag] }] });
  }

  deleteNote(id: string) {
    if (!this.data?.notes.get(id)) return;
    const undo: Op[] = [{ type: 'note.restore', id }];
    this.store.dispatch({ type: 'note.delete', id }, { undo });
    this.store.notify({ tone: 'info', key: 'deletedNote', undo: () => this.store.dispatch(undo) });
  }

  /** Moves a note to `index` of a column (its own or another). */
  moveNote(id: string, laneId: string, index: number): { index: number; total: number } | null {
    const data = this.data;
    const cur = data?.notes.get(id);
    if (!data || !cur || !data.lanes.get(laneId)) return null;
    const list = notesByLane(data.notes, [laneId]).get(laneId) ?? [];
    const position = positionAt(list, index, id);
    if (position === cur.position && laneId === cur.laneId) return null;
    this.store.dispatch({ type: 'note.move', id, laneId, place: { position } }, { undo: [{ type: 'note.move', id, laneId: cur.laneId, place: { position: cur.position } }] });
    const total = list.filter((n) => n.id !== id).length + 1;
    return { index: Math.min(index, total - 1), total };
  }

  /** Drop of a note on another, above or below it. */
  moveNoteNear(id: string, targetId: string, edge: 'top' | 'bottom' | null) {
    const data = this.data;
    const target = data?.notes.get(targetId);
    if (!data || !target || id === targetId) return;
    const others = (notesByLane(data.notes, [target.laneId]).get(target.laneId) ?? []).filter((n) => n.id !== id);
    const i = others.findIndex((n) => n.id === targetId);
    this.moveNote(id, target.laneId, edge === 'top' ? i : i + 1);
  }

  /** Keyboard moves: up/down inside the column, left/right to the neighbouring column. */
  nudgeNote(id: string, dir: 'up' | 'down' | 'left' | 'right'): { laneId: string; index: number; total: number } | null {
    const data = this.data;
    const cur = data?.notes.get(id);
    const lane = cur && data?.lanes.get(cur.laneId);
    if (!data || !cur || !lane) return null;
    const list = notesByLane(data.notes, [cur.laneId]).get(cur.laneId) ?? [];
    const at = list.findIndex((n) => n.id === id);
    if (dir === 'up' || dir === 'down') {
      const to = dir === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= list.length) return null;
      const moved = this.moveNote(id, cur.laneId, to);
      return moved && { laneId: cur.laneId, ...moved };
    }
    const lanes = lanesOf(data.lanes, lane.boardId);
    const next = lanes[lanes.findIndex((l) => l.id === lane.id) + (dir === 'left' ? -1 : 1)];
    if (!next) return null;
    const moved = this.moveNote(id, next.id, at);
    return moved && { laneId: next.id, ...moved };
  }
}
