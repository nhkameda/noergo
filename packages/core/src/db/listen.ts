import pg from 'pg';
import { CHANGES_CHANNEL } from '../ops/execute';

/**
 * One dedicated connection per process LISTENing on the change channel, outside the
 * pool: a pooled connection would be handed to someone else between notifications.
 *
 * Notifications are a wake-up call, not the data: a NOTIFY sent while the connection was
 * down is lost, so every (re)connect calls onResync and subscribers re-read the change
 * log from their own last seq. Missing a notification delays an update; it never loses it.
 */
export interface ChangeListener {
  /** True while the connection is up and LISTENing. */
  readonly connected: boolean;
  close(): Promise<void>;
}

export interface ListenOptions {
  connectionString: string;
  onChange: (workspaceId: string, seq: number) => void;
  /** After every successful (re)connect: notifications may have been missed. */
  onResync: () => void;
  onError?: (err: Error) => void;
}

const PAYLOAD = /^([0-9a-f-]{36}):(\d+)$/i;

export function listenForChanges(opts: ListenOptions): ChangeListener {
  let client: pg.Client | null = null;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (closed) return;
    // 0.5 s doubling up to 30 s, with jitter so every process does not reconnect at once.
    const delay = Math.min(30_000, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2);
    timer = setTimeout(connect, delay);
    timer.unref?.();
  };

  const drop = (err?: Error) => {
    if (err) opts.onError?.(err);
    connected = false;
    const c = client;
    client = null;
    c?.removeAllListeners();
    c?.end().catch(() => {});
    schedule();
  };

  async function connect() {
    if (closed) return;
    const c = new pg.Client({ connectionString: opts.connectionString, application_name: `${process.env.NOERGO_SERVICE ?? 'noergo'}:listen`, keepAlive: true });
    client = c;
    c.on('error', (err) => drop(err));
    c.on('end', () => {
      if (client === c) drop();
    });
    c.on('notification', (msg) => {
      if (msg.channel !== CHANGES_CHANNEL || !msg.payload) return;
      const m = PAYLOAD.exec(msg.payload);
      if (m) opts.onChange(m[1]!.toLowerCase(), Number(m[2]));
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANGES_CHANNEL}`);
      if (client !== c) return;
      connected = true;
      attempt = 0;
      opts.onResync();
    } catch (err) {
      if (client === c) drop(err as Error);
    }
  }

  void connect();

  return {
    get connected() {
      return connected;
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      const c = client;
      client = null;
      connected = false;
      c?.removeAllListeners();
      await c?.end().catch(() => {});
    },
  };
}
