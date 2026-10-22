import { diff_match_patch } from 'diff-match-patch';
import { sql, type Tx } from '../db';
import type { ActorKind, CoverFrame, Lane, Note } from '../db/types';
import {
  boardDto,
  laneDto,
  layoutDto,
  linkDto,
  noteDto,
  type Effect,
} from '../dto';
import { DomainError, notFound } from '../errors';
import { LIMITS } from '../limits';
import { between } from '../position';
import type { CoverInput, NodeRef, Op, Placement } from './schema';
import { propagateRename, resolvePending, syncWikilinks } from './wikilinks';

export interface OpCtx {
  workspaceId: string;
  actorId: string;
  actorKind: ActorKind;
}

/** One entity change with the state before it, so a later revert can restore it. */
export interface ChangeEffect {
  after: Effect;
  before: Effect | null;
}

export interface Applied {
  entity: { kind: string; id: string };
  result: Record<string, unknown>;
  effects: ChangeEffect[];
}

type Ordered = 'boards' | 'lanes' | 'notes';

// ───────────────────────────── placement

async function edgePosition(tx: Tx, ctx: OpCtx, table: Ordered, scope: string | null, edge: 'min' | 'max'): Promise<string | null> {
  let q = tx
    .selectFrom(table)
    .select((eb) => (edge === 'min' ? eb.fn.min('position') : eb.fn.max('position')).as('p'))
    .where('workspace_id', '=', ctx.workspaceId)
    .where('deleted_at', 'is', null);
  if (table === 'lanes' && scope) q = q.where(sql.ref('board_id'), '=', scope);
  if (table === 'notes' && scope) q = q.where(sql.ref('lane_id'), '=', scope);
  const row = await q.executeTakeFirst();
  return (row?.p as string | null | undefined) ?? null;
}

async function neighbour(tx: Tx, ctx: OpCtx, table: Ordered, scope: string | null, pivot: string, dir: 'next' | 'prev', excludeId?: string): Promise<string | null> {
  let q = tx
    .selectFrom(table)
    .select('position')
    .where('workspace_id', '=', ctx.workspaceId)
    .where('deleted_at', 'is', null)
    .where('position', dir === 'next' ? '>' : '<', pivot)
    .orderBy('position', dir === 'next' ? 'asc' : 'desc')
    .limit(1);
  if (excludeId) q = q.where('id', '!=', excludeId);
  if (table === 'lanes' && scope) q = q.where(sql.ref('board_id'), '=', scope);
  if (table === 'notes' && scope) q = q.where(sql.ref('lane_id'), '=', scope);
  const row = await q.executeTakeFirst();
  return row?.position ?? null;
}

async function positionOf(tx: Tx, ctx: OpCtx, table: Ordered, id: string, scope: string | null): Promise<string> {
  let q = tx.selectFrom(table).select('position').where('id', '=', id).where('workspace_id', '=', ctx.workspaceId).where('deleted_at', 'is', null);
  if (table === 'lanes' && scope) q = q.where(sql.ref('board_id'), '=', scope);
  if (table === 'notes' && scope) q = q.where(sql.ref('lane_id'), '=', scope);
  const row = await q.executeTakeFirst();
  if (!row) throw new DomainError('invalid', 'placement anchor is not in the same list');
  return row.position;
}

async function resolvePlace(tx: Tx, ctx: OpCtx, table: Ordered, scope: string | null, place: Placement | undefined, selfId?: string): Promise<string> {
  if (!place || ('at' in place && place.at === 'bottom')) {
    return between(await edgePosition(tx, ctx, table, scope, 'max'), null);
  }
  if ('position' in place) return place.position;
  if ('at' in place) return between(null, await edgePosition(tx, ctx, table, scope, 'min'));
  if ('after' in place) {
    const p = await positionOf(tx, ctx, table, place.after, scope);
    return between(p, await neighbour(tx, ctx, table, scope, p, 'next', selfId));
  }
  const p = await positionOf(tx, ctx, table, place.before, scope);
  return between(await neighbour(tx, ctx, table, scope, p, 'prev', selfId), p);
}

// ───────────────────────────── loaders (always filtered by workspace: first wall)

