import { sql, withWorkspace, type Db, type Tx } from './db';
import type { ActorKind } from './db/types';
import { boardDto, excerptOf, laneDto, layoutDto, linkDto, noteDto, type BoardDto, type Effect, type LaneDto, type LayoutDto, type LinkDto, type NoteDto } from './dto';
import { notFound } from './errors';
import { LIMITS } from './limits';
import type { ChangeEffect } from './ops/apply';

export interface Snapshot {
  seq: number;
  inboxLaneId: string | null;
  boards: BoardDto[];
  lanes: LaneDto[];
  notes: NoteDto[];
  links: LinkDto[];
  layouts: LayoutDto[];
}

/**
 * Everything a browser needs to draw the workspace, as of one seq. Taken in a
 * repeatable-read transaction so the content and the seq agree: the live stream then
 * resumes from exactly this seq. Long bodies travel as excerpts.
 */
export async function snapshot(workspaceId: string, db?: Db): Promise<Snapshot> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const ws = await tx.selectFrom('workspaces').select(['seq', 'inbox_lane_id']).where('id', '=', workspaceId).executeTakeFirst();
      if (!ws) throw notFound('workspace');
      const [boards, lanes, notes, links, layouts] = await Promise.all([
        tx.selectFrom('boards').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute(),
        tx.selectFrom('lanes').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute(),
        tx.selectFrom('notes').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('lane_id').orderBy('position').orderBy('id').execute(),
        tx.selectFrom('links').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).execute(),
        tx.selectFrom('node_layouts').selectAll().where('workspace_id', '=', workspaceId).execute(),
      ]);
      return {
        seq: ws.seq,
        inboxLaneId: ws.inbox_lane_id,
        boards: boards.map(boardDto),
        lanes: lanes.map(laneDto),
        notes: notes.map((n) => noteDto(n)),
        links: links.map(linkDto),
        layouts: layouts.map(layoutDto),
      };
    },
    { db, snapshot: true },
  );
}

export interface NoteDetail {
  note: NoteDto;
  lane: { id: string; title: string };
  board: { id: string; title: string };
  /** Links leaving this note, with the title of the other end. */
  outgoing: Array<LinkDto & { otherTitle: string }>;
  /** Links arriving at this note (backlinks). */
  incoming: Array<LinkDto & { otherTitle: string }>;
}

async function titlesOf(tx: Tx, workspaceId: string, refs: Array<{ kind: string; id: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [kind, table] of [['note', 'notes'], ['lane', 'lanes'], ['board', 'boards']] as const) {
    const ids = [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
    if (!ids.length) continue;
    const rows = await tx.selectFrom(table).select(['id', 'title']).where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).where('id', 'in', ids).execute();
    for (const r of rows) out.set(`${kind}:${r.id}`, r.title);
  }
  return out;
}

export async function getNote(workspaceId: string, noteId: string, db?: Db): Promise<NoteDetail> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const n = await tx.selectFrom('notes').selectAll().where('workspace_id', '=', workspaceId).where('id', '=', noteId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!n) throw notFound('note');
      const lane = await tx.selectFrom('lanes').select(['id', 'title', 'board_id']).where('workspace_id', '=', workspaceId).where('id', '=', n.lane_id).executeTakeFirstOrThrow();
      const board = await tx.selectFrom('boards').select(['id', 'title']).where('workspace_id', '=', workspaceId).where('id', '=', lane.board_id).executeTakeFirstOrThrow();
      const links = await tx
        .selectFrom('links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('deleted_at', 'is', null)
        .where((eb) => eb.or([eb.and([eb('from_kind', '=', 'note'), eb('from_id', '=', noteId)]), eb.and([eb('to_kind', '=', 'note'), eb('to_id', '=', noteId)])]))
        .limit(1000)
        .execute();
      const others = links.map((l) => (l.from_kind === 'note' && l.from_id === noteId ? { kind: l.to_kind, id: l.to_id } : { kind: l.from_kind, id: l.from_id }));
      const titles = await titlesOf(tx, workspaceId, others);
      const outgoing: NoteDetail['outgoing'] = [];
      const incoming: NoteDetail['incoming'] = [];
      links.forEach((l, i) => {
        const other = others[i]!;
        const otherTitle = titles.get(`${other.kind}:${other.id}`);
        if (otherTitle === undefined) return; // the other end is in the trash
        (l.from_kind === 'note' && l.from_id === noteId ? outgoing : incoming).push({ ...linkDto(l), otherTitle });
      });
      return { note: noteDto(n, { fullBody: true }), lane: { id: lane.id, title: lane.title }, board, outgoing, incoming };
    },
    { db, snapshot: true },
  );
}

