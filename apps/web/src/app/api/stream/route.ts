import { changesSince, rateLimit, sessionState, userContext } from '@noergo/core';
import { apiError, apiFailure, apiUser } from '@/lib/api';
import { subscribe } from '@/lib/live';

export const dynamic = 'force-dynamic';

/** Below Cloudflare's 100 s idle cut, with margin. */
const HEARTBEAT_MS = 25_000;
/** A revoked session (sign out everywhere, deleted account) ends its streams this fast. */
const RECHECK_MS = 5 * 60_000;
/** Streams end and reconnect hourly, which spreads them over restarted processes. */
const LIFETIME_MS = 60 * 60_000;
/** A client that stops reading is dropped once this much is queued for it; it resumes by seq. */
const MAX_QUEUED_BYTES = 1024 * 1024;

/**
 * Live changes of the signed-in user's workspace as Server-Sent Events.
 *
 *   event: change   id: <seq>   data: one change-log row (effects in their public shape)
 *   event: reset                the client is too far behind: reload /api/snapshot
 *   event: signed-out           the session was revoked
 *
 * The client starts from the seq of its snapshot (?since=) and resumes with
 * Last-Event-ID, which EventSource sends by itself on reconnect.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const opened = rateLimit(`stream:${user.id}`, { limit: 30, windowSeconds: 60 });
  if (!opened.ok) return apiError('rate_limited', 'reconnecting too often', { retryAfter: opened.retryAfter });

  const raw = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('since') ?? '';
  if (!/^\d{1,15}$/.test(raw)) return apiError('invalid', 'since must be the seq of a snapshot');
  let last = Number(raw);

  let workspaceId: string;
  try {
    ({ workspaceId } = await userContext(user.id));
  } catch (err) {
    return apiFailure(err, 'GET /api/stream');
  }

  const encoder = new TextEncoder();
  let close = () => {};

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        let busy = false;
        let again = false;

        const send = (text: string) => {
          if (closed) return;
          controller.enqueue(encoder.encode(text));
          if ((controller.desiredSize ?? 0) < 0) close();
        };

        // Reads every change after `last`; a wake-up during a read triggers one more pass.
        const pump = async () => {
          if (busy) {
            again = true;
            return;
          }
          busy = true;
          try {
            do {
              again = false;
              for (;;) {
                const page = await changesSince(workspaceId, last, 200);
                if (closed) return;
                if (page.reset) {
                  send('event: reset\ndata: {}\n\n');
                  close();
                  return;
                }
                for (const change of page.changes) send(`id: ${change.seq}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`);
                last = page.seq;
                if (!page.more) break;
              }
            } while (again && !closed);
          } catch (err) {
            console.error(`[stream] ${(err as Error).message}`);
            close();
          } finally {
            busy = false;
          }
        };

        const unsubscribe = subscribe(user.id, workspaceId, () => void pump());
        if (!unsubscribe) {
          send('event: error\ndata: {"code":"too_many_streams"}\n\n');
          closed = true;
          controller.close();
          return;
        }

        const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
        const recheck = setInterval(() => {
          sessionState(user.id, user.epoch)
            .then((state) => {
              if (!state) {
                send('event: signed-out\ndata: {}\n\n');
                close();
              }
            })
            .catch(() => {});
        }, RECHECK_MS);
        const lifetime = setTimeout(() => close(), LIFETIME_MS);

        close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearInterval(recheck);
          clearTimeout(lifetime);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        };
        req.signal.addEventListener('abort', () => close());

        // Reconnect delay with jitter, so a restart does not bring every client back at once.
        send(`retry: ${1000 + Math.floor(Math.random() * 14_000)}\n\n`);
        void pump();
      },
      cancel() {
        close();
      },
    },
    { highWaterMark: MAX_QUEUED_BYTES, size: (chunk) => chunk.byteLength },
  );

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // Nginx must not buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