async function loadBoard(tx: Tx, ctx: OpCtx, id: string, opts: { deleted?: boolean } = {}) {
  let q = tx.selectFrom('boards').selectAll().where('id', '=', id).where('workspace_id', '=', ctx.workspaceId);
  q = opts.deleted ? q.where('deleted_at', 'is not', null) : q.where('deleted_at', 'is', null);
  const row = await q.forUpdate().executeTakeFirst();
  if (!row) throw notFound('board');
  return row;
}

async function loadLane(tx: Tx, ctx: OpCtx, id: string, opts: { deleted?: boolean } = {}): Promise<Lane> {
  let q = tx.selectFrom('lanes').selectAll().where('id', '=', id).where('workspace_id', '=', ctx.workspaceId);
  q = opts.deleted ? q.where('deleted_at', 'is not', null) : q.where('deleted_at', 'is', null);
  const row = await q.forUpdate().executeTakeFirst();
  if (!row) throw notFound('column');
  return row;
}

/**
 * The stored framing of a cover. The image must be a ready image of this workspace; its
 * size comes from the file, whatever the client sent.
 */
async function coverFrame(tx: Tx, ctx: OpCtx, c: NonNullable<CoverInput>): Promise<CoverFrame> {
  const file = await tx
    .selectFrom('attachments')
    .select(['width', 'height'])
    .where('id', '=', c.fileId)
    .where('workspace_id', '=', ctx.workspaceId)
    .where('status', '=', 'ready')
    .where('deleted_at', 'is', null)
    .where('mime', 'like', 'image/%')
    .executeTakeFirst();
  if (!file?.width || !file.height) throw notFound('image');
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  return { x: r(c.x), y: r(c.y), z: r(c.z), w: file.width, h: file.height, bg: c.bg };
}

/** jsonb keeps its own key order, so frames compare by field. */
const sameFrame = (a: CoverFrame | null, b: CoverFrame | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w && a.h === b.h && a.bg === b.bg);

async function loadNote(tx: Tx, ctx: OpCtx, id: string, opts: { deleted?: boolean } = {}): Promise<Note> {
  let q = tx.selectFrom('notes').selectAll().where('id', '=', id).where('workspace_id', '=', ctx.workspaceId);
  q = opts.deleted ? q.where('deleted_at', 'is not', null) : q.where('deleted_at', 'is', null);
  const row = await q.forUpdate().executeTakeFirst();
  if (!row) throw notFound('note');
  return row;
}

