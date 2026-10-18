import { rateLimit, search, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Full-text search over the signed-in user's notes (the ⌘K palette). */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const limited = rateLimit(`search:${user.id}`, { limit: 120, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many searches', { retryAfter: limited.retryAfter });
  const params = new URL(req.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 200);
  try {
    const { workspaceId } = await userContext(user.id);
    const hits = await search(workspaceId, q, { limit: 20, includeDone: params.get('done') === '1' });
    return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/search');
  }
}
