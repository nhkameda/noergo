import { rateLimit, revokeShare, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Turns a link off. Whoever holds it sees "not available" from then on, live streams included. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const limited = rateLimit(`shares:${user.id}`, { limit: 30, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many requests', { retryAfter: limited.retryAfter });
  try {
    const { workspaceId } = await userContext(user.id);
    await revokeShare(workspaceId, (await params).id.toLowerCase());
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'DELETE /api/shares/:id');
  }
}
