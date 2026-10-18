import { listenForChanges, type ChangeListener } from '@noergo/core/db/listen';

/**
 * Fan-out of change notifications to the open streams of this process. One LISTEN
 * connection serves every stream; a stream is woken up and reads the change log itself,
 * so a missed notification only delays it (see listenForChanges).
 */
type Wake = () => void;

interface Hub {
  listener: ChangeListener;
  byWorkspace: Map<string, Set<Wake>>;
  byUser: Map<string, number>;
}

// Kept on globalThis so that dev-mode reloads reuse the connection instead of leaking one.
const g = globalThis as { __noergoLive?: Hub };

function hub(): Hub {
  if (g.__noergoLive) return g.__noergoLive;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const byWorkspace = new Map<string, Set<Wake>>();
  const wakeAll = () => byWorkspace.forEach((set) => set.forEach((w) => w()));
  const listener = listenForChanges({
    connectionString: url,
    onChange: (workspaceId) => byWorkspace.get(workspaceId)?.forEach((w) => w()),
    onResync: wakeAll,
    onError: (err) => console.warn(`[live] change listener: ${err.message}`),
  });
  g.__noergoLive = { listener, byWorkspace, byUser: new Map() };
  return g.__noergoLive;
}

/** Streams one person may hold open at once (tabs share one through leader election). */
export const MAX_STREAMS_PER_USER = 8;

/** Registers a stream; null when the user already holds too many. */
export function subscribe(userId: string, workspaceId: string, wake: Wake): (() => void) | null {
  const h = hub();
  const held = h.byUser.get(userId) ?? 0;
  if (held >= MAX_STREAMS_PER_USER) return null;
  h.byUser.set(userId, held + 1);
  let set = h.byWorkspace.get(workspaceId);
  if (!set) h.byWorkspace.set(workspaceId, (set = new Set()));
  set.add(wake);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    set.delete(wake);
    if (set.size === 0) h.byWorkspace.delete(workspaceId);
    const n = (h.byUser.get(userId) ?? 1) - 1;
    if (n <= 0) h.byUser.delete(userId);
    else h.byUser.set(userId, n);
  };
}

export function liveStatus(): { listening: boolean; streams: number } {
  const h = g.__noergoLive;
  if (!h) return { listening: false, streams: 0 };
  let streams = 0;
  h.byWorkspace.forEach((s) => (streams += s.size));
  return { listening: h.listener.connected, streams };
}
