import { sharedSnapshot } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure } from '@/lib/api';
import { cursorOf, sharedRequest } from '@/lib/shared';

export const dynamic = 'force-dynamic';

/** What a shared link opens, at one seq: the board or thought, and nothing else of the workspace. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const r = await sharedRequest(req, (await params).token, 'snapshot', 60);
  if ('error' in r) return r.error;
  try {
    const snap = await sharedSnapshot(r.link);
    if (!snap) return apiError('not_found', 'this link is not available');
    // The stream resumes only from a place the server handed out (core shareCursor).
    return NextResponse.json({ ...snap, cursor: cursorOf(r.link, snap.seq) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/shared/:token/snapshot');
  }
}
