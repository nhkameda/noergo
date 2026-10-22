import type { LaneCover, NoteDto } from '@noergo/core/dto';
import { newId } from '@noergo/core/ids';
import type { Op } from '@noergo/core/ops/schema';
import { between } from '@noergo/core/position';
import { splitText } from './import-ideario';
import { boardsOf, lanesOf, notesByLane, type Data } from './model';
import type { WorkspaceStore } from './store';
import { columnTree, descendants, linksByLane, noteKey, noteOf, reaches, siblings } from './tree';

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

  updateBoard(id: string, patch: { title?: string; color?: string | null; icon?: string | null; background?: string | null }) {
    const cur = this.data?.boards.get(id);
    if (!cur) return;
    const keys = (['title', 'color', 'icon', 'background'] as const).filter((k) => patch[k] !== undefined && patch[k] !== cur[k]);
    if (!keys.length) return;
    const after = Object.fromEntries(keys.map((k) => [k, patch[k]]));
    const before = Object.fromEntries(keys.map((k) => [k, cur[k]]));
    this.store.dispatch({ type: 'board.update', id, ...after }, { undo: [{ type: 'board.update', id, ...before }] });
  }

  /** Moves a board's tab to `index` among the tabs. */
  moveBoard(id: string, index: number): { index: number; total: number } | null {
    const data = this.data;
    const cur = data?.boards.get(id);
    if (!data || !cur) return null;
    const boards = boardsOf(data.boards);
    const to = Math.max(0, Math.min(index, boards.length - 1));
    // Dropped back where it was: no new key, so no change for the server to record.
    if (boards.findIndex((b) => b.id === id) === to) return null;
    const position = positionAt(boards, to, id);
    this.store.dispatch({ type: 'board.move', id, place: { position } }, { undo: [{ type: 'board.move', id, place: { position: cur.position } }] });
    return { index: to, total: boards.length };
  }

  /** A tab dropped on the left or right half of another tab. */
  moveBoardNear(id: string, targetId: string, edge: 'left' | 'right') {
    const data = this.data;
    if (!data || id === targetId) return null;
    const others = boardsOf(data.boards).filter((b) => b.id !== id);
    const i = others.findIndex((b) => b.id === targetId);
    if (i < 0) return null;
    return this.moveBoard(id, edge === 'left' ? i : i + 1);
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

  updateLane(id: string, patch: { title?: string; color?: string | null; url?: string | null; description?: string }) {
    const cur = this.data?.lanes.get(id);
    if (!cur) return;
    const before = { ...(patch.title !== undefined ? { title: cur.title } : {}), ...(patch.color !== undefined ? { color: cur.color } : {}), ...(patch.url !== undefined ? { url: cur.url } : {}), ...(patch.description !== undefined ? { description: cur.description } : {}) };
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

  /**
   * A new idea hanging from `parentId`, after the ones already there (as Tab does on the
   * map); a folded parent opens so it shows. Undo puts it in the trash, link and all.
   */
  createChild(parentId: string, text: string): string | null {
    const data = this.data;
    const parent = data?.notes.get(parentId);
    const { title, body } = splitText(text);
    if (!data || !parent || parent.deletedAt !== null || !title) return null;
    const list = notesByLane(data.notes, [parent.laneId]).get(parent.laneId) ?? [];
    const id = newId();
    const ops: Op[] = [
      { type: 'note.create', id, laneId: parent.laneId, title, ...(body ? { body } : {}), place: { position: between(list.at(-1)?.position ?? null, null) } },
      { type: 'link.create', id: newId(), from: { kind: 'note', id: parentId }, to: { kind: 'note', id } },
    ];
    if (parent.collapsed) ops.push({ type: 'note.update', id: parentId, collapsed: false });
    this.store.dispatch(ops, { undo: [{ type: 'note.delete', id }], redo: [{ type: 'note.restore', id }] });
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

  /**
   * Folds or unfolds ideas. Not undoable: one click puts it back, and Ctrl+Z should reach
   * the last change to the content, not the last look at it.
   */
  setCollapsed(ids: readonly string[], collapsed: boolean) {
    const ops: Op[] = ids.filter((id) => this.data?.notes.get(id)?.collapsed === !collapsed).map((id) => ({ type: 'note.update', id, collapsed }));
    if (ops.length) this.store.dispatch(ops);
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

  /**
   * Moves a note to `index` among the ideas hanging from `parent` (null: the top of the
   * column) in a column, its own or another. What hangs from it goes along. Landing under
   * another idea moves the link it hangs by, so the map shows the same tree; an idea that
   * hangs from two only changes place among its siblings, and none lands under itself.
   * With `centre`, at the top it hangs from the column itself: a main branch on the map.
   */
  moveNote(id: string, to: { laneId: string; parent?: string | null; centre?: boolean; index: number }): { index: number; total: number } | null {
    const data = this.data;
    const cur = data?.notes.get(id);
    if (!data || !cur || !data.lanes.get(to.laneId)) return null;
    const parent = to.parent ?? null;
    const from = columnTree(data, cur.laneId);
    // A line from it to its new parent is turned round, unless that parent hangs by it.
    const back = parent === null || from.parent.get(noteKey(parent)) === noteKey(id) ? [] : [...data.links.values()].filter((l) => l.deletedAt === null && l.origin === 'manual' && l.from.kind === 'note' && l.from.id === id && l.to.kind === 'note' && l.to.id === parent);
    const below = (p: string) => (back.length ? reaches(linksByLane(data).get(cur.laneId) ?? [], noteKey(id), noteKey(p), new Set(back.map((l) => l.id))) : from.below(noteKey(id)).includes(noteKey(p)));
    if (parent !== null && (parent === id || (to.laneId === cur.laneId && below(parent)))) return null;
    const host = parent === null ? null : data.notes.get(parent);
    if (parent !== null && (!host || host.laneId !== to.laneId || host.deletedAt !== null)) return null;

    // The links it hangs by in the column it lands in, the centre's included.
    const into = (r: { kind: string; id: string }) => (r.kind === 'lane' ? r.id === to.laneId : r.kind === 'note' && r.id !== id && data.notes.get(r.id)?.laneId === to.laneId && data.notes.get(r.id)?.deletedAt === null);
    const ins = [...data.links.values()].filter((l) => l.deletedAt === null && l.to.kind === 'note' && l.to.id === id && into(l.from)).sort((a, b) => (a.id < b.id ? -1 : 1));
    // In its own column the tree says where it hangs (a loop is cut at the top).
    const now = to.laneId === cur.laneId ? noteOf(from.parent.get(noteKey(id))) : ins[0]?.from.kind === 'note' ? ins[0].from.id : null;
    const centre = parent === null && !!to.centre;
    const regroup = now !== parent || (centre && !ins.some((l) => l.from.kind === 'lane'));
    if (regroup && new Set(ins.map((l) => `${l.from.kind}:${l.from.id}`)).size > 1) {
      const title = cur.title || cur.excerpt;
      this.store.notify({ tone: 'info', key: 'moveBlocked', values: { title } });
      return null;
    }

    const list = notesByLane(data.notes, [to.laneId]).get(to.laneId) ?? [];
    const tree = to.laneId === cur.laneId ? from : columnTree(data, to.laneId);
    const others = siblings(list, tree, parent).filter((n) => n.id !== id);
    const i = Math.max(0, Math.min(to.index, others.length));
    const result = { index: i, total: others.length + 1 };
    if (!regroup && to.laneId === cur.laneId && siblings(list, tree, parent).findIndex((n) => n.id === id) === i) return null;
    const position = between(others[i - 1]?.position ?? null, others[i]?.position ?? null);

    const ops: Op[] = [{ type: 'note.move', id, laneId: to.laneId, place: { position } }];
    const undo: Op[] = [{ type: 'note.move', id, laneId: cur.laneId, place: { position: cur.position } }];
    if (to.laneId !== cur.laneId) {
      // Its branch keeps its order: places only count among siblings.
      for (const d of descendants(from, id)) {
        const n = data.notes.get(d)!;
        ops.push({ type: 'note.move', id: d, laneId: to.laneId, place: { position: n.position } });
        undo.push({ type: 'note.move', id: d, laneId: n.laneId, place: { position: n.position } });
      }
    }
    const redo = [...ops];
    if (regroup) {
      for (const l of [...ins, ...back]) {
        ops.push({ type: 'link.delete', id: l.id });
        redo.push({ type: 'link.delete', id: l.id });
        undo.unshift({ type: 'link.restore', id: l.id });
      }
      if (parent !== null || centre) {
        const link = newId();
        ops.push({ type: 'link.create', id: link, from: parent !== null ? { kind: 'note', id: parent } : { kind: 'lane', id: to.laneId }, to: { kind: 'note', id } });
        redo.push({ type: 'link.restore', id: link });
        undo.unshift({ type: 'link.delete', id: link });
      }
    }
    this.store.dispatch(ops, { undo, redo });
    return result;
  }

  /**
   * Drop of a note on another, above or below it. Below an idea whose own ideas follow it
   * on show is the first of those.
   */
  moveNoteNear(id: string, targetId: string, edge: 'top' | 'bottom' | null, open = false) {
    const data = this.data;
    const target = data?.notes.get(targetId);
    if (!data || !target || id === targetId) return null;
    if (edge === 'bottom' && open) return this.moveNote(id, { laneId: target.laneId, parent: targetId, index: 0 });
    const tree = columnTree(data, target.laneId);
    const parent = noteOf(tree.parent.get(noteKey(targetId)));
    const others = siblings(notesByLane(data.notes, [target.laneId]).get(target.laneId) ?? [], tree, parent).filter((n) => n.id !== id);
    const i = others.findIndex((n) => n.id === targetId);
    return this.moveNote(id, { laneId: target.laneId, parent, index: edge === 'top' ? i : i + 1 });
  }

  /**
   * Keyboard moves: up/down among the ideas beside it, left/right to the top of the
   * neighbouring column, at the same place.
   */
  nudgeNote(id: string, dir: 'up' | 'down' | 'left' | 'right'): { laneId: string; index: number; total: number } | null {
    const data = this.data;
    const cur = data?.notes.get(id);
    const lane = cur && data?.lanes.get(cur.laneId);
    if (!data || !cur || !lane) return null;
    const tree = columnTree(data, cur.laneId);
    const parent = noteOf(tree.parent.get(noteKey(id)));
    const list = siblings(notesByLane(data.notes, [cur.laneId]).get(cur.laneId) ?? [], tree, parent);
    const at = list.findIndex((n) => n.id === id);
    if (dir === 'up' || dir === 'down') {
      const to = dir === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= list.length) return null;
      const moved = this.moveNote(id, { laneId: cur.laneId, parent, index: to });
      return moved && { laneId: cur.laneId, ...moved };
    }
    const lanes = lanesOf(data.lanes, lane.boardId);
    const next = lanes[lanes.findIndex((l) => l.id === lane.id) + (dir === 'left' ? -1 : 1)];
    if (!next) return null;
    const moved = this.moveNote(id, { laneId: next.id, index: at });
    return moved && { laneId: next.id, ...moved };
  }
}
