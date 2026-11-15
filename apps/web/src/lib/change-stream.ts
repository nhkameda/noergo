import type { ChangeRow } from '@noergo/core';
import { apiError } from './api';
import { subscribe } from './live';

/** Below Cloudflare's 100 s idle cut, with margin. */
const HEARTBEAT_MS = 25_000;
/** Streams end and reconnect hourly, which spreads them over restarted processes. */
const LIFETIME_MS = 60 * 60_000;
/** A client that stops reading is dropped once this much is queued for it; it resumes by seq. */
const MAX_QUEUED_BYTES = 1024 * 1024;

/** One read of the change log: the next changes, "start over from a snapshot", or "no longer yours". */
export type StreamPage = { kind: 'changes'; seq: number; changes: ChangeRow[]; more: boolean } | { kind: 'reset' } | { kind: 'gone' };

export interface StreamSource {
  workspaceId: string;
  /** Whose streams count together: a person (MAX_STREAMS_PER_USER), or keys with their own caps. */
  holder: string | ReadonlyArray<readonly [key: string, max: number]>;
  /** The event id of a change, which EventSource sends back on reconnect; the seq by default. */
  eventId?: (seq: number) => string;
  read: (since: number) => Promise<StreamPage>;
  /** Still allowed to read? Asked every `recheckMs`; false ends the stream with `signed-out`. */
  recheck: () => Promise<boolean>;
  recheckMs: number;
}

/** The seq a stream starts after: Last-Event-ID on a reconnect, ?since= on the first open. */
export function streamStart(req: Request): number | null {
  const raw = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('since') ?? '';
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/**
 * Live changes as Server-Sent Events, for one's own workspace and for a shared link:
 *
 *   event: change   id: <seq>   data: one change-log row (effects in their public shape)
 *   event: reset                the client is too far behind: reload its snapshot
 *   event: signed-out           the session was revoked, or the link turned off
 *
 * The client starts from the seq of its snapshot (?since=) and resumes with
 * Last-Event-ID, which EventSource sends by itself on reconnect.
 */
export function changeStream(req: Request, since: number, source: StreamSource): Response {
  let last = since;
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
                const page = await source.read(last);
                if (closed) return;
                if (page.kind === 'reset') {
                  send('event: reset\ndata: {}\n\n');
                  close();
                  return;
                }
                if (page.kind === 'gone') {
                  send('event: signed-out\ndata: {}\n\n');
                  close();
                  return;
                }
                for (const change of page.changes) send(`id: ${source.eventId ? source.eventId(change.seq) : change.seq}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`);
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

        const unsubscribe = subscribe(source.holder, source.workspaceId, () => void pump());
        if (!unsubscribe) {
          send('event: error\ndata: {"code":"too_many_streams"}\n\n');
          closed = true;
          controller.close();
          return;
        }

        const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
        const recheck = setInterval(() => {
          source
            .recheck()
            .then((ok) => {
              if (!ok) {
                send('event: signed-out\ndata: {}\n\n');
                close();
              }
            })
            .catch(() => {});
        }, source.recheckMs);
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

export const badStart = () => apiError('invalid', 'since must be the seq of a snapshot');
