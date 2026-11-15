import { cursorSeq, rateLimit, resolveShare, shareCursor, shareIdOfToken, shareToken, type SharedLink } from '@noergo/core';
import { apiError } from './api';
import { PUBLIC_URL } from './env';

const secret = () => process.env.AUTH_SECRET ?? '';

/** The live link behind a token from a URL, or null: not ours, turned off, or its target gone. */
export async function linkOf(token: string): Promise<SharedLink | null> {
  const id = shareIdOfToken(secret(), token);
  return id ? resolveShare(id) : null;
}

/** What the owner copies. Without a language: the visitor lands in their own (src/proxy.ts). */
export const shareUrl = (shareId: string) => `${PUBLIC_URL}/s/${shareToken(secret(), shareId)}`;

/** The signed place in the change log a link's stream resumes from (core shareCursor). */
export const cursorOf = (link: SharedLink, seq: number) => shareCursor(secret(), link.id, seq);

/** The seq a link's stream starts after: Last-Event-ID on a reconnect, ?since= first; only cursors we signed. */
export function sharedStart(req: Request, link: SharedLink): number | null {
  const raw = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('since') ?? '';
  return cursorSeq(secret(), link.id, raw);
}

/**
 * The visitor's address as the reverse proxy saw it, for the rate limits of people without
 * an account (a link is opened by anyone holding it). The proxy must set X-Real-IP itself,
 * never pass on the client's (docker/Caddyfile does; any other proxy must too).
 */
export function visitorKey(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** The link of an API request under /api/shared/<token>, rate-limited per link and visitor; or the answer to give instead. */
export async function sharedRequest(req: Request, token: string, kind: string, limit: number): Promise<{ link: SharedLink } | { error: Response }> {
  const key = visitorKey(req);
  const tries = rateLimit(`shared:${kind}:${key}`, { limit: limit * 4, windowSeconds: 60 });
  if (!tries.ok) return { error: apiError('rate_limited', 'too many requests', { retryAfter: tries.retryAfter }) };
  const link = await linkOf(token);
  // A wrong token, a link turned off and a target in the trash look the same.
  if (!link) return { error: apiError('not_found', 'this link is not available') };
  const limited = rateLimit(`shared:${kind}:${link.id}:${key}`, { limit, windowSeconds: 60 });
  if (!limited.ok) return { error: apiError('rate_limited', 'too many requests', { retryAfter: limited.retryAfter }) };
  return { link };
}
