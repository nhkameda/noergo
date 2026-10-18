import { snapshot, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Everything in the workspace at one seq; the live stream continues from there. */
export async function GET() {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  try {
    const { workspaceId } = await userContext(user.id);
    return NextResponse.json(await snapshot(workspaceId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/snapshot');
  }
}