export interface SearchHit {
  id: string;
  title: string;
  excerpt: string;
  laneId: string;
  tags: string[];
  doneAt: string | null;
  updatedAt: string;
}

export interface SearchOptions {
  limit?: number;
  boardId?: string;
  tags?: string[];
  includeDone?: boolean;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Full-text search over title (A), tags (B) and body (C), accent-insensitive, plus
 * trigram similarity on titles for typos. Chinese and Japanese have no spaces between
 * words, so the 'simple' parser cannot split them; those queries, and very short ones,
 * fall back to a substring match inside the workspace.
 */
export async function search(workspaceId: string, query: string, opts: SearchOptions = {}, db?: Db): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 200);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), LIMITS.searchResults);
  if (!q && !opts.tags?.length) return [];
  return withWorkspace(
    workspaceId,
    async (tx) => {
      let base = tx
        .selectFrom('notes as n')
        .select(['n.id', 'n.title', 'n.body', 'n.lane_id', 'n.tags', 'n.done_at', 'n.updated_at'])
        .where('n.workspace_id', '=', workspaceId)
        .where('n.deleted_at', 'is', null);
      if (opts.boardId) {
        const boardId = opts.boardId;
        base = base.where('n.lane_id', 'in', (eb) =>
          eb.selectFrom('lanes').select('id').where('workspace_id', '=', workspaceId).where('board_id', '=', boardId).where('deleted_at', 'is', null),
        );
      }
      if (opts.tags?.length) base = base.where(sql<boolean>`n.tags @> ${opts.tags}::text[]`);
      if (!opts.includeDone) base = base.where('n.done_at', 'is', null);

      let rows;
      if (!q) {
        rows = await base.orderBy('n.updated_at', 'desc').limit(limit).execute();
      } else if (q.length < 3 || CJK.test(q)) {
        const pattern = `%${likeEscape(q)}%`;
        rows = await base
          .where((eb) => eb.or([sql<boolean>`noergo_unaccent(n.title) ILIKE noergo_unaccent(${pattern})`, sql<boolean>`noergo_unaccent(n.body) ILIKE noergo_unaccent(${pattern})`]))
          .orderBy(sql`(noergo_unaccent(n.title) ILIKE noergo_unaccent(${pattern}))`, 'desc')
          .orderBy('n.updated_at', 'desc')
          .limit(limit)
          .execute();
      } else {
        const tsq = sql`websearch_to_tsquery('simple', noergo_unaccent(${q}))`;
        rows = await base
          .where((eb) => eb.or([sql<boolean>`n.fts @@ ${tsq}`, sql<boolean>`n.title % ${q}`]))
          .orderBy(sql`ts_rank_cd(n.fts, ${tsq}) + similarity(n.title, ${q})`, 'desc')
          .orderBy('n.updated_at', 'desc')
          .limit(limit)
          .execute();
      }
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        excerpt: excerptOf(r.body),
        laneId: r.lane_id,
        tags: r.tags,
        doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    },
    { db, snapshot: true },
  );
}

export interface ChangeRow {
  seq: number;
  op: string;
  actorId: string | null;
  /** Who made it, so the screen can show an agent at work (its halo, "Grok is writing…"). */
  actor: { kind: ActorKind; label: string } | null;
  createdAt: string;
  effects: Effect[];
}

export type ChangesPage = { reset: true } | { reset: false; seq: number; changes: ChangeRow[]; more: boolean };