async function assertNode(tx: Tx, ctx: OpCtx, ref: NodeRef): Promise<void> {
  const table = ref.kind === 'note' ? 'notes' : ref.kind === 'lane' ? 'lanes' : 'boards';
  const row = await tx
    .selectFrom(table)
    .select('id')
    .where('id', '=', ref.id)
    .where('workspace_id', '=', ctx.workspaceId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound(ref.kind === 'lane' ? 'column' : ref.kind);
}

const stamp = (ctx: OpCtx) => ({ updated_by: ctx.actorId, updated_at: new Date() });

// ───────────────────────────── revisions

/**
 * Snapshot the note before it changes, so any edit can be undone from history. Writes by
 * agents always cut a revision first; consecutive edits by the same person within the
 * coalescing window share one.
 */
async function maybeRevision(tx: Tx, ctx: OpCtx, note: Note): Promise<void> {
  let cut = ctx.actorKind !== 'user' || note.updated_by !== ctx.actorId;
  if (!cut) {
    const last = await tx
      .selectFrom('note_revisions')
      .select('created_at')
      .where('workspace_id', '=', ctx.workspaceId)
      .where('note_id', '=', note.id)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    const since = last ? new Date(last.created_at).getTime() : new Date(note.created_at).getTime();
    cut = Date.now() - since > LIMITS.revisionCoalesceMs;
  }
  if (!cut) return;
  await tx
    .insertInto('note_revisions')
    .values({
      workspace_id: ctx.workspaceId,
      note_id: note.id,
      version: note.version,
      title: note.title,
      body: note.body,
      tags: note.tags,
      actor_id: note.updated_by,
    })
    .execute();
}

// ───────────────────────────── body edits

const dmp = new diff_match_patch();

function nextBody(op: Extract<Op, { type: 'note.update' }>, note: Note): string | undefined {
  const modes = [op.body !== undefined, op.bodyPatch !== undefined, op.appendText !== undefined, op.replaceText !== undefined].filter(Boolean).length;
  if (modes > 1) throw new DomainError('invalid', 'use only one of body, bodyPatch, appendText or replaceText');
  if (op.body !== undefined) {
    if (op.body === note.body) return undefined;
    if (op.baseVersion === undefined) throw new DomainError('invalid', 'replacing the body requires baseVersion (expected_version)');
    if (op.baseVersion !== note.version) throw conflict(note);
    return op.body;
  }
  if (op.bodyPatch !== undefined) {
    let patches;
    try {
      patches = dmp.patch_fromText(op.bodyPatch);
    } catch {
      throw new DomainError('invalid', 'bodyPatch is not a valid patch');
    }
    const [text, ok] = dmp.patch_apply(patches, note.body);
    if (ok.some((applied) => !applied)) throw conflict(note);
    return text;
  }
  if (op.appendText !== undefined) {
    if (!op.appendText) return undefined;
    const sep = note.body && !note.body.endsWith('\n') ? '\n' : '';
    return note.body + sep + op.appendText;
  }
  if (op.replaceText !== undefined) {
    const { old, new: replacement } = op.replaceText;
    const first = note.body.indexOf(old);
    if (first === -1) throw new DomainError('invalid', 'old_text was not found in the note');
    if (note.body.indexOf(old, first + 1) !== -1) throw new DomainError('invalid', 'old_text appears more than once; include more context');
    return note.body.slice(0, first) + replacement + note.body.slice(first + old.length);
  }
  return undefined;
}

function conflict(note: Note): DomainError {
  return new DomainError('version_conflict', 'the note changed since it was read', {
    currentVersion: note.version,
    current: noteDto(note, { fullBody: true }),
  });
}

// ───────────────────────────── apply

export async function applyOp(tx: Tx, ctx: OpCtx, op: Op): Promise<Applied> {
  const ws = ctx.workspaceId;
  switch (op.type) {
    case 'board.create': {
      const position = await resolvePlace(tx, ctx, 'boards', null, op.place);
      const row = await tx
        .insertInto('boards')
        .values({ id: op.id, workspace_id: ws, title: op.title, color: op.color ?? null, icon: op.icon ?? null, background: op.background ?? null, position, created_by: ctx.actorId, updated_by: ctx.actorId })
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new DomainError('invalid', 'id already in use');
      return { entity: { kind: 'board', id: row.id }, result: { id: row.id, version: row.version }, effects: [{ before: null, after: { kind: 'board', data: boardDto(row) } }] };
    }
    case 'board.update': {
      const cur = await loadBoard(tx, ctx, op.id);
      const patch = {
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.color !== undefined ? { color: op.color } : {}),
        ...(op.icon !== undefined ? { icon: op.icon } : {}),
        ...(op.background !== undefined ? { background: op.background } : {}),
      };
      if (!Object.keys(patch).length || Object.entries(patch).every(([k, v]) => cur[k as keyof typeof cur] === v)) return noop('board', cur.id, cur.version);
      const row = await tx.updateTable('boards').set({ ...patch, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('board', boardDto(cur), boardDto(row), row.version);
    }
    case 'board.move': {
      const cur = await loadBoard(tx, ctx, op.id);
      const position = await resolvePlace(tx, ctx, 'boards', null, op.place, cur.id);
      if (position === cur.position) return noop('board', cur.id, cur.version);
      const row = await tx.updateTable('boards').set({ position, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('board', boardDto(cur), boardDto(row), row.version);
    }
    case 'board.delete':
    case 'board.restore': {
      const restoring = op.type === 'board.restore';
      const cur = await loadBoard(tx, ctx, op.id, { deleted: restoring });
      const row = await tx.updateTable('boards').set({ deleted_at: restoring ? null : new Date(), ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('board', boardDto(cur), boardDto(row), row.version);
    }

    case 'lane.create': {
      await loadBoard(tx, ctx, op.boardId);
      const position = await resolvePlace(tx, ctx, 'lanes', op.boardId, op.place);
      const row = await tx
        .insertInto('lanes')
        .values({ id: op.id, workspace_id: ws, board_id: op.boardId, title: op.title, color: op.color ?? null, url: op.url ?? null, description: op.description ?? '', ...(op.mapLayout ? { map_layout: op.mapLayout } : {}), position, created_by: ctx.actorId, updated_by: ctx.actorId })
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new DomainError('invalid', 'id already in use');
      return { entity: { kind: 'lane', id: row.id }, result: { id: row.id, version: row.version }, effects: [{ before: null, after: { kind: 'lane', data: laneDto(row) } }] };
    }
    case 'lane.update': {
      const cur = await loadLane(tx, ctx, op.id);
      const patch = { ...(op.title !== undefined ? { title: op.title } : {}), ...(op.color !== undefined ? { color: op.color } : {}), ...(op.url !== undefined ? { url: op.url } : {}), ...(op.description !== undefined ? { description: op.description } : {}), ...(op.mapLayout !== undefined ? { map_layout: op.mapLayout } : {}) };
      const changed = Object.entries(patch).some(([k, v]) => cur[k as keyof Lane] !== v);
      let cover: { cover_id: string | null; cover: string | null } | null = null;
      if (op.cover !== undefined) {
        const frame = op.cover ? await coverFrame(tx, ctx, op.cover) : null;
        const same = (op.cover?.fileId ?? null) === cur.cover_id && sameFrame(frame, cur.cover);
        if (!same) cover = { cover_id: op.cover?.fileId ?? null, cover: frame ? JSON.stringify(frame) : null };
      }
      if (!changed && !cover) return noop('lane', cur.id, cur.version);
      const row = await tx.updateTable('lanes').set({ ...patch, ...cover, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('lane', laneDto(cur), laneDto(row), row.version);
    }
    case 'lane.move': {
      const cur = await loadLane(tx, ctx, op.id);
      const boardId = op.boardId ?? cur.board_id;
      if (boardId !== cur.board_id) await loadBoard(tx, ctx, boardId);
      const position = await resolvePlace(tx, ctx, 'lanes', boardId, op.place, cur.id);
      if (position === cur.position && boardId === cur.board_id) return noop('lane', cur.id, cur.version);
      const row = await tx.updateTable('lanes').set({ board_id: boardId, position, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('lane', laneDto(cur), laneDto(row), row.version);
    }
    case 'lane.delete':
    case 'lane.restore': {
      const restoring = op.type === 'lane.restore';
      const cur = await loadLane(tx, ctx, op.id, { deleted: restoring });
      const row = await tx.updateTable('lanes').set({ deleted_at: restoring ? null : new Date(), ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('lane', laneDto(cur), laneDto(row), row.version);
    }

    case 'note.create': {
      await loadLane(tx, ctx, op.laneId);
      const counter = await tx.selectFrom('workspaces').select('note_count').where('id', '=', ws).executeTakeFirstOrThrow();
      if (counter.note_count >= LIMITS.notesPerWorkspace) throw new DomainError('limit_reached', `a workspace holds at most ${LIMITS.notesPerWorkspace} notes`);
      const position = await resolvePlace(tx, ctx, 'notes', op.laneId, op.place ?? { at: 'top' });
      const row = await tx
        .insertInto('notes')
        .values({
          id: op.id,
          workspace_id: ws,
          lane_id: op.laneId,
          position,
          kind: op.url ? 'link' : (op.kind ?? 'text'),
          title: op.title,
          body: op.body ?? '',
          url: op.url ?? null,
          color: op.color ?? null,
          tags: [...new Set(op.tags ?? [])],
          due_at: op.dueAt ?? null,
          created_by: ctx.actorId,
          updated_by: ctx.actorId,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new DomainError('invalid', 'id already in use');
      await tx.updateTable('workspaces').set((eb) => ({ note_count: eb('note_count', '+', 1) })).where('id', '=', ws).execute();
      const linkEffects = [...(await syncWikilinks(tx, ctx, row)), ...(await resolvePending(tx, ctx, row.title))];
      return {
        entity: { kind: 'note', id: row.id },
        result: { id: row.id, version: row.version },
        effects: [{ before: null, after: { kind: 'note', data: noteDto(row) } }, ...linkEffects],
      };
    }
    case 'note.update': {
      const cur = await loadNote(tx, ctx, op.id);
      const body = nextBody(op, cur);
      if (body !== undefined && body.length > LIMITS.noteBody) throw new DomainError('limit_reached', `a note body holds at most ${LIMITS.noteBody} characters`);
      let tags = cur.tags;
      if (op.tagsAdd || op.tagsRemove) {
        const set = new Set(cur.tags);
        for (const t of op.tagsAdd ?? []) set.add(t);
        for (const t of op.tagsRemove ?? []) set.delete(t);
        if (set.size > LIMITS.tags) throw new DomainError('limit_reached', `a note holds at most ${LIMITS.tags} tags`);
        tags = [...set];
      }
      const patch: Record<string, unknown> = {};
      if (op.title !== undefined && op.title !== cur.title) patch.title = op.title;
      if (body !== undefined) patch.body = body;
      if (op.url !== undefined && op.url !== cur.url) {
        patch.url = op.url;
        if (cur.kind === 'text' || cur.kind === 'link') patch.kind = op.url ? 'link' : 'text';
      }
      if (op.color !== undefined && op.color !== cur.color) patch.color = op.color;
      if (tags !== cur.tags && (tags.length !== cur.tags.length || tags.some((t, i) => t !== cur.tags[i]))) patch.tags = tags;
      if (op.done !== undefined && op.done !== (cur.done_at !== null)) patch.done_at = op.done ? new Date() : null;
      if (op.collapsed !== undefined && op.collapsed !== cur.collapsed) patch.collapsed = op.collapsed;
      if (op.dueAt !== undefined) {
        const next = op.dueAt === null ? null : new Date(op.dueAt);
        const prev = cur.due_at === null ? null : new Date(cur.due_at).getTime();
        if ((next?.getTime() ?? null) !== prev) patch.due_at = next;
      }
      if (!Object.keys(patch).length) return noop('note', cur.id, cur.version);
      if ('title' in patch || 'body' in patch || 'tags' in patch) await maybeRevision(tx, ctx, cur);
      const row = await tx.updateTable('notes').set({ ...patch, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      const linkEffects: ChangeEffect[] = [];
      if ('body' in patch) linkEffects.push(...(await syncWikilinks(tx, ctx, row)));
      if ('title' in patch) linkEffects.push(...(await propagateRename(tx, ctx, row, cur.title)), ...(await resolvePending(tx, ctx, row.title)));
      return {
        entity: { kind: 'note', id: row.id },
        result: { id: row.id, version: row.version },
        effects: [{ before: { kind: 'note', data: noteDto(cur, { fullBody: true }) }, after: { kind: 'note', data: noteDto(row, { fullBody: true }) } }, ...linkEffects],
      };
    }
    case 'note.move': {
      const cur = await loadNote(tx, ctx, op.id);
      if (op.laneId !== cur.lane_id) await loadLane(tx, ctx, op.laneId);
      const position = await resolvePlace(tx, ctx, 'notes', op.laneId, op.place, cur.id);
      if (position === cur.position && op.laneId === cur.lane_id) return noop('note', cur.id, cur.version);
      const row = await tx.updateTable('notes').set({ lane_id: op.laneId, position, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      const effects: ChangeEffect[] = [{ before: { kind: 'note', data: noteDto(cur) }, after: { kind: 'note', data: noteDto(row) } }];
      if (op.laneId !== cur.lane_id) {
        // Its place in the old column's map means nothing elsewhere; links are kept.
        const removed = await tx
          .deleteFrom('node_layouts')
          .where('workspace_id', '=', ws)
          .where('view_kind', '=', 'lane_map')
          .where('view_id', '=', cur.lane_id)
          .where('node_kind', '=', 'note')
          .where('node_id', '=', cur.id)
          .returningAll()
          .execute();
        for (const r of removed) {
          effects.push({ before: { kind: 'layout', data: layoutDto(r) }, after: { kind: 'layout.removed', data: { viewKind: r.view_kind, viewId: r.view_id, nodeKind: r.node_kind, nodeId: r.node_id } } });
        }
      }
      return { entity: { kind: 'note', id: row.id }, result: { id: row.id, version: row.version }, effects };
    }
    case 'note.delete':
    case 'note.restore': {
      const restoring = op.type === 'note.restore';
      const cur = await loadNote(tx, ctx, op.id, { deleted: restoring });
      if (restoring) await loadLane(tx, ctx, cur.lane_id).catch(() => {
        throw new DomainError('invalid', 'restore its column first');
      });
      const row = await tx.updateTable('notes').set({ deleted_at: restoring ? null : new Date(), ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      const applied = single('note', noteDto(cur), noteDto(row), row.version);
      if (restoring) applied.effects.push(...(await syncWikilinks(tx, ctx, row)), ...(await resolvePending(tx, ctx, row.title)));
      return applied;
    }

    case 'link.create': {
      if (op.from.kind === op.to.kind && op.from.id === op.to.id) throw new DomainError('invalid', 'a thought cannot link to itself');
      await assertNode(tx, ctx, op.from);
      await assertNode(tx, ctx, op.to);
      const existing = await tx
        .selectFrom('links')
        .selectAll()
        .where('workspace_id', '=', ws)
        .where('deleted_at', 'is', null)
        .where('origin', '=', 'manual')
        .where((eb) =>
          eb.or([
            eb.and([eb('from_kind', '=', op.from.kind), eb('from_id', '=', op.from.id), eb('to_kind', '=', op.to.kind), eb('to_id', '=', op.to.id)]),
            eb.and([eb('from_kind', '=', op.to.kind), eb('from_id', '=', op.to.id), eb('to_kind', '=', op.from.kind), eb('to_id', '=', op.from.id)]),
          ]),
        )
        .executeTakeFirst();
      if (existing) return { entity: { kind: 'link', id: existing.id }, result: { id: existing.id, created: false, version: existing.version }, effects: [] };
      const row = await tx
        .insertInto('links')
        .values({
          id: op.id,
          workspace_id: ws,
          from_kind: op.from.kind,
          from_id: op.from.id,
          to_kind: op.to.kind,
          to_id: op.to.id,
          label: op.label ?? '',
          style: JSON.stringify(op.style ?? {}),
          created_by: ctx.actorId,
          updated_by: ctx.actorId,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new DomainError('invalid', 'id already in use');
      return { entity: { kind: 'link', id: row.id }, result: { id: row.id, created: true, version: row.version }, effects: [{ before: null, after: { kind: 'link', data: linkDto(row) } }] };
    }
    case 'link.update': {
      const cur = await tx.selectFrom('links').selectAll().where('id', '=', op.id).where('workspace_id', '=', ws).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!cur) throw notFound('link');
      const style = op.style ? { ...cur.style, ...op.style } : cur.style;
      const label = op.label ?? cur.label;
      if (label === cur.label && JSON.stringify(style) === JSON.stringify(cur.style)) return noop('link', cur.id, cur.version);
      const row = await tx.updateTable('links').set({ label, style: JSON.stringify(style), ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('link', linkDto(cur), linkDto(row), row.version);
    }
    case 'link.delete': {
      const cur = await tx.selectFrom('links').selectAll().where('id', '=', op.id).where('workspace_id', '=', ws).where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!cur) throw notFound('link');
      const row = await tx.updateTable('links').set({ deleted_at: new Date(), ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('link', linkDto(cur), linkDto(row), row.version);
    }
    case 'link.restore': {
      const cur = await tx.selectFrom('links').selectAll().where('id', '=', op.id).where('workspace_id', '=', ws).forUpdate().executeTakeFirst();
      if (!cur) throw notFound('link');
      if (cur.deleted_at === null) return noop('link', cur.id, cur.version);
      await assertNode(tx, ctx, { kind: cur.from_kind, id: cur.from_id });
      await assertNode(tx, ctx, { kind: cur.to_kind, id: cur.to_id });
      // The same link made again meanwhile: that one stands, this one stays deleted.
      const twin = await tx
        .selectFrom('links')
        .select('id')
        .where('workspace_id', '=', ws)
        .where('deleted_at', 'is', null)
        .where('origin', '=', cur.origin)
        .where('from_kind', '=', cur.from_kind)
        .where('from_id', '=', cur.from_id)
        .where('to_kind', '=', cur.to_kind)
        .where('to_id', '=', cur.to_id)
        .executeTakeFirst();
      if (twin) return noop('link', cur.id, cur.version);
      const row = await tx.updateTable('links').set({ deleted_at: null, ...stamp(ctx), version: cur.version + 1 }).where('id', '=', cur.id).where('workspace_id', '=', ws).returningAll().executeTakeFirstOrThrow();
      return single('link', linkDto(cur), linkDto(row), row.version);
    }

    case 'layout.set': {
      // The global graph uses the workspace id as its view id.
      if (op.viewKind === 'graph') {
        if (op.viewId !== ws) throw notFound('view');
      } else {
        await assertNode(tx, ctx, { kind: op.viewKind === 'lane_map' ? 'lane' : 'board', id: op.viewId });
      }
      for (const kind of ['note', 'lane', 'board'] as const) {
        const ids = [...new Set(op.nodes.filter((n) => n.kind === kind).map((n) => n.id))];
        if (!ids.length) continue;
        const table = kind === 'note' ? 'notes' : kind === 'lane' ? 'lanes' : 'boards';
        const found = await tx.selectFrom(table).select('id').where('workspace_id', '=', ws).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
        if (found.length !== ids.length) throw notFound(kind === 'lane' ? 'column' : kind);
      }
      const effects: ChangeEffect[] = [];
      for (const n of op.nodes) {
        const before = await tx
          .selectFrom('node_layouts')
          .selectAll()
          .where('workspace_id', '=', ws)
          .where('view_kind', '=', op.viewKind)
          .where('view_id', '=', op.viewId)
          .where('node_kind', '=', n.kind)
          .where('node_id', '=', n.id)
          .forUpdate()
          .executeTakeFirst();
        const style = {
          ...(n.shape !== undefined ? { shape: n.shape } : {}),
          ...(n.fill !== undefined ? { fill: n.fill } : {}),
          ...(n.size !== undefined ? { size: n.size } : {}),
          ...(n.color !== undefined ? { color: n.color } : {}),
        };
        if (before && before.x === n.x && before.y === n.y && Object.entries(style).every(([k, v]) => before[k as keyof typeof style] === v)) continue;
        const row = before
          ? await tx
              .updateTable('node_layouts')
              .set({ x: n.x, y: n.y, ...style, version: before.version + 1, updated_at: new Date() })
              .where('workspace_id', '=', ws)
              .where('view_kind', '=', op.viewKind)
              .where('view_id', '=', op.viewId)
              .where('node_kind', '=', n.kind)
              .where('node_id', '=', n.id)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await tx
              .insertInto('node_layouts')
              .values({ workspace_id: ws, view_kind: op.viewKind, view_id: op.viewId, node_kind: n.kind, node_id: n.id, x: n.x, y: n.y, ...style })
              .returningAll()
              .executeTakeFirstOrThrow();
        effects.push({ before: before ? { kind: 'layout', data: layoutDto(before) } : null, after: { kind: 'layout', data: layoutDto(row) } });
      }
      return { entity: { kind: op.viewKind, id: op.viewId }, result: { nodes: effects.length }, effects };
    }
    case 'layout.remove': {
      const effects: ChangeEffect[] = [];
      for (const n of op.nodes) {
        const removed = await tx
          .deleteFrom('node_layouts')
          .where('workspace_id', '=', ws)
          .where('view_kind', '=', op.viewKind)
          .where('view_id', '=', op.viewId)
          .where('node_kind', '=', n.kind)
          .where('node_id', '=', n.id)
          .returningAll()
          .executeTakeFirst();
        if (removed) {
          effects.push({ before: { kind: 'layout', data: layoutDto(removed) }, after: { kind: 'layout.removed', data: { viewKind: removed.view_kind, viewId: removed.view_id, nodeKind: removed.node_kind, nodeId: removed.node_id } } });
        }
      }
      return { entity: { kind: op.viewKind, id: op.viewId }, result: { removed: effects.length }, effects };
    }
  }
}

function noop(kind: string, id: string, version: number): Applied {
  return { entity: { kind, id }, result: { id, version, unchanged: true }, effects: [] };
}

function single<K extends 'board' | 'lane' | 'note' | 'link'>(
  kind: K,
  before: Extract<Effect, { kind: K }>['data'],
  after: Extract<Effect, { kind: K }>['data'],
  version: number,
): Applied {
  return {
    entity: { kind, id: after.id },
    result: { id: after.id, version },
    effects: [{ before: { kind, data: before } as Effect, after: { kind, data: after } as Effect }],
  };
}


