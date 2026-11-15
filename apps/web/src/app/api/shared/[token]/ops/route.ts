import { batchSchema, executeSharedOps, rateLimit } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { readBoundedText } from '@/lib/bounded-body';
import { sharedRequest } from '@/lib/shared';

export const dynamic = 'force-dynamic';

/** As /api/ops: the client splits large batches below this. */
const MAX_BODY = 2 * 1024 * 1024;

/**
 * Changes through an edit link, by a signed-in person: anyone with the link may look, but
 * the change log says who changed what. Each op is checked against what the link opens.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in to change this');
  const r = await sharedRequest(req, (await params).token, 'ops', 240);
  if ('error' in r) return r.error;
  if (r.link.access !== 'edit') return apiError('forbidden', 'this link only shows');
  const limited = rateLimit(`ops:${user.id}`, { limit: 240, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many requests', { retryAfter: limited.retryAfter });

  const text = await readBoundedText(req, MAX_BODY);
  if (text === null) return apiError('too_large', `request body over ${MAX_BODY} bytes`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return apiError('invalid', 'body is not JSON');
  }
  const batch = batchSchema.safeParse(json);
  if (!batch.success) return NextResponse.json({ error: { code: 'invalid', message: 'invalid batch', issues: batch.error.issues.slice(0, 20) } }, { status: 422 });

  try {
    const results = await executeSharedOps(r.link, user.id, batch.data.ops);
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'POST /api/shared/:token/ops');
  }
}
