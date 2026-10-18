import { getDb, sql, withUser, withWorkspace, type Db, type Tx } from './db';
import type { Locale } from './db/types';
import { ensureActor } from './actors';
import { newId } from './ids';
import { applyOp, type OpCtx } from './ops/apply';
import { SEED } from './seed';

/**
 * Creates the personal workspace of a new user, with its owner membership, the user's
 * actor and a first board in their language. The seed is written with the same domain
 * operations as everything else, but outside the change log: it is part of the state at
 * seq 0.
 */
export async function createPersonalWorkspace(user: WorkspaceOwner, db: Db = getDb()): Promise<string> {
  return db.transaction().execute((tx) => createPersonalWorkspaceIn(tx, user));
}

export interface WorkspaceOwner {
  id: string;
  name: string;
  locale: Locale;
}

/**
 * createPersonalWorkspace inside a transaction the caller already holds (sign-in creates
 * the user, the account and the workspace atomically). Leaves app.workspace_id set to
 * the new workspace for the rest of that transaction.
 */
export async function createPersonalWorkspaceIn(tx: Tx, user: WorkspaceOwner): Promise<string> {
  const workspaceId = newId();
  await sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`.execute(tx);
  const plan = await tx.selectFrom('plans').select('storage_quota_bytes').where('id', '=', 'free').executeTakeFirstOrThrow();
  await tx.insertInto('workspaces').values({ id: workspaceId, owner_id: user.id, name: user.name.slice(0, 200), storage_quota_bytes: plan.storage_quota_bytes }).execute();
  await tx.insertInto('workspace_members').values({ workspace_id: workspaceId, user_id: user.id, role: 'owner' }).execute();
  await ensureActor(tx, workspaceId, { kind: 'user', userId: user.id, label: user.name });
  const system = await ensureActor(tx, workspaceId, { kind: 'system', label: 'noergo' });

  const ctx: OpCtx = { workspaceId, actorId: system, actorKind: 'system' };
  const content = SEED[user.locale];
  const boardId = newId();
  await applyOp(tx, ctx, { type: 'board.create', id: boardId, title: content.board });
  let inbox: string | null = null;
  for (const lane of content.lanes) {
    const laneId = newId();
    await applyOp(tx, ctx, { type: 'lane.create', id: laneId, boardId, title: lane.title });
    if (lane.inbox) inbox = laneId;
    for (const n of lane.notes) {
      await applyOp(tx, ctx, { type: 'note.create', id: newId(), laneId, title: n.title, body: n.body, tags: n.tags, place: { at: 'bottom' } });
    }
  }
  await tx.updateTable('workspaces').set({ inbox_lane_id: inbox }).where('id', '=', workspaceId).execute();
  return workspaceId;
}

/** The workspace a user works in. Today every user has exactly one, their own. */
export async function personalWorkspaceId(userId: string, db: Db = getDb()): Promise<string | null> {
  return withUser(
    userId,
    async (tx) => {
      const row = await tx.selectFrom('workspaces').select('id').where('owner_id', '=', userId).orderBy('created_at').limit(1).executeTakeFirst();
      return row?.id ?? null;
    },
    { db },
  );
}

/**
 * The column where notes land when none is given (quick capture, agents): the
 * configured inbox while it exists, else the first column of the first board.
 */
export async function inboxLaneId(workspaceId: string, db: Db = getDb()): Promise<string | null> {
  return withWorkspace(
    workspaceId,
    async (tx) => {
      const ws = await tx.selectFrom('workspaces').select('inbox_lane_id').where('id', '=', workspaceId).executeTakeFirst();
      if (ws?.inbox_lane_id) {
        const lane = await tx.selectFrom('lanes').select('id').where('workspace_id', '=', workspaceId).where('id', '=', ws.inbox_lane_id).where('deleted_at', 'is', null).executeTakeFirst();
        if (lane) return lane.id;
      }
      const first = await tx
        .selectFrom('lanes as l')
        .innerJoin('boards as b', (j) => j.onRef('b.id', '=', 'l.board_id').onRef('b.workspace_id', '=', 'l.workspace_id'))
        .select('l.id')
        .where('l.workspace_id', '=', workspaceId)
        .where('l.deleted_at', 'is', null)
        .where('b.deleted_at', 'is', null)
        .orderBy('b.position')
        .orderBy('l.position')
        .limit(1)
        .executeTakeFirst();
      return first?.id ?? null;
    },
    { db, snapshot: true },
  );
}
