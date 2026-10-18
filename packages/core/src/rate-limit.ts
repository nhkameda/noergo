import { createHash } from 'node:crypto';

/**
 * Fixed-window rate limiter in process memory.
 *
 * Correct for one process per service, which is how noergo runs. With replicas each
 * would keep its own counters and the effective limit would multiply; that is the day
 * this becomes a Postgres or Redis implementation of the same interface.
 *
 * Two defences make the limiter itself hard to attack: keys are stored as a fixed-size
 * digest, so a megabyte identifier costs the same few bytes as a short one, and the
 * table has a ceiling. At the ceiling expired windows go first; if that is not enough,
 * NEW identifiers are refused. Live counters are never evicted, or a flood of invented
 * identifiers could reset the counter of the account under attack.
 */

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfter: number };

const MAX_BUCKETS = 50_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let sweepNotBefore = 0;

/** "login:…" keeps its readable prefix (up to 16 characters) for diagnosis. */
function keyOf(identifier: string): string {
  const cut = identifier.indexOf(':');
  const prefix = cut > 0 ? identifier.slice(0, Math.min(cut, 16)) : '';
  return `${prefix}:${createHash('sha256').update(identifier).digest('hex').slice(0, 32)}`;
}

function makeRoom(now: number): boolean {
  if (buckets.size < MAX_BUCKETS) return true;
  // Saturation must not turn every new identifier into an O(n) sweep.
  if (now < sweepNotBefore) return false;
  sweepNotBefore = now + 1000;
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
  return buckets.size < MAX_BUCKETS;
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 5 * 60_000);
sweeper.unref?.();

export function rateLimit(identifier: string, { limit, windowSeconds }: RateLimit): RateLimitResult {
  const now = Date.now();
  const key = keyOf(identifier);
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    if (!bucket && !makeRoom(now)) return { ok: false, retryAfter: 60 };
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  bucket.count++;
  return { ok: true, remaining: limit - bucket.count };
}

/** Tests only. */
export function resetRateLimits(): void {
  buckets.clear();
  sweepNotBefore = 0;
}
