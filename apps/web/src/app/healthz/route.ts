import { getDb, sql } from '@noergo/core/db';

export const dynamic = 'force-dynamic';

/** Liveness and database reachability, for the reverse proxy and uptime checks. */
export async function GET() {
  try {
    await sql`SELECT 1`.execute(getDb());
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
