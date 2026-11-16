import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { ensureActor } from './actors';
import { getDb, isUuid, sql, withWorkspace, type Db, type Tx } from './db';
import type { ActorKind, ShareAccess, ShareTargetKind } from './db/types';
import { boardDto, laneDto, layoutDto, linkDto, noteDto, type BoardDto, type Effect, type LaneDto, type NoteDto } from './dto';
import { DomainError, notFound } from './errors';
import { readFile } from './files';
import { LIMITS } from './limits';
import type { ChangeEffect } from './ops/apply';
import { executeOps, type OpOutcome } from './ops/execute';
import type { Envelope, NodeRef, Op } from './ops/schema';
import type { ChangeRow, NoteDetail, Snapshot } from './read';

/**
 * Links that open one board, or one thought, to whoever holds them: to look at it, or
 * also to change it. Everything a link reaches goes through here, cut down to what it
 * opens: the snapshot, the live changes, a note's detail, a file, and every write. An id
 * outside it answers not_found, as an id of another workspace does.
 *
 * The link is never stored. It is the share id and an HMAC of it under a key derived
 * from AUTH_SECRET, so the owner can copy it again, a copy of the database alone opens
 * nothing, and changing AUTH_SECRET turns every link off.
 */

export type ShareTarget = { kind: ShareTargetKind; id: string };

/** A live link, as its owner sees it. */
export interface ShareDto {
  id: string;
  target: ShareTarget;
  access: ShareAccess;
  createdAt: string;
}

/** What a valid link opens, once resolved. */
export interface SharedLink {
  id: string;
  workspaceId: string;
  kind: ShareTargetKind;
  targetId: string;
  access: ShareAccess;
  /** The board's or the thought's title, for the page and its preview. */
  title: string;
}

// ───────────────────────────── the link

const TOKEN = /^[A-Za-z0-9_-]{44}$/;

function linkKey(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)');
  return Buffer.from(hkdfSync('sha256', secret, 'noergo', 'share-link', 32));
}

const macOf = (secret: string, id: Buffer) => createHmac('sha256', linkKey(secret)).update(id).digest().subarray(0, 16);

/** The secret part of a share's URL: 22 characters of id, 22 of HMAC. */
export function shareToken(secret: string, shareId: string): string {
  if (!isUuid(shareId)) throw new Error('invalid share id');
  const id = Buffer.from(shareId.replaceAll('-', ''), 'hex');
  return id.toString('base64url') + macOf(secret, id).toString('base64url');
}

