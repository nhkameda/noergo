import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/db/migrate';

/**
 * Each test run gets a fresh database, built from the same database.sql and migrations as
 * production, on the local dev cluster (npm run db:dev) or the CI service container.
 */

export const ADMIN_URL = process.env.NOERGO_TEST_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5434/postgres';

export interface TestDatabase {
  name: string;
  migratorUrl: string;
  appUrl: string;
  jobsUrl: string;
}

const sqlDir = fileURLToPath(new URL('../sql/', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

function urlAs(user: string, db: string): string {
  const u = new URL(ADMIN_URL);
  u.username = user;
  u.password = '';
  u.pathname = `/${db}`;
  return u.toString();
}

/** database.sql without its psql lines, split at \connect into statements. */
async function databaseStatements(name: string): Promise<{ cluster: string[]; database: string[] }> {
  const text = (await readFile(`${sqlDir}database.sql`, 'utf8')).replaceAll(':"dbname"', `"${name}"`);
  const [before, after = ''] = text.split(/^\\connect .*$/m);
  const statements = (part: string) =>
    part
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('\\'))
      .join('\n')
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
  return { cluster: statements(before ?? ''), database: statements(after) };
}

async function run(url: string, statements: string[]): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const s of statements) await c.query(s);
  } finally {
    await c.end();
  }
}

/**
 * A fresh database. With `upTo` (a migration number such as '0005'), only the migrations up
 * to it are applied, so a test can put rows in an older schema and then run the rest with
 * migrateTestDatabase.
 */
export async function createTestDatabase(upTo?: string): Promise<TestDatabase> {
  const name = `noergo_test_${randomBytes(4).toString('hex')}`;
  await run(ADMIN_URL, [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'noergo_migrator') THEN CREATE ROLE noergo_migrator LOGIN; END IF;
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'noergo_app') THEN CREATE ROLE noergo_app LOGIN NOBYPASSRLS; END IF;
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'noergo_jobs') THEN CREATE ROLE noergo_jobs LOGIN BYPASSRLS; END IF;
     END $$`,
  ]);
  const { cluster, database } = await databaseStatements(name);
  await run(ADMIN_URL, cluster);
  await run(urlAs(new URL(ADMIN_URL).username || 'postgres', name), database);
  const db = { name, migratorUrl: urlAs('noergo_migrator', name), appUrl: urlAs('noergo_app', name), jobsUrl: urlAs('noergo_jobs', name) };
  if (upTo === undefined) {
    await migrate(db.migratorUrl, migrationsDir, () => {});
    return db;
  }
  const dir = await mkdtemp(join(tmpdir(), 'noergo-migrations-'));
  try {
    for (const f of await readdir(migrationsDir)) if (f.endsWith('.sql') && f.slice(0, 4) <= upTo) await copyFile(join(migrationsDir, f), join(dir, f));
    await migrate(db.migratorUrl, dir, () => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return db;
}

/** Applies every migration not applied yet. */
export async function migrateTestDatabase(db: TestDatabase): Promise<string[]> {
  return migrate(db.migratorUrl, migrationsDir, () => {});
}

export async function dropTestDatabase(db: TestDatabase): Promise<void> {
  await run(ADMIN_URL, [`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`]);
}
