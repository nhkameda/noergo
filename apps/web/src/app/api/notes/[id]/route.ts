import { getNote, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One note with its whole body and its links both ways (snapshots carry long bodies as excerpts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const { id } = await params;
  // Same answer as a note of another workspace: nothing to tell apart.
  if (!UUID.test(id)) return apiError('not_found', 'note not found');
  try {
    const { workspaceId } = await userContext(user.id);
    return NextResponse.json(await getNote(workspaceId, id.toLowerCase()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/notes/[id]');
  }
}
