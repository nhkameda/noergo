import { sharedNote } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiFailure } from '@/lib/api';
import { sharedRequest } from '@/lib/shared';

export const dynamic = 'force-dynamic';

/** One note of a shared link, whole, with only the links that stay inside the link. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const r = await sharedRequest(req, token, 'note', 240);
  if ('error' in r) return r.error;
  try {
    return NextResponse.json(await sharedNote(r.link, id.toLowerCase()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/shared/:token/notes/:id');
  }
}