/**
 * Changes after `since`, for a live stream resuming with Last-Event-ID. When the client
 * is too far behind (the change was purged or is older than the resume window) it must
 * reload a snapshot instead.
 */
export async function changesSince(workspaceId: string, since: number, limit = 500, db?: Db): Promise<ChangesPage> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const ws = await tx.selectFrom('workspaces').select('seq').where('id', '=', workspaceId).executeTakeFirst();
      if (!ws) throw notFound('workspace');
      if (since > ws.seq) return { reset: true };
      if (since === ws.seq) return { reset: false, seq: ws.seq, changes: [], more: false };
      const rows = await tx
        .selectFrom('changes as c')
        .leftJoin('actors as a', (j) => j.onRef('a.id', '=', 'c.actor_id').onRef('a.workspace_id', '=', 'c.workspace_id'))
        .select(['c.seq', 'c.op', 'c.actor_id', 'c.created_at', 'c.effects', 'a.kind', 'a.label'])
        .where('c.workspace_id', '=', workspaceId)
        .where('c.seq', '>', since)
        .orderBy('c.seq')
        .limit(limit)
        .execute();
      const first = rows[0];
      const windowStart = Date.now() - LIMITS.changesResumeDays * 86_400_000;
      if (!first || first.seq !== since + 1 || new Date(first.created_at).getTime() < windowStart) return { reset: true };
      const changes = rows.map((r) => ({
        seq: r.seq,
        op: r.op,
        actorId: r.actor_id,
        actor: r.kind ? { kind: r.kind, label: r.label ?? '' } : null,
        createdAt: new Date(r.created_at).toISOString(),
        effects: (r.effects as ChangeEffect[]).map((e) => e.after),
      }));
      return { reset: false, seq: changes[changes.length - 1]!.seq, changes, more: rows.length === limit };
    },
    { db, snapshot: true },
  );
}

export interface ActivityItem {
  seq: number;
  op: string;
  entityKind: string;
  entityId: string;
  actor: { id: string | null; kind: ActorKind | null; label: string };
  createdAt: string;
  revertedBySeq: number | null;
  /** Short, human description material: the title of the entity after the change. */
  title: string;
}

export interface ActivityOptions {
  before?: number;
  limit?: number;
  actorKind?: ActorKind;
  entityId?: string;
}

/** The activity feed, newest first: who changed what. Agents' changes are told apart by actor kind. */
export async function activity(workspaceId: string, opts: ActivityOptions = {}, db?: Db): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withWorkspace(
    workspaceId,
    async (tx) => {
      let q = tx
        .selectFrom('changes as c')
        .leftJoin('actors as a', (j) => j.onRef('a.id', '=', 'c.actor_id').onRef('a.workspace_id', '=', 'c.workspace_id'))
        .select(['c.seq', 'c.op', 'c.entity_kind', 'c.entity_id', 'c.actor_id', 'c.created_at', 'c.reverted_by_seq', 'c.effects', 'a.kind', 'a.label'])
        .where('c.workspace_id', '=', workspaceId)
        .orderBy('c.seq', 'desc')
        .limit(limit);
      if (opts.before !== undefined) q = q.where('c.seq', '<', opts.before);
      if (opts.actorKind) q = q.where('a.kind', '=', opts.actorKind);
      if (opts.entityId) q = q.where('c.entity_id', '=', opts.entityId);
      const rows = await q.execute();
      return rows.map((r) => {
        const first = (r.effects as ChangeEffect[])[0]?.after;
        const title = first && 'title' in first.data ? String(first.data.title) : '';
        return {
          seq: r.seq,
          op: r.op,
          entityKind: r.entity_kind,
          entityId: r.entity_id,
          actor: { id: r.actor_id, kind: r.kind ?? null, label: r.label ?? '' },
          createdAt: new Date(r.created_at).toISOString(),
          revertedBySeq: r.reverted_by_seq,
          title,
        };
      });
    },
    { db, snapshot: true },
  );
}

