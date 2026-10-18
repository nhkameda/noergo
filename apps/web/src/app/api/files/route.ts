import { LIMITS, rateLimit, storeImage, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { readBoundedBytes } from '@/lib/bounded-body';
import { normalizeImage } from '@/lib/image';

export const dynamic = 'force-dynamic';

/**
 * Stores an image sent as the raw request body (a column cover). The answer carries the
 * id to put in an op; the bytes are decoded and re-encoded before they are kept.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const limited = rateLimit(`files:${user.id}`, { limit: 30, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many uploads', { retryAfter: limited.retryAfter });

  const body = await readBoundedBytes(req, LIMITS.imageUploadBytes, 30_000);
  if (body === null) return apiError('too_large', `images up to ${LIMITS.imageUploadBytes} bytes`);
  if (body.byteLength === 0) return apiError('invalid', 'empty body');
  try {
    const image = await normalizeImage(body);
    const ctx = await userContext(user.id);
    const name = (req.headers.get('x-file-name') ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 120);
    const file = await storeImage(ctx, { ...image, name });
    return NextResponse.json(file, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'POST /api/files');
  }
}
