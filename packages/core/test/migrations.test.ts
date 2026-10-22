import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDatabase, dropTestDatabase, migrateTestDatabase, type TestDatabase } from './harness';
import { testDb } from './fixtures';

/** Data migrations, run against rows written in the schema before them. */
describe.skipIf(!testDb)('migrations', () => {
  const made: TestDatabase[] = [];
  afterAll(async () => {
    for (const db of made) await dropTestDatabase(db);
  });

  async function query<T extends pg.QueryResultRow>(url: string, text: string, values: unknown[] = []): Promise<T[]> {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      return (await c.query<T>(text, values)).rows;
    } finally {
      await c.end();
    }
  }

  it('hands the workspaces that existed before 0006 the instance quota, past row-level security', async () => {
    const db = await createTestDatabase('0005');
    made.push(db);
    // The worker's role bypasses row-level security, so these rows exist whatever the policy.
    const [u] = await query<{ id: string }>(db.jobsUrl, `INSERT INTO users (email) VALUES ('before@example.test') RETURNING id`);
    await query(db.jobsUrl, `INSERT INTO workspaces (owner_id, storage_quota_bytes) VALUES ($1, 262144000), ($1, 1048576)`, [u!.id]);

    await migrateTestDatabase(db);

    const rows = await query<{ storage_quota_bytes: unknown }>(db.jobsUrl, 'SELECT storage_quota_bytes FROM workspaces');
    expect(rows).toEqual([{ storage_quota_bytes: null }, { storage_quota_bytes: null }]);
    // And the policy is back in force for the owner.
    const [t] = await query<{ relforcerowsecurity: boolean }>(db.jobsUrl, `SELECT relforcerowsecurity FROM pg_class WHERE oid = 'workspaces'::regclass`);
    expect(t!.relforcerowsecurity).toBe(true);
  });

  it('leaves the mind maps someone arranged before 0010 free, past row-level security, and lays out the rest', async () => {
    const db = await createTestDatabase('0009');
    made.push(db);
    const [u] = await query<{ id: string }>(db.jobsUrl, `INSERT INTO users (email) VALUES ('maps@example.test') RETURNING id`);
    const [w] = await query<{ id: string }>(db.jobsUrl, `INSERT INTO workspaces (owner_id) VALUES ($1) RETURNING id`, [u!.id]);
    const [b] = await query<{ id: string }>(db.jobsUrl, `INSERT INTO boards (workspace_id, title, position) VALUES ($1, 'b', 'a0') RETURNING id`, [w!.id]);
    // Arranged: an idea with its spot. Centre moved only, or a spot kept for an idea in the trash: never arranged.
    const lanes = await query<{ id: string; title: string }>(db.jobsUrl, `INSERT INTO lanes (workspace_id, board_id, title, position) VALUES ($1, $2, 'arranged', 'a0'), ($1, $2, 'centre', 'a1'), ($1, $2, 'trashed', 'a2'), ($1, $2, 'untouched', 'a3') RETURNING id, title`, [w!.id, b!.id]);
    const lane = Object.fromEntries(lanes.map((l) => [l.title, l.id]));
    const notes = await query<{ id: string; lane_id: string }>(db.jobsUrl, `INSERT INTO notes (workspace_id, lane_id, position, title, deleted_at) VALUES ($1, $2, 'a0', 'kept', NULL), ($1, $3, 'a0', 'gone', now()), ($1, $4, 'a0', 'plain', NULL) RETURNING id, lane_id`, [w!.id, lane.arranged, lane.trashed, lane.untouched]);
    const spot = `INSERT INTO node_layouts (workspace_id, view_kind, view_id, node_kind, node_id, x, y) VALUES ($1, 'lane_map', $2, $3, $4, 10, 20)`;
    await query(db.jobsUrl, spot, [w!.id, lane.arranged, 'note', notes.find((n) => n.lane_id === lane.arranged)!.id]);
    await query(db.jobsUrl, spot, [w!.id, lane.centre, 'lane', lane.centre]);
    await query(db.jobsUrl, spot, [w!.id, lane.trashed, 'note', notes.find((n) => n.lane_id === lane.trashed)!.id]);

    await migrateTestDatabase(db);

    const rows = await query<{ title: string; map_layout: string }>(db.jobsUrl, 'SELECT title, map_layout FROM lanes ORDER BY position');
    expect(rows).toEqual([
      { title: 'arranged', map_layout: 'free' },
      { title: 'centre', map_layout: 'balanced' },
      { title: 'trashed', map_layout: 'balanced' },
      { title: 'untouched', map_layout: 'balanced' },
    ]);
    const forced = await query<{ relname: string; relforcerowsecurity: boolean }>(db.jobsUrl, `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('lanes', 'notes', 'node_layouts') ORDER BY relname`);
    expect(forced.every((t) => t.relforcerowsecurity)).toBe(true);
    expect(forced).toHaveLength(3);
  });
});
