import { inject } from 'vitest';
import { createDb, type Db } from '../src/db';
import { ensureActor } from '../src/actors';
import { withWorkspace } from '../src/db';
import { newId } from '../src/ids';
import type { ExecCtx } from '../src/ops/execute';
import { createPersonalWorkspace } from '../src/workspace';

export const testDb = inject('testDb');

let app: Db | undefined;
let jobs: Db | undefined;

/** Pools for the runtime role (RLS applies) and the jobs role (bypasses RLS). */
export function pools(): { app: Db; jobs: Db } {
  if (!testDb) throw new Error('no test database');
  app ??= createDb(testDb.appUrl, 8);
  jobs ??= createDb(testDb.jobsUrl, 2);
  return { app, jobs };
}

export async function closePools(): Promise<void> {
  await Promise.all([app?.destroy(), jobs?.destroy()]);
  app = jobs = undefined;
}

/** A user with a seeded personal workspace, and the context to write as that user. */
export async function newAccount(locale: 'pt-BR' | 'en' | 'zh-CN' = 'en'): Promise<{ userId: string; workspaceId: string; ctx: ExecCtx }> {
  const { app } = pools();
  const user = await app
    .insertInto('users')
    .values({ email: `${newId()}@example.test`, name: 'Test', locale })
    .returning(['id', 'name', 'locale'])
    .executeTakeFirstOrThrow();
  const workspaceId = await createPersonalWorkspace(user, app);
  const actorId = await withWorkspace(workspaceId, (tx) => ensureActor(tx, workspaceId, { kind: 'user', userId: user.id, label: user.name }), { db: app });
  return { userId: user.id, workspaceId, ctx: { workspaceId, actorId, actorKind: 'user' } };
}
