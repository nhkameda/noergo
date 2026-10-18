import { isDomainError, type DomainErrorCode } from '@noergo/core';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/** HTTP status of each domain error code. */
const STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  version_conflict: 409,
  invalid: 422,
  limit_reached: 422,
  read_only_connection: 403,
  plan_required: 402,
  rate_limited: 429,
  forbidden: 403,
};

export function apiError(code: DomainErrorCode | 'unauthenticated' | 'too_large' | 'internal', message: string, init: { retryAfter?: number } = {}) {
  const status = code === 'unauthenticated' ? 401 : code === 'too_large' ? 413 : code === 'internal' ? 500 : STATUS[code];
  const res = NextResponse.json({ error: { code, message } }, { status });
  if (init.retryAfter) res.headers.set('Retry-After', String(init.retryAfter));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** The signed-in user of an API request, or null (answer 401). */
export async function apiUser(): Promise<{ id: string; epoch: number } | null> {
  const session = await auth();
  return session?.user?.id ? { id: session.user.id, epoch: session.user.epoch } : null;
}

/** Domain errors become their status; anything else is logged and answered as 500. */
export function apiFailure(err: unknown, where: string) {
  if (isDomainError(err)) return apiError(err.code, err.message);
  console.error(`[api] ${where}: ${(err as Error)?.stack ?? String(err)}`);
  return apiError('internal', 'internal error');
}