/** The share a token names, or null when it is not one this instance signed. */
export function shareIdOfToken(secret: string, token: string): string | null {
  if (!TOKEN.test(token)) return null;
  const id = Buffer.from(token.slice(0, 22), 'base64url');
  const mac = Buffer.from(token.slice(22), 'base64url');
  // Only the canonical spelling: the spare bits of the last character must be zero.
  if (id.length !== 16 || mac.length !== 16 || id.toString('base64url') !== token.slice(0, 22) || mac.toString('base64url') !== token.slice(22)) return null;
  if (!timingSafeEqual(mac, macOf(secret, id))) return null;
  const h = id.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Where a link's live stream may resume: a seq the server handed out, with the snapshot or
 * an event, signed for this share. A seq chosen by the visitor could replay the board's
 * history from before they had the link: old texts, notes since trashed.
 */
export function shareCursor(secret: string, shareId: string, seq: number): string {
  const key = Buffer.from(hkdfSync('sha256', linkKey(secret), 'noergo', 'share-cursor', 32));
  return `${seq}.${createHmac('sha256', key).update(`${shareId}:${seq}`).digest().subarray(0, 16).toString('base64url')}`;
}

/** The seq of a cursor shareCursor made for this share, or null. */
export function cursorSeq(secret: string, shareId: string, cursor: string): number | null {
  const m = /^(0|[1-9]\d{0,14})\.[A-Za-z0-9_-]{22}$/.exec(cursor);
  if (!m) return null;
  const seq = Number(m[1]);
  const expected = Buffer.from(shareCursor(secret, shareId, seq));
  const given = Buffer.from(cursor);
  return given.length === expected.length && timingSafeEqual(given, expected) ? seq : null;
}

// ───────────────────────────── the owner's side

const shareDto = (r: { id: string; target_kind: ShareTargetKind; target_id: string; access: ShareAccess; created_at: Date }): ShareDto => ({
  id: r.id,
  target: { kind: r.target_kind, id: r.target_id },
  access: r.access,
  createdAt: new Date(r.created_at).toISOString(),
});

async function assertTarget(tx: Tx, workspaceId: string, target: ShareTarget): Promise<void> {
  if (!isUuid(target.id)) throw notFound(target.kind);
  const table = target.kind === 'board' ? 'boards' : 'lanes';
  const row = await tx.selectFrom(table).select('id').where('workspace_id', '=', workspaceId).where('id', '=', target.id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!row) throw notFound(target.kind === 'board' ? 'board' : 'thought');
}

/** The live links of one board or thought. */
export async function listShares(workspaceId: string, target: ShareTarget, db: Db = getDb()): Promise<ShareDto[]> {
  if (!isUuid(target.id)) return [];
  const rows = await db
    .selectFrom('shares')
    .select(['id', 'target_kind', 'target_id', 'access', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('target_kind', '=', target.kind)
    .where('target_id', '=', target.id)
    .where('revoked_at', 'is', null)
    .orderBy('created_at')
    .execute();
  return rows.map(shareDto);
}

/** Shares a board or thought. Sharing it again with the same access hands out the same link. */
export async function createShare(ctx: { workspaceId: string; userId: string }, target: ShareTarget, access: ShareAccess, db: Db = getDb()): Promise<ShareDto> {
  if (access !== 'view' && access !== 'edit') throw new DomainError('invalid', 'access is view or edit');
  return withWorkspace(
    ctx.workspaceId,
    async (tx) => {
      await assertTarget(tx, ctx.workspaceId, target);
      const live = () =>
        tx
          .selectFrom('shares')
          .select(['id', 'target_kind', 'target_id', 'access', 'created_at'])
          .where('workspace_id', '=', ctx.workspaceId)
          .where('target_kind', '=', target.kind)
          .where('target_id', '=', target.id)
          .where('access', '=', access)
          .where('revoked_at', 'is', null)
          .executeTakeFirst();
      const existing = await live();
      if (existing) return shareDto(existing);
      const active = await tx.selectFrom('shares').select((eb) => eb.fn.countAll<number>().as('n')).where('workspace_id', '=', ctx.workspaceId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(active.n) >= LIMITS.sharesPerWorkspace) throw new DomainError('limit_reached', `a workspace has at most ${LIMITS.sharesPerWorkspace} live links`);
      // Two clicks at once: the partial unique index keeps one, and the second reads it back.
      await tx
        .insertInto('shares')
        .values({ workspace_id: ctx.workspaceId, target_kind: target.kind, target_id: target.id, access, created_by: ctx.userId })
        .onConflict((oc) => oc.columns(['workspace_id', 'target_kind', 'target_id', 'access']).where('revoked_at', 'is', null).doNothing())
        .execute();
      const row = await live();
      if (!row) throw new Error('share vanished after insert');
      return shareDto(row);
    },
    { db },
  );
}

/** Turns a link off for good. Sharing again makes a new link; the old one stays dead. */
export async function revokeShare(workspaceId: string, shareId: string, db: Db = getDb()): Promise<void> {
  if (!isUuid(shareId)) throw notFound('link');
  const res = await db.updateTable('shares').set({ revoked_at: new Date() }).where('workspace_id', '=', workspaceId).where('id', '=', shareId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!res.numUpdatedRows) throw notFound('link');
}

// ───────────────────────────── what a link opens

interface Scope {
  kind: ShareTargetKind;
  /** The board shown. For a thought, the thought's own id: its stand-in board (laneBoard). */
  boardId: string;
  /** The real board, for a board link. */
  realBoardId: string;
  /** The live thoughts it opens. */
  lanes: Set<string>;
  title: string;
}

/**
 * What the link opens right now, or null when nothing: the link was turned off, its
 * board or thought (or the thought's board) is in the trash, or the owner is blocked.
 */
async function scopeOf(tx: Tx, link: Pick<SharedLink, 'id' | 'workspaceId' | 'kind' | 'targetId'>): Promise<Scope | null> {
  const ws = link.workspaceId;
  const share = await tx.selectFrom('shares').select('id').where('id', '=', link.id).where('workspace_id', '=', ws).where('revoked_at', 'is', null).executeTakeFirst();
  if (!share) return null;
  const owner = await tx
    .selectFrom('workspaces as w')
    .innerJoin('users as u', 'u.id', 'w.owner_id')
    .select('u.id')
    .where('w.id', '=', ws)
    .where('u.blocked_at', 'is', null)
    .where('u.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!owner) return null;
  if (link.kind === 'board') {
    const b = await tx.selectFrom('boards').select(['id', 'title']).where('workspace_id', '=', ws).where('id', '=', link.targetId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!b) return null;
    const lanes = await tx.selectFrom('lanes').select('id').where('workspace_id', '=', ws).where('board_id', '=', b.id).where('deleted_at', 'is', null).execute();
    return { kind: 'board', boardId: b.id, realBoardId: b.id, lanes: new Set(lanes.map((l) => l.id)), title: b.title };
  }
  const l = await tx
    .selectFrom('lanes as l')
    .innerJoin('boards as b', (j) => j.onRef('b.id', '=', 'l.board_id').onRef('b.workspace_id', '=', 'l.workspace_id'))
    .select(['l.id', 'l.title'])
    .where('l.workspace_id', '=', ws)
    .where('l.id', '=', link.targetId)
    .where('l.deleted_at', 'is', null)
    .where('b.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!l) return null;
  return { kind: 'lane', boardId: l.id, realBoardId: '', lanes: new Set([l.id]), title: l.title };
}

/** The live link behind a share id, or null. */
export async function resolveShare(shareId: string, db: Db = getDb()): Promise<SharedLink | null> {
  if (!isUuid(shareId)) return null;
  const row = await db.selectFrom('shares').select(['id', 'workspace_id', 'target_kind', 'target_id', 'access']).where('id', '=', shareId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!row) return null;
  const link = { id: row.id, workspaceId: row.workspace_id, kind: row.target_kind, targetId: row.target_id, access: row.access };
  const scope = await withWorkspace(row.workspace_id, (tx) => scopeOf(tx, link), { db, snapshot: true });
  return scope ? { ...link, title: scope.title } : null;
}

/**
 * A shared thought travels under a board of its own, which carries its title and nothing
 * of the real board (its name, its other thoughts) and keeps the thought's id: the thought
 * stays on screen wherever its owner moves it.
 */
function laneBoard(lane: LaneDto): BoardDto {
  return { id: lane.id, title: lane.title, color: null, icon: null, background: null, position: 'a0', version: lane.version, updatedAt: lane.updatedAt, deletedAt: lane.deletedAt };
}

const asShown = (scope: Scope, lane: LaneDto): LaneDto => (scope.kind === 'lane' ? { ...lane, boardId: scope.boardId } : lane);

/** The thought each note belongs to (trash included): a link or a layout is in when its notes are. */
async function lanesOfNotes(tx: Tx, workspaceId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)];
  const out = new Map<string, string>();
  for (let i = 0; i < list.length; i += 1000) {
    const rows = await tx.selectFrom('notes').select(['id', 'lane_id']).where('workspace_id', '=', workspaceId).where('id', 'in', list.slice(i, i + 1000)).execute();
    for (const r of rows) out.set(r.id, r.lane_id);
  }
  return out;
}

function nodeIn(scope: Scope, ref: NodeRef, noteLane: ReadonlyMap<string, string>): boolean {
  if (ref.kind === 'board') return scope.kind === 'board' && ref.id === scope.realBoardId;
  if (ref.kind === 'lane') return scope.lanes.has(ref.id);
  const lane = noteLane.get(ref.id);
  return lane !== undefined && scope.lanes.has(lane);
}

function viewIn(scope: Scope, viewKind: string, viewId: string): boolean {
  if (viewKind === 'lane_map') return scope.lanes.has(viewId);
  return viewKind === 'board_map' && scope.kind === 'board' && viewId === scope.realBoardId;
}

/** Everything the link opens, at one seq; the live stream continues from there. */
export async function sharedSnapshot(link: SharedLink, db?: Db): Promise<Snapshot | null> {
  const ws = link.workspaceId;
  return withWorkspace(
    ws,
    async (tx) => {
      const scope = await scopeOf(tx, link);
      if (!scope) return null;
      const seq = (await tx.selectFrom('workspaces').select('seq').where('id', '=', ws).executeTakeFirstOrThrow()).seq;
      const laneIds = [...scope.lanes];
      const lanes = laneIds.length ? await tx.selectFrom('lanes').selectAll().where('workspace_id', '=', ws).where('id', 'in', laneIds).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute() : [];
      const notes = laneIds.length ? await tx.selectFrom('notes').selectAll().where('workspace_id', '=', ws).where('lane_id', 'in', laneIds).where('deleted_at', 'is', null).orderBy('lane_id').orderBy('position').orderBy('id').execute() : [];
      const noteLane = new Map(notes.map((n) => [n.id, n.lane_id]));
      const nodeIds = [...laneIds, ...noteLane.keys(), ...(scope.kind === 'board' ? [scope.realBoardId] : [])];
      const links = [];
      const layouts = [];
      // Chunked: a big board has thousands of ideas, and an IN list has to stay reasonable.
      for (let i = 0; i < nodeIds.length; i += 1000) {
        const part = nodeIds.slice(i, i + 1000);
        links.push(...(await tx.selectFrom('links').selectAll().where('workspace_id', '=', ws).where('deleted_at', 'is', null).where('from_id', 'in', part).execute()));
      }
      const views = [...laneIds, ...(scope.kind === 'board' ? [scope.realBoardId] : [])];
      if (views.length) layouts.push(...(await tx.selectFrom('node_layouts').selectAll().where('workspace_id', '=', ws).where('view_id', 'in', views).execute()));
      const shownLanes = lanes.map((l) => asShown(scope, laneDto(l)));
      let boards: BoardDto[];
      if (scope.kind === 'board') {
        const b = await tx.selectFrom('boards').selectAll().where('workspace_id', '=', ws).where('id', '=', scope.realBoardId).executeTakeFirstOrThrow();
        boards = [boardDto(b)];
      } else {
        boards = [laneBoard(shownLanes[0]!)];
      }
      return {
        seq,
        inboxLaneId: null,
        boards,
        lanes: shownLanes,
        notes: notes.map((n) => noteDto(n)),
        links: links.filter((l) => nodeIn(scope, { kind: l.from_kind, id: l.from_id }, noteLane) && nodeIn(scope, { kind: l.to_kind, id: l.to_id }, noteLane)).map(linkDto),
        layouts: layouts.filter((l) => viewIn(scope, l.view_kind, l.view_id) && nodeIn(scope, { kind: l.node_kind, id: l.node_id }, noteLane)).map(layoutDto),
      };
    },
    { db, snapshot: true },
  );
}

// ───────────────────────────── live changes, cut to the link

const now = () => new Date().toISOString();

/** A thought that left the link: gone from the screen, with nothing of where it went or what it says. */
function laneTombstone(before: LaneDto, after: LaneDto): LaneDto {
  return { ...after, boardId: before.boardId, title: '', description: '', url: null, cover: null, color: null, deletedAt: after.deletedAt ?? now() };
}

function noteTombstone(before: NoteDto, after: NoteDto): NoteDto {
  const { body: _body, ...rest } = after;
  return { ...rest, laneId: before.laneId, title: '', excerpt: '', bodyLength: 0, url: null, attachmentId: null, color: null, tags: [], dueAt: null, doneAt: null, deletedAt: after.deletedAt ?? now() };
}

/**
 * The part of one change the link may see. Something leaving it becomes a tombstone that
 * tells nothing; something entering it (a thought or an idea moved in, a thought out of
 * the trash) asks for a fresh snapshot, because its ideas and links come with it.
 */
function cut(scope: Scope, list: readonly ChangeEffect[], noteLane: ReadonlyMap<string, string>): { effects: Effect[]; reset: boolean } {
  const out: Effect[] = [];
  let reset = false;
  for (const { before, after } of list) {
    switch (after.kind) {
      case 'board':
        if (scope.kind === 'board' && after.data.id === scope.realBoardId) out.push(after);
        break;
      case 'lane': {
        const laneIn = (l: LaneDto) => (scope.kind === 'board' ? l.boardId === scope.realBoardId : l.id === scope.boardId);
        const was = before?.kind === 'lane' ? before.data : null;
        const isIn = laneIn(after.data);
        const wasIn = was ? laneIn(was) : false;
        if (isIn && was && (!wasIn || (was.deletedAt !== null && after.data.deletedAt === null))) reset = true;
        else if (isIn) {
          const shown = asShown(scope, after.data);
          out.push({ kind: 'lane', data: shown });
          if (scope.kind === 'lane') out.push({ kind: 'board', data: laneBoard(shown) });
        } else if (was && wasIn) out.push({ kind: 'lane', data: asShown(scope, laneTombstone(was, after.data)) });
        break;
      }
      case 'note': {
        const was = before?.kind === 'note' ? before.data : null;
        const isIn = scope.lanes.has(after.data.laneId);
        const wasIn = was ? scope.lanes.has(was.laneId) : false;
        if (isIn && was && !wasIn) reset = true;
        else if (isIn) out.push(after);
        else if (was && wasIn) out.push({ kind: 'note', data: noteTombstone(was, after.data) });
        break;
      }
      case 'link': {
        const { from, to } = after.data;
        const fromIn = nodeIn(scope, from, noteLane);
        const toIn = nodeIn(scope, to, noteLane);
        if (fromIn && toIn) out.push(after);
        // A link to something outside, now gone: the client may hold it from before its
        // other end left. Its end outside is not told.
        else if ((fromIn || toIn) && after.data.deletedAt !== null) {
          const inside = fromIn ? from : to;
          out.push({ kind: 'link', data: { ...after.data, from: inside, to: inside, label: '', style: {} } });
        }
        break;
      }
      case 'layout':
      case 'layout.removed':
        if (viewIn(scope, after.data.viewKind, after.data.viewId) && nodeIn(scope, { kind: after.data.nodeKind, id: after.data.nodeId }, noteLane)) out.push(after);
        break;
    }
  }
  return { effects: out, reset };
}

/** Note ids that links and layouts in these effects point at. */
function notesNamed(list: readonly ChangeEffect[]): string[] {
  const ids: string[] = [];
  for (const { after } of list) {
    if (after.kind === 'link') {
      if (after.data.from.kind === 'note') ids.push(after.data.from.id);
      if (after.data.to.kind === 'note') ids.push(after.data.to.id);
    } else if ((after.kind === 'layout' || after.kind === 'layout.removed') && after.data.nodeKind === 'note') ids.push(after.data.nodeId);
  }
  return ids;
}

export type SharedChangesPage = { gone: true } | { gone: false; reset: true } | { gone: false; reset: false; seq: number; changes: ChangeRow[]; more: boolean };

/**
 * The changes after `since`, as the link sees them. Every seq is there, so the client
 * notices no gap; a change it may not see arrives empty, without who made it or what.
 */
export async function sharedChangesSince(link: SharedLink, since: number, limit = 500, db?: Db): Promise<SharedChangesPage> {
  const ws = link.workspaceId;
  return withWorkspace(
    ws,
    async (tx) => {
      const scope = await scopeOf(tx, link);
      if (!scope) return { gone: true };
      const seq = (await tx.selectFrom('workspaces').select('seq').where('id', '=', ws).executeTakeFirstOrThrow()).seq;
      if (since > seq) return { gone: false, reset: true };
      if (since === seq) return { gone: false, reset: false, seq, changes: [], more: false };
      const rows = await tx
        .selectFrom('changes as c')
        .leftJoin('actors as a', (j) => j.onRef('a.id', '=', 'c.actor_id').onRef('a.workspace_id', '=', 'c.workspace_id'))
        .select(['c.seq', 'c.op', 'c.actor_id', 'c.created_at', 'c.effects', 'a.kind', 'a.label'])
        .where('c.workspace_id', '=', ws)
        .where('c.seq', '>', since)
        .orderBy('c.seq')
        .limit(limit)
        .execute();
      const first = rows[0];
      const windowStart = Date.now() - LIMITS.changesResumeDays * 86_400_000;
      if (!first || first.seq !== since + 1 || new Date(first.created_at).getTime() < windowStart) return { gone: false, reset: true };
      // A thought that came in after `since` (onto the board, out of the trash) carries a past
      // the link never showed; its notes are judged by where they are now, so start over.
      const lanes = [...scope.lanes];
      const entered =
        lanes.length > 0 &&
        (await tx
          .selectFrom('changes')
          .select('seq')
          .where('workspace_id', '=', ws)
          .where('seq', '>', since)
          .where('entity_kind', '=', 'lane')
          .where('entity_id', 'in', lanes)
          .where((eb) =>
            eb.or([
              eb('op', '=', 'lane.restore'),
              eb.and([eb('op', '=', 'lane.move'), sql<boolean>`effects->0->'before'->'data'->>'boardId' IS DISTINCT FROM effects->0->'after'->'data'->>'boardId'`]),
            ]),
          )
          .limit(1)
          .executeTakeFirst());
      if (entered) return { gone: false, reset: true };
      const noteLane = await lanesOfNotes(tx, ws, rows.flatMap((r) => notesNamed(r.effects as ChangeEffect[])));
      const changes: ChangeRow[] = [];
      for (const r of rows) {
        const { effects, reset } = cut(scope, r.effects as ChangeEffect[], noteLane);
        if (reset) return { gone: false, reset: true };
        const createdAt = new Date(r.created_at).toISOString();
        changes.push(
          effects.length
            ? // People's names stay with the owner; an agent's name is what its halo shows.
              { seq: r.seq, op: r.op, actorId: r.actor_id, actor: r.kind ? { kind: r.kind as ActorKind, label: r.kind === 'user' ? '' : (r.label ?? '') } : null, createdAt, effects }
            : { seq: r.seq, op: '', actorId: null, actor: null, createdAt, effects: [] },
        );
      }
      return { gone: false, reset: false, seq: changes[changes.length - 1]!.seq, changes, more: rows.length === limit };
    },
    { db, snapshot: true },
  );
}

// ───────────────────────────── a note, a file

/** One note of the link, whole, with only the links whose other end the link opens too. */
export async function sharedNote(link: SharedLink, noteId: string, db?: Db): Promise<NoteDetail> {
  if (!isUuid(noteId)) throw notFound('note');
  const ws = link.workspaceId;
  return withWorkspace(
    ws,
    async (tx) => {
      const scope = await scopeOf(tx, link);
      if (!scope) throw notFound('note');
      const n = await tx.selectFrom('notes').selectAll().where('workspace_id', '=', ws).where('id', '=', noteId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!n || !scope.lanes.has(n.lane_id)) throw notFound('note');
      const lane = await tx.selectFrom('lanes').select(['id', 'title']).where('workspace_id', '=', ws).where('id', '=', n.lane_id).executeTakeFirstOrThrow();
      const links = await tx
        .selectFrom('links')
        .selectAll()
        .where('workspace_id', '=', ws)
        .where('deleted_at', 'is', null)
        .where((eb) => eb.or([eb.and([eb('from_kind', '=', 'note'), eb('from_id', '=', noteId)]), eb.and([eb('to_kind', '=', 'note'), eb('to_id', '=', noteId)])]))
        .limit(1000)
        .execute();
      const others = links.map((l) => (l.from_kind === 'note' && l.from_id === noteId ? { kind: l.to_kind, id: l.to_id } : { kind: l.from_kind, id: l.from_id }));
      const noteLane = await lanesOfNotes(tx, ws, [noteId, ...others.filter((o) => o.kind === 'note').map((o) => o.id)]);
      const titles = new Map<string, string>();
      for (const [kind, table] of [['note', 'notes'], ['lane', 'lanes'], ['board', 'boards']] as const) {
        const ids = [...new Set(others.filter((o) => o.kind === kind && nodeIn(scope, o, noteLane)).map((o) => o.id))];
        if (!ids.length) continue;
        const rows = await tx.selectFrom(table).select(['id', 'title']).where('workspace_id', '=', ws).where('deleted_at', 'is', null).where('id', 'in', ids).execute();
        for (const r of rows) titles.set(`${kind}:${r.id}`, r.title);
      }
      const outgoing: NoteDetail['outgoing'] = [];
      const incoming: NoteDetail['incoming'] = [];
      links.forEach((l, i) => {
        const other = others[i]!;
        const otherTitle = titles.get(`${other.kind}:${other.id}`);
        if (otherTitle === undefined) return; // outside the link, or in the trash
        (l.from_kind === 'note' && l.from_id === noteId ? outgoing : incoming).push({ ...linkDto(l), otherTitle });
      });
      const board = scope.kind === 'board' ? { id: scope.realBoardId, title: scope.title } : { id: scope.boardId, title: lane.title };
      return { note: noteDto(n, { fullBody: true }), lane: { id: lane.id, title: lane.title }, board, outgoing, incoming };
    },
    { db, snapshot: true },
  );
}

/** A stored file the link shows: the cover of one of its thoughts, or one of its ideas' attachment. */
export async function sharedFile(link: SharedLink, fileId: string, db?: Db): Promise<{ bytes: Buffer; mime: string; sha256: string }> {
  if (!isUuid(fileId)) throw notFound('file');
  const ws = link.workspaceId;
  const shown = await withWorkspace(
    ws,
    async (tx) => {
      const scope = await scopeOf(tx, link);
      if (!scope || !scope.lanes.size) return false;
      const lanes = [...scope.lanes];
      const cover = await tx.selectFrom('lanes').select('id').where('workspace_id', '=', ws).where('id', 'in', lanes).where('deleted_at', 'is', null).where('cover_id', '=', fileId).executeTakeFirst();
      if (cover) return true;
      const note = await tx.selectFrom('notes').select('id').where('workspace_id', '=', ws).where('lane_id', 'in', lanes).where('deleted_at', 'is', null).where('attachment_id', '=', fileId).executeTakeFirst();
      return !!note;
    },
    { db, snapshot: true },
  );
  if (!shown) throw notFound('file');
  return readFile(ws, fileId, db);
}

// ───────────────────────────── writing through a link

const outside = () => notFound('item');
const notHere = (what: string) => new DomainError('forbidden', `a shared link cannot ${what}`);

/**
 * Refuses an op that reaches past the link. Runs inside the op's transaction, after the
 * workspace lock, so what it checks is what the op will find. Ids outside the link answer
 * not_found; what the link opens but may not change (the board itself, a cover, the
 * shared thought's own place) answers forbidden.
 */
async function guardOp(tx: Tx, link: SharedLink, op: Op): Promise<{ wikiLanes: ReadonlySet<string> }> {
  const scope = await scopeOf(tx, link);
  if (!scope) throw notFound(link.kind === 'board' ? 'board' : 'thought');
  await checkOp(tx, link, scope, op);
  // [[wikilinks]] written through the link resolve, wait and rename only inside it.
  return { wikiLanes: scope.lanes };
}

async function checkOp(tx: Tx, link: SharedLink, scope: Scope, op: Op): Promise<void> {
  const ws = link.workspaceId;
  const onBoard = scope.kind === 'board';
  // A thought of the shared board, in the trash or not: a retried delete still finds it.
  const ofBoard = async (id: string) => {
    if (!onBoard) throw outside();
    const lane = await tx.selectFrom('lanes').select('board_id').where('workspace_id', '=', ws).where('id', '=', id).executeTakeFirst();
    if (lane?.board_id !== scope.realBoardId) throw outside();
  };
  const noteIn = async (id: string) => {
    const lane = (await lanesOfNotes(tx, ws, [id])).get(id);
    if (lane === undefined || !scope.lanes.has(lane)) throw outside();
  };
  const refsIn = async (refs: NodeRef[]) => {
    const noteLane = await lanesOfNotes(tx, ws, refs.filter((r) => r.kind === 'note').map((r) => r.id));
    for (const r of refs) if (!nodeIn(scope, r, noteLane)) throw outside();
  };
  switch (op.type) {
    case 'board.create':
    case 'board.update':
    case 'board.move':
    case 'board.delete':
    case 'board.restore':
      throw notHere('change boards');
    case 'lane.create':
      if (!onBoard) throw notHere('add thoughts here');
      if (op.boardId !== scope.realBoardId) throw outside();
      return;
    case 'lane.update':
      if (!scope.lanes.has(op.id)) throw outside();
      if (op.cover !== undefined) throw notHere('change covers');
      return;
    case 'lane.move':
      if (!scope.lanes.has(op.id)) throw outside();
      if (!onBoard) throw notHere('move the shared thought');
      if (op.boardId !== undefined && op.boardId !== scope.realBoardId) throw outside();
      return;
    case 'lane.delete':
      if (!onBoard && op.id === scope.boardId) throw notHere('delete the shared thought');
      return ofBoard(op.id);
    case 'lane.restore':
      return ofBoard(op.id);
    case 'note.create':
      if (!scope.lanes.has(op.laneId)) throw outside();
      // A picture lives in the owner's storage, which a link cannot fill.
      if (op.attachmentId !== undefined) throw notHere('add pictures');
      return;
    case 'note.move':
      await noteIn(op.id);
      if (!scope.lanes.has(op.laneId)) throw outside();
      return;
    case 'note.update':
      if (op.attachmentId !== undefined) throw notHere('change pictures');
      return noteIn(op.id);
    case 'note.delete':
    case 'note.restore':
      return noteIn(op.id);
    case 'link.create':
      return refsIn([op.from, op.to]);
    case 'link.update':
    case 'link.delete':
    case 'link.restore': {
      const l = await tx.selectFrom('links').select(['from_kind', 'from_id', 'to_kind', 'to_id']).where('workspace_id', '=', ws).where('id', '=', op.id).executeTakeFirst();
      if (!l) throw outside();
      return refsIn([
        { kind: l.from_kind, id: l.from_id },
        { kind: l.to_kind, id: l.to_id },
      ]);
    }
    case 'layout.set':
    case 'layout.remove':
      if (!viewIn(scope, op.viewKind, op.viewId)) throw outside();
      return refsIn(op.nodes.map((n) => ({ kind: n.kind, id: n.id })));
    default: {
      const never: never = op;
      throw notHere(`do ${(never as Op).type}`);
    }
  }
}

/**
 * Applies ops through an edit link, as the signed-in person who holds it: they appear in
 * the owner's change log under their own name. The answer carries only the effects the
 * link may see (a rename also rewrites [[wikilinks]] in notes outside it).
 */
export async function executeSharedOps(link: SharedLink, userId: string, envelopes: Envelope[], db: Db = getDb()): Promise<OpOutcome[]> {
  const refuse = (code: 'forbidden' | 'not_found', message: string) => envelopes.map(({ opId }): OpOutcome => ({ opId, status: 'rejected', error: { code, message } }));
  if (link.access !== 'edit') return refuse('forbidden', 'this link only shows');
  const person = isUuid(userId) ? await db.selectFrom('users').select('name').where('id', '=', userId).where('blocked_at', 'is', null).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
  if (!person) return refuse('forbidden', 'sign in to change this');
  const ws = link.workspaceId;
  const actorId = await withWorkspace(ws, (tx) => ensureActor(tx, ws, { kind: 'user', userId, label: person.name }), { db });
  const outcomes = await executeOps({ workspaceId: ws, actorId, actorKind: 'user', guard: (tx, op) => guardOp(tx, link, op) }, envelopes, db);
  if (!outcomes.some((o) => o.status === 'applied' && o.effects.length)) return outcomes;
  return withWorkspace(
    ws,
    async (tx) => {
      const scope = await scopeOf(tx, link);
      const all = outcomes.flatMap((o) => (o.status === 'applied' ? o.effects.map((after) => ({ after, before: null })) : []));
      const noteLane = await lanesOfNotes(tx, ws, notesNamed(all));
      return outcomes.map((o) => (o.status !== 'applied' ? o : { ...o, effects: scope ? cut(scope, o.effects.map((after) => ({ after, before: null })), noteLane).effects : [] }));
    },
    { db, snapshot: true },
  );
}

export type { ShareAccess, ShareTargetKind };
