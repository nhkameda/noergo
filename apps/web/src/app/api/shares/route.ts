import { createShare, listShares, rateLimit, userContext, type ShareDto } from '@noergo/core';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { readBoundedText } from '@/lib/bounded-body';
import { shareUrl } from '@/lib/shared';

export const dynamic = 'force-dynamic';

const target = z.object({ kind: z.enum(['board', 'lane']), id: z.uuid() });
const create = target.extend({ access: z.enum(['view', 'edit']) });

const withUrl = (s: ShareDto) => ({ ...s, url: shareUrl(s.id) });

/** The live links of one of the signed-in person's boards or thoughts: ?kind=board|lane&id=. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const p = new URL(req.url).searchParams;
  const t = target.safeParse({ kind: p.get('kind'), id: p.get('id')?.toLowerCase() });
  if (!t.success) return apiError('invalid', 'kind is board or lane, id a uuid');
  try {
    const { workspaceId } = await userContext(user.id);
    const shares = await listShares(workspaceId, t.data);
    return NextResponse.json({ shares: shares.map(withUrl) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'GET /api/shares');
  }
}

/** Shares a board or thought: { kind, id, access }. The same access again answers the same link. */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const limited = rateLimit(`shares:${user.id}`, { limit: 30, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many requests', { retryAfter: limited.retryAfter });
  const text = await readBoundedText(req, 4096);
  if (text === null) return apiError('too_large', 'request body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError('invalid', 'body is not JSON');
  }
  const c = create.safeParse(body);
  if (!c.success) return apiError('invalid', 'kind is board or lane, id a uuid, access view or edit');
  try {
    const { workspaceId } = await userContext(user.id);
    const share = await createShare({ workspaceId, userId: user.id }, { kind: c.data.kind, id: c.data.id.toLowerCase() }, c.data.access);
    return NextResponse.json({ share: withUrl(share) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'POST /api/shares');
  }
}
