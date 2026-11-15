import { changesSince, rateLimit, sessionState, userContext } from '@noergo/core';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { badStart, changeStream, streamStart } from '@/lib/change-stream';

export const dynamic = 'force-dynamic';

/** A revoked session (sign out everywhere, deleted account) ends its streams this fast. */
const RECHECK_MS = 5 * 60_000;

/** Live changes of the signed-in user's workspace as Server-Sent Events (lib/change-stream.ts). */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const opened = rateLimit(`stream:${user.id}`, { limit: 30, windowSeconds: 60 });
  if (!opened.ok) return apiError('rate_limited', 'reconnecting too often', { retryAfter: opened.retryAfter });

  const since = streamStart(req);
  if (since === null) return badStart();

  let workspaceId: string;
  try {
    ({ workspaceId } = await userContext(user.id));
  } catch (err) {
    return apiFailure(err, 'GET /api/stream');
  }

  return changeStream(req, since, {
    workspaceId,
    holder: user.id,
    read: async (from) => {
      const page = await changesSince(workspaceId, from, 200);
      return page.reset ? { kind: 'reset' } : { kind: 'changes', seq: page.seq, changes: page.changes, more: page.more };
    },
    recheck: async () => (await sessionState(user.id, user.epoch)) !== null,
    recheckMs: RECHECK_MS,
  });
}
