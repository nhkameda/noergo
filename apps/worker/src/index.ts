import { closeAll, getJobsDb, sql } from '@noergo/core/db';
import { JOBS, type Job } from './jobs';

/**
 * The background worker. Each job runs on its own timer; a session advisory lock per job
 * makes a second worker instance skip instead of running it twice.
 */
const db = getJobsDb();
const timers: NodeJS.Timeout[] = [];
let stopping = false;

async function tick(job: Job): Promise<void> {
  if (stopping) return;
  const started = Date.now();
  try {
    const n = await db.connection().execute(async (conn) => {
      const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_lock(hashtext(${`noergo:job:${job.name}`})) AS ok`.execute(conn);
      if (!rows[0]?.ok) return null;
      try {
        return await job.run(conn);
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtext(${`noergo:job:${job.name}`}))`.execute(conn);
      }
    });
    if (n) console.info(JSON.stringify({ job: job.name, affected: n, ms: Date.now() - started }));
  } catch (e) {
    console.error(JSON.stringify({ job: job.name, error: (e as Error).message }));
  }
}

for (const job of JOBS) {
  void tick(job);
  timers.push(setInterval(() => void tick(job), job.everyMs));
}
console.info(JSON.stringify({ worker: 'started', jobs: JOBS.map((j) => j.name) }));

async function shutdown(signal: string) {
  stopping = true;
  for (const t of timers) clearInterval(t);
  console.info(JSON.stringify({ worker: 'stopping', signal }));
  await closeAll();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
