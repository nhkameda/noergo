import { rateLimit, setFocus, userContext } from '@noergo/core';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { readBoundedText } from '@/lib/bounded-body';

export const dynamic = 'force-dynamic';

const focusSchema = z.object({
  view: z.enum(['board', 'cards', 'dates', 'map']),
  boardId: z.uuid().nullable().optional(),
  laneId: z.uuid().nullable().optional(),
});

/**
 * What the person has on screen right now (a heartbeat while it stays open), so an agent
 * told "here" writes on the thought they are looking at (get_open_thought).
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const limited = rateLimit(`focus:${user.id}`, { limit: 60, windowSeconds: 60 });
  if (!limited.ok) return apiError('rate_limited', 'too many updates', { retryAfter: limited.retryAfter });
  let input: z.infer<typeof focusSchema>;
  try {
    input = focusSchema.parse(JSON.parse((await readBoundedText(req, 1024)) ?? ''));
  } catch {
    return apiError('invalid', 'expected { view, boardId?, laneId? }');
  }
  try {
    const { workspaceId } = await userContext(user.id);
    await setFocus(user.id, workspaceId, input);
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return apiFailure(err, 'POST /api/focus');
  }
}
