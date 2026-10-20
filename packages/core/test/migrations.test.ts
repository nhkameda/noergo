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
});
