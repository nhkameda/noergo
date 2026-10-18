import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { listenForChanges } from '../src/db/listen';
import { newId } from '../src/ids';
import { executeOps } from '../src/ops/execute';
import { closePools, newAccount, pools, testDb } from './fixtures';
import { ADMIN_URL } from './harness';

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!testDb)('change listener', () => {
  afterAll(closePools);

  it('wakes on every committed change and resyncs after losing its connection', async () => {
    const { workspaceId, ctx } = await newAccount();
    const seen: number[] = [];
    let resyncs = 0;
    const listener = listenForChanges({
      connectionString: testDb!.appUrl,
      onChange: (ws, seq) => ws === workspaceId && seen.push(seq),
      onResync: () => resyncs++,
    });
    try {
      await until(() => listener.connected);
      const board = () => ({ opId: newId(), op: { type: 'board.create' as const, id: newId(), title: 'b' } });
      await executeOps(ctx, [board(), board()], pools().app);
      await until(() => seen.length === 2);
      expect(seen).toEqual([1, 2]);

      // What a database restart or a dropped network does to the connection.
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE '%:listen' AND datname = $1`, [testDb!.name]);
      await admin.end();
      await until(() => resyncs === 2);
      await executeOps(ctx, [board()], pools().app);
      await until(() => seen.length === 3);
      expect(seen[2]).toBe(3);
    } finally {
      await listener.close();
    }
  });
});
