import { batchSchema, executeOps, rateLimit, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { readBoundedText } from '@/lib/bounded-body';

export const dynamic = 'force-dynamic';

/** 50 ops of at most 100k characters would be 20 MB; the client splits large batches. */
const MAX_BODY = 2 * 1024 * 1024;

/**
 * Applies a batch of domain operations as the signed-in user. Each op answers on its own
 * (applied, conflict, rejected); a repeated opId answers with its stored receipt.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
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
    const { workspaceId, actorId } = await userContext(user.id);
    const results = await executeOps({ workspaceId, actorId, actorKind: 'user' }, batch.data.ops);
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'POST /api/ops');
  }
}