export interface BoardSummary extends BoardDto {
  columns: number;
  openNotes: number;
}

export async function listBoards(workspaceId: string, db?: Db): Promise<BoardSummary[]> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const boards = await tx.selectFrom('boards').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute();
      const counts = await tx
        .selectFrom('lanes as l')
        .leftJoin('notes as n', (j) => j.onRef('n.lane_id', '=', 'l.id').onRef('n.workspace_id', '=', 'l.workspace_id').on('n.deleted_at', 'is', null).on('n.done_at', 'is', null))
        .select(['l.board_id', (eb) => eb.fn.count<number>('l.id').distinct().as('columns'), (eb) => eb.fn.count<number>('n.id').as('open')])
        .where('l.workspace_id', '=', workspaceId)
        .where('l.deleted_at', 'is', null)
        .groupBy('l.board_id')
        .execute();
      const byBoard = new Map(counts.map((c) => [c.board_id, c]));
      return boards.map((b) => ({ ...boardDto(b), columns: Number(byBoard.get(b.id)?.columns ?? 0), openNotes: Number(byBoard.get(b.id)?.open ?? 0) }));
    },
    { db, snapshot: true },
  );
}

export interface BoardDetail {
  board: BoardDto;
  columns: Array<LaneDto & { notes: NoteDto[]; total: number }>;
}

/** One board with its columns and notes, for agents. `notesPerColumn` bounds the size of the answer. */
export async function getBoard(workspaceId: string, boardId: string, opts: { notesPerColumn?: number; includeDone?: boolean } = {}, db?: Db): Promise<BoardDetail> {
  const per = Math.min(Math.max(opts.notesPerColumn ?? 50, 1), 200);
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const b = await tx.selectFrom('boards').selectAll().where('workspace_id', '=', workspaceId).where('id', '=', boardId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!b) throw notFound('board');
      const lanes = await tx.selectFrom('lanes').selectAll().where('workspace_id', '=', workspaceId).where('board_id', '=', boardId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute();
      const columns: BoardDetail['columns'] = [];
      for (const l of lanes) {
        let q = tx.selectFrom('notes').selectAll().where('workspace_id', '=', workspaceId).where('lane_id', '=', l.id).where('deleted_at', 'is', null);
        if (!opts.includeDone) q = q.where('done_at', 'is', null);
        const notes = await q.orderBy('position').orderBy('id').limit(per).execute();
        let cq = tx.selectFrom('notes').select((eb) => eb.fn.countAll<number>().as('n')).where('workspace_id', '=', workspaceId).where('lane_id', '=', l.id).where('deleted_at', 'is', null);
        if (!opts.includeDone) cq = cq.where('done_at', 'is', null);
        const total = Number((await cq.executeTakeFirstOrThrow()).n);
        columns.push({ ...laneDto(l), notes: notes.map((n) => noteDto(n)), total });
      }
      return { board: boardDto(b), columns };
    },
    { db, snapshot: true },
  );
}

export interface OutlineBoard extends BoardDto {
  thoughts: Array<{ id: string; title: string; description: string; color: string | null; url: string | null; ideas: number; updatedAt: string }>;
}

/** Every board with its thoughts (columns) and how many open ideas each holds: the map of the workspace for an agent. */
export async function outline(workspaceId: string, db?: Db): Promise<OutlineBoard[]> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const boards = await tx.selectFrom('boards').selectAll().where('workspace_id', '=', workspaceId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').execute();
      const lanes = await tx
        .selectFrom('lanes as l')
        .leftJoin('notes as n', (j) => j.onRef('n.lane_id', '=', 'l.id').onRef('n.workspace_id', '=', 'l.workspace_id').on('n.deleted_at', 'is', null).on('n.done_at', 'is', null))
        .select(['l.id', 'l.board_id', 'l.title', 'l.description', 'l.color', 'l.url', 'l.position', 'l.updated_at', (eb) => eb.fn.count<number>('n.id').as('ideas')])
        .where('l.workspace_id', '=', workspaceId)
        .where('l.deleted_at', 'is', null)
        .groupBy(['l.id', 'l.board_id', 'l.title', 'l.description', 'l.color', 'l.url', 'l.position', 'l.updated_at'])
        .orderBy('l.position')
        .orderBy('l.id')
        .execute();
      return boards.map((b) => ({
        ...boardDto(b),
        thoughts: lanes.filter((l) => l.board_id === b.id).map((l) => ({ id: l.id, title: l.title, description: l.description, color: l.color, url: l.url, ideas: Number(l.ideas), updatedAt: new Date(l.updated_at).toISOString() })),
      }));
    },
    { db, snapshot: true },
  );
}

