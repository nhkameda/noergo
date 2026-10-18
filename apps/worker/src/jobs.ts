import { sql, type Db } from '@noergo/core/db';
import { LIMITS } from '@noergo/core/limits';

/**
 * Maintenance across workspaces. Runs with the jobs role, the only one that bypasses
 * row-level security, so every statement here names its own bounds. Deletes go in small
 * batches to keep locks short.
 */
export interface Job {
  name: string;
  everyMs: number;
  run(db: Db): Promise<number>;
}

const BATCH = 5_000;

async function deleteInBatches(db: Db, statement: () => ReturnType<typeof sql<{ n: number }>>): Promise<number> {
  let total = 0;
  for (;;) {
    const { rows } = await statement().execute(db);
    const n = Number(rows[0]?.n ?? 0);
    total += n;
    if (n < BATCH) return total;
  }
}

export const JOBS: Job[] = [
  {
    name: 'op-receipts',
    everyMs: 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH gone AS (
          DELETE FROM op_receipts WHERE ctid IN (
            SELECT ctid FROM op_receipts WHERE created_at < now() - interval '48 hours' LIMIT ${BATCH})
          RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      ),
  },
  {
    name: 'change-log',
    everyMs: 6 * 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH gone AS (
          DELETE FROM changes WHERE ctid IN (
            SELECT ctid FROM changes WHERE created_at < now() - make_interval(days => ${LIMITS.changesRetentionDays}) LIMIT ${BATCH})
          RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      ),
  },
];
