import { resolveShare, sharedChangesSince } from '@noergo/core';
import { badStart, changeStream } from '@/lib/change-stream';
import { cursorOf, sharedRequest, sharedStart, visitorKey } from '@/lib/shared';

export const dynamic = 'force-dynamic';

/** A link turned off ends the streams that read through it this fast. */
const RECHECK_MS = 60_000;
/** Streams one visitor, and everyone together, may hold open on one link. */
const PER_VISITOR = 8;
const PER_LINK = 200;

/** Live changes of a shared link, cut to what it opens (core sharedChangesSince). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const r = await sharedRequest(req, (await params).token, 'stream', 30);
  if ('error' in r) return r.error;
  const { link } = r;
  const since = sharedStart(req, link);
  if (since === null) return badStart();
  return changeStream(req, since, {
    workspaceId: link.workspaceId,
    holder: [
      [`share:${link.id}:${visitorKey(req)}`, PER_VISITOR],
      [`share:${link.id}`, PER_LINK],
    ],
    eventId: (seq) => cursorOf(link, seq),
    read: async (from) => {
      const page = await sharedChangesSince(link, from, 200);
      if (page.gone) return { kind: 'gone' };
      return page.reset ? { kind: 'reset' } : { kind: 'changes', seq: page.seq, changes: page.changes, more: page.more };
    },
    recheck: async () => (await resolveShare(link.id)) !== null,
    recheckMs: RECHECK_MS,
  });
}