export interface ThoughtDetail {
  thought: LaneDto;
  board: { id: string; title: string };
  /** The ideas (notes) of the thought, in column order, done ones included. */
  ideas: NoteDto[];
  /** Links among the thought and its ideas: the edges of its mind map. */
  links: LinkDto[];
  /** Where each node sits on the thought's map, when someone placed it. */
  layout: LayoutDto[];
}

/** A thought as its mind map: the centre, every idea, the links between them and their positions. */
export async function thoughtDetail(workspaceId: string, laneId: string, db?: Db): Promise<ThoughtDetail> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const l = await tx.selectFrom('lanes').selectAll().where('workspace_id', '=', workspaceId).where('id', '=', laneId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!l) throw notFound('thought');
      const board = await tx.selectFrom('boards').select(['id', 'title']).where('workspace_id', '=', workspaceId).where('id', '=', l.board_id).executeTakeFirstOrThrow();
      const notes = await tx.selectFrom('notes').selectAll().where('workspace_id', '=', workspaceId).where('lane_id', '=', laneId).where('deleted_at', 'is', null).orderBy('position').orderBy('id').limit(LIMITS.thoughtIdeas).execute();
      const ids = [laneId, ...notes.map((n) => n.id)];
      const links = await tx
        .selectFrom('links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('deleted_at', 'is', null)
        .where('from_kind', 'in', ['lane', 'note'])
        .where('to_kind', 'in', ['lane', 'note'])
        .where('from_id', 'in', ids)
        .where('to_id', 'in', ids)
        .execute();
      const layout = await tx.selectFrom('node_layouts').selectAll().where('workspace_id', '=', workspaceId).where('view_kind', '=', 'lane_map').where('view_id', '=', laneId).execute();
      return { thought: laneDto(l), board, ideas: notes.map((n) => noteDto(n)), links: links.map(linkDto), layout: layout.map(layoutDto) };
    },
    { db, snapshot: true },
  );
}

/** What an id names in this workspace (agents pass bare ids), or null when it is nothing live here. */
export async function nodeKindOf(workspaceId: string, id: string, db?: Db): Promise<'note' | 'lane' | 'board' | null> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      for (const [kind, table] of [['note', 'notes'], ['lane', 'lanes'], ['board', 'boards']] as const) {
        const hit = await tx.selectFrom(table).select('id').where('workspace_id', '=', workspaceId).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
        if (hit) return kind;
      }
      return null;
    },
    { db, snapshot: true },
  );
}

/** The manual link between two nodes, in either direction, if there is one. */
export async function linkBetween(workspaceId: string, a: { kind: string; id: string }, b: { kind: string; id: string }, db?: Db): Promise<LinkDto | null> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const row = await tx
        .selectFrom('links')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('deleted_at', 'is', null)
        .where('origin', '=', 'manual')
        .where((eb) =>
          eb.or([
            eb.and([eb('from_kind', '=', a.kind as 'note'), eb('from_id', '=', a.id), eb('to_kind', '=', b.kind as 'note'), eb('to_id', '=', b.id)]),
            eb.and([eb('from_kind', '=', b.kind as 'note'), eb('from_id', '=', b.id), eb('to_kind', '=', a.kind as 'note'), eb('to_id', '=', a.id)]),
          ]),
        )
        .executeTakeFirst();
      return row ? linkDto(row) : null;
    },
    { db, snapshot: true },
  );
}
