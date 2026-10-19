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
  {
    // Sessions, codes, tokens and interactions of the agents' OAuth server, once expired.
    name: 'oauth-expired',
    everyMs: 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH gone AS (
          DELETE FROM oidc_payloads WHERE ctid IN (
            SELECT ctid FROM oidc_payloads WHERE expires_at < now() - interval '1 hour' LIMIT ${BATCH})
          RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      ),
  },
  {
    // Anyone may register a client (DCR); one that never became a connection in a day goes,
    // with its registration token, so registrations cannot pile up.
    name: 'oauth-unused-clients',
    everyMs: 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH stale AS (
            SELECT c.id FROM oidc_payloads c
            WHERE c.type = 'Client' AND c.id LIKE 'dcr\_%'
              AND (c.payload->>'client_id_issued_at')::bigint < extract(epoch FROM now() - interval '24 hours')
              AND NOT EXISTS (SELECT 1 FROM agent_connections a WHERE a.client_id = c.id)
            LIMIT ${BATCH}),
          tokens AS (
            DELETE FROM oidc_payloads t USING stale
            WHERE t.type = 'RegistrationAccessToken' AND t.payload->>'clientId' = stale.id),
          gone AS (
            DELETE FROM oidc_payloads c USING stale WHERE c.type = 'Client' AND c.id = stale.id RETURNING 1)
          SELECT count(*)::int AS n FROM gone`,
      ),
  },
  {
    // The security log keeps IPs and user agents: 90 days, then the row goes.
    name: 'security-events',
    everyMs: 6 * 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH gone AS (
          DELETE FROM security_events WHERE ctid IN (
            SELECT ctid FROM security_events WHERE last_at < now() - interval '90 days' LIMIT ${BATCH})
          RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      ),
  },
  {
    // What someone had on screen is useless after ten minutes (FOCUS_TTL_MS).
    name: 'user-focus',
    everyMs: 6 * 60 * 60_000,
    run: (db) =>
      deleteInBatches(
        db,
        () => sql<{ n: number }>`WITH gone AS (
          DELETE FROM user_focus WHERE ctid IN (
            SELECT ctid FROM user_focus WHERE at < now() - interval '1 day' LIMIT ${BATCH})
          RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      ),
  },
];
