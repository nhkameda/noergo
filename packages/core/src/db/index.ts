import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './types';

export type { Database } from './types';
export * from './types';
export { sql };

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

// int8 columns (seq, storage_bytes) fit comfortably in a double; parse them as numbers
// instead of the driver's default string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const instances = new Map<string, Db>();

/** A new pool. Services use getDb()/getJobsDb(); this is for tests and scripts. */
export function createDb(connectionString: string, max = 4): Db {
  const pool = new pg.Pool({
    connectionString,
    max,
    // A query stuck for longer than this is a bug or an attack; fail it instead of
    // letting it hold a pooled connection.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: process.env.NOERGO_SERVICE ?? 'noergo',
  });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

function from(envName: string, poolMax: number): Db {
  const url = process.env[envName];
  if (!url) throw new Error(`${envName} is not set`);
  let db = instances.get(envName);
  if (!db) {
    db = createDb(url, poolMax);
    instances.set(envName, db);
  }
  return db;
}

/**
 * The runtime connection (role noergo_app, subject to row-level security). Use it
 * directly only for identity and billing tables; content goes through withWorkspace().
 */
export function getDb(): Db {
  return from('DATABASE_URL', Number(process.env.DATABASE_POOL_MAX ?? 10));
}

/** Maintenance connection (role noergo_jobs, bypasses RLS). Worker only. */
export function getJobsDb(): Db {
  return from('DATABASE_JOBS_URL', 4);
}

export interface TxOptions {
  db?: Db;
  /** Repeatable-read, read-only transaction: one consistent picture (snapshots, exports). */
  snapshot?: boolean;
}

function begin(opts: TxOptions) {
  const t = (opts.db ?? getDb()).transaction();
  return opts.snapshot ? t.setIsolationLevel('repeatable read').setAccessMode('read only') : t;
}

/**
 * Runs fn in a transaction scoped to one workspace. Row-level security only lets the
 * transaction see and write rows of that workspace; without this call, content tables
 * return nothing. This is the second wall — the first is that every operation also
 * filters by workspace_id itself.
 */
export async function withWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  if (!UUID.test(workspaceId)) throw new Error('invalid workspace id');
  return begin(opts).execute(async (tx) => {
    await sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`.execute(tx);
    return fn(tx);
  });
}

/** Lets a transaction list the workspaces a user owns (workspace_lookup policy). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  if (!UUID.test(userId)) throw new Error('invalid user id');
  return begin(opts).execute(async (tx) => {
    await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(tx);
    return fn(tx);
  });
}

export async function closeAll(): Promise<void> {
  await Promise.all([...instances.values()].map((db) => db.destroy()));
  instances.clear();
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}
