import type { TestProject } from 'vitest/node';
import { ADMIN_URL, createTestDatabase, dropTestDatabase, type TestDatabase } from './harness';

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDatabase | null;
  }
}

export default async function setup(project: TestProject) {
  let db: TestDatabase | null = null;
  try {
    db = await createTestDatabase();
  } catch (e) {
    // The isolation tests are the proof that one workspace cannot reach another, so a
    // missing database fails the run. Skipping takes an explicit opt-out, never in CI.
    if (process.env.CI || process.env.NOERGO_SKIP_DB_TESTS !== '1') {
      throw new Error(`PostgreSQL not reachable at ${ADMIN_URL} (${(e as Error).message}). Start it with: npm run db:dev (or set NOERGO_SKIP_DB_TESTS=1 to run only the pure tests)`, { cause: e });
    }
    console.warn(`\n[core] NOERGO_SKIP_DB_TESTS=1: database tests are skipped.\n`);
  }
  project.provide('testDb', db);
  return async () => {
    if (db) await dropTestDatabase(db);
  };
}
