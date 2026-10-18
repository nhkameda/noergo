import type { Tx } from './db';

/**
 * Who made a change, as recorded in created_by/updated_by and the change log: the person,
 * one of their agent connections, a personal token, or the system. One actor row per
 * (workspace, subject), created on first use.
 */
export type ActorSubject =
  | { kind: 'user'; userId: string; label: string }
  | { kind: 'agent'; connectionId: string; label: string }
  | { kind: 'token'; tokenId: string; label: string }
  | { kind: 'system'; label?: string };

export async function ensureActor(tx: Tx, workspaceId: string, s: ActorSubject): Promise<string> {
  const values = {
    workspace_id: workspaceId,
    kind: s.kind,
    user_id: s.kind === 'user' ? s.userId : null,
    connection_id: s.kind === 'agent' ? s.connectionId : null,
    token_id: s.kind === 'token' ? s.tokenId : null,
    label: (s.label ?? 'noergo').slice(0, 200),
  };
  let q = tx.selectFrom('actors').select(['id', 'label']).where('workspace_id', '=', workspaceId).where('kind', '=', s.kind);
  if (s.kind === 'user') q = q.where('user_id', '=', s.userId);
  if (s.kind === 'agent') q = q.where('connection_id', '=', s.connectionId);
  if (s.kind === 'token') q = q.where('token_id', '=', s.tokenId);

  const existing = await q.executeTakeFirst();
  if (existing) {
    if (s.label !== undefined && existing.label !== values.label) {
      await tx.updateTable('actors').set({ label: values.label }).where('id', '=', existing.id).where('workspace_id', '=', workspaceId).execute();
    }
    return existing.id;
  }
  // A concurrent first use may insert the same actor; the partial unique indexes keep
  // one row and the re-select below finds it.
  await tx.insertInto('actors').values(values).onConflict((oc) => oc.doNothing()).execute();
  return (await q.executeTakeFirstOrThrow()).id;
}
