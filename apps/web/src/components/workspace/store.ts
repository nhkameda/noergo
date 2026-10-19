import type { NoteDto } from '@noergo/core/dto';
import { newId } from '@noergo/core/ids';
import type { OpOutcome } from '@noergo/core/ops/execute';
import { opSchema, type Op } from '@noergo/core/ops/schema';
import type { ChangeRow, NoteDetail, SearchHit, Snapshot } from '@noergo/core/read';
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { applyEffects, fromSnapshot, toSnapshot, withFullNote, withPending, type Data, type Pending } from './model';

/**
 * The browser side of the sync protocol (docs/architecture.md, "Live sync"):
 *
 *   snapshot ─► confirmed state ◄─ effects of our ops (POST /api/ops)
 *                     ▲          ◄─ effects of everyone's ops (GET /api/stream, SSE)
 *                     └─ + pending ops laid over it = what the screen shows
 *
 * Ops carry an opId and are retried until the server answers; a repeated opId gets its
 * stored receipt, so a retry never applies twice. Pending ops and the last confirmed
 * state are kept in IndexedDB per user: the board opens instantly and survives being
 * offline. Signing out clears it.
 */

export type Connection = 'loading' | 'live' | 'connecting' | 'offline';

export interface Notice {
  id: number;
  tone: 'info' | 'error';
  /** Key under app.notices in the message catalogue. */
  key: string;
  values?: Record<string, string | number>;
  /** Offered as "Undo" on the notice. */
  undo?: () => void;
}

/** An entity an agent just touched: the screen lights it up for a moment. */
export interface AgentMark {
  label: string;
  at: number;
  /** Created by the agent (it enters with its halo), not just changed. */
  fresh: boolean;
}

/** How long a mark lasts, and "… is writing" after the agent's last change. */
export const AGENT_MARK_MS = 4000;
export const AGENT_WRITING_MS = 5000;

export interface WorkspaceState {
  data: Data | null;
  /** By entity id (note, thought, link, board). A thought is marked too when its ideas change. */
  agentMarks: ReadonlyMap<string, AgentMark>;
  /** The agent writing now, shown until a few seconds after its last change. */
  agentWriting: string | null;
  /** An agent wrote here since the page opened (the map then offers "Follow the agent"). */
  agentSeen: boolean;
  connection: Connection;
  /** Ops made here that the server has not confirmed yet. */
  unsynced: number;
  notices: readonly Notice[];
  canUndo: boolean;
  canRedo: boolean;
}

export type Outcome = OpOutcome | { opId: string; status: 'dropped' };

interface Step {
  undo: Op[];
  redo: Op[];
}

/** Below the server's 2 MB body limit, with room for JSON escaping. */
const MAX_BATCH_BYTES = 1_500_000;
const MAX_BATCH_OPS = 50;
const UNDO_DEPTH = 100;
const CACHE_VERSION = 1;

const jitter = (ms: number) => ms / 2 + Math.random() * (ms / 2);

export class WorkspaceStore {
  private confirmed: Data | null = null;
  private pending: Pending[] = [];
  private state: WorkspaceState = { data: null, agentMarks: new Map(), agentWriting: null, agentSeen: false, connection: 'loading', unsynced: 0, notices: [], canUndo: false, canRedo: false };
  private listeners = new Set<() => void>();
  private waiters = new Map<string, (o: Outcome) => void>();
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private es: EventSource | null = null;
  private sending = false;
  private sendAttempt = 0;
  private streamAttempt = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;
  private idb: UseStore | null = null;
  private running = false;
  private noticeSeq = 0;

  constructor(
    private readonly userId: string,
    private readonly onSignedOut: () => void,
  ) {}

  // ───────────────────────────── React binding

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private emit(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private recompute() {
    this.emit({
      data: this.confirmed ? withPending(this.confirmed, this.pending) : null,
      unsynced: this.pending.length,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ───────────────────────────── lifecycle

  /** Safe to call again after stop() (React runs effects twice in development). */
  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    void this.boot();
  }

  stop() {
    this.running = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.closeStream();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.running) fn();
    }, ms);
    this.timers.add(t);
  }

  private async boot() {
    this.idb = openCache();
    if (this.idb) {
      try {
        // One person's notes must not linger for the next person on this browser.
        for (const k of await keys<string>(this.idb)) if (!String(k).endsWith(`:${this.userId}`)) await del(k, this.idb);
        const [snap, queue] = await Promise.all([get<{ v: number; snapshot: Snapshot }>(`snap:${this.userId}`, this.idb), get<Pending[]>(`queue:${this.userId}`, this.idb)]);
        if (!this.running) return;
        if (snap?.v === CACHE_VERSION && !this.confirmed) this.confirmed = fromSnapshot(snap.snapshot);
        if (Array.isArray(queue) && queue.length) this.pending = [...queue, ...this.pending.filter((p) => !queue.some((q) => q.opId === p.opId))];
        this.recompute();
      } catch {
        this.idb = null; // private browsing, quota: carry on without the cache
      }
    }
    await this.reload();
  }

  /** Fetches a fresh snapshot, then follows the live stream from its seq. */
  private async reload() {
    this.closeStream();
    if (!navigator.onLine) {
      this.emit({ connection: 'offline' });
      return;
    }
    this.emit({ connection: this.confirmed ? 'connecting' : 'loading' });
    let res: Response;
    try {
      res = await fetch('/api/snapshot', { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      this.emit({ connection: 'offline' });
      this.later(() => void this.reload(), jitter(Math.min(30_000, 2000 * 2 ** this.streamAttempt++)));
      return;
    }
    if (!this.running) return;
    if (res.status === 401) return this.signedOut();
    if (!res.ok) {
      this.emit({ connection: 'connecting' });
      this.later(() => void this.reload(), jitter(Math.min(60_000, 2000 * 2 ** this.streamAttempt++)));
      return;
    }
    this.confirmed = fromSnapshot((await res.json()) as Snapshot);
    this.recompute();
    this.saveCacheSoon();
    this.openStream();
    void this.flush();
  }

  private onOnline = () => {
    if (!this.confirmed) {
      void this.reload();
    } else {
      // The old stream may be stuck retrying, or may have survived a short drop without
      // ever firing "open" again: a new one resumes from seq and reports itself live.
      this.closeStream();
      this.openStream();
    }
    void this.flush();
  };

  private onOffline = () => this.emit({ connection: 'offline' });

  private signedOut() {
    this.stop();
    void this.clearCache().finally(this.onSignedOut);
  }

  async clearCache() {
    const idb = this.idb ?? openCache();
    if (!idb) return;
    try {
      await Promise.all([del(`snap:${this.userId}`, idb), del(`queue:${this.userId}`, idb)]);
    } catch {
      // nothing cached
    }
  }

  // ───────────────────────────── live stream

  private openStream() {
    if (this.es || !this.confirmed || !this.running) return;
    const es = new EventSource(`/api/stream?since=${this.confirmed.seq}`);
    this.es = es;
    es.addEventListener('open', () => {
      this.streamAttempt = 0;
      this.emit({ connection: 'live' });
    });
    es.addEventListener('change', (e) => {
      if (!this.confirmed) return;
      const row = JSON.parse((e as MessageEvent<string>).data) as ChangeRow;
      if (row.seq <= this.confirmed.seq) return;
      if (row.seq !== this.confirmed.seq + 1) {
        void this.reload(); // a gap: never guess, start over from a snapshot
        return;
      }
      this.confirmed = applyEffects(this.confirmed, row.effects, row.seq);
      this.recompute();
      if (row.actor?.kind === 'agent' || row.actor?.kind === 'token') this.agentChanged(row, row.actor.label);
      this.saveCacheSoon();
    });
    es.addEventListener('reset', () => void this.reload());
    es.addEventListener('signed-out', () => this.signedOut());
    es.addEventListener('error', (e) => {
      if (e instanceof MessageEvent && e.data) {
        // Our own error event: this person holds too many streams. Try again later.
        this.closeStream();
        this.emit({ connection: 'connecting' });
        this.later(() => this.openStream(), jitter(60_000));
        return;
      }
      if (es.readyState === EventSource.CLOSED) {
        // The browser gave up (an HTTP error, not a dropped connection): find out why.
        this.closeStream();
        this.emit({ connection: navigator.onLine ? 'connecting' : 'offline' });
        this.later(() => void this.recheck(), jitter(Math.min(60_000, 2000 * 2 ** this.streamAttempt++)));
      } else {
        this.emit({ connection: navigator.onLine ? 'connecting' : 'offline' }); // it retries by itself, with Last-Event-ID
      }
    });
  }

  // ───────────────────────────── agents at work

  private agentChanged(row: ChangeRow, label: string) {
    const at = Date.now();
    const created = row.op.endsWith('.create');
    const marks = new Map(this.state.agentMarks);
    const mark = (id: string, fresh: boolean) => marks.set(id, { label, at, fresh: fresh || (marks.get(id)?.fresh ?? false) });
    for (const e of row.effects) {
      if (e.kind === 'layout' || e.kind === 'layout.removed') continue;
      mark(e.data.id, created);
      if (e.kind === 'note') mark(e.data.laneId, false);
    }
    this.emit({ agentMarks: marks, agentWriting: label, agentSeen: true });
    this.later(() => this.expireAgentMarks(), AGENT_MARK_MS + 50);
    this.later(() => this.expireAgentMarks(), AGENT_WRITING_MS + 50);
  }

  private expireAgentMarks() {
    const now = Date.now();
    const all = [...this.state.agentMarks.values()];
    const last = all.reduce((t, m) => Math.max(t, m.at), 0);
    const marks = new Map([...this.state.agentMarks].filter(([, m]) => now - m.at < AGENT_MARK_MS));
    this.emit({ agentMarks: marks, agentWriting: now - last < AGENT_WRITING_MS ? this.state.agentWriting : null });
  }

  private closeStream() {
    this.es?.close();
    this.es = null;
  }

  /** After the stream failed for good: signed out, or just retry from where it stopped. */
  private async recheck() {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      const session = res.ok ? ((await res.json()) as { user?: unknown } | null) : null;
      if (res.ok && !session?.user) return this.signedOut();
    } catch {
      // offline: the online event brings it back
      return;
    }
    this.openStream();
  }

  // ───────────────────────────── writing

  /**
   * Queues operations: they show at once and are sent in order. Invalid ops (a bug, or a
   * value the server would refuse) are refused here and never queued.
   */
  dispatch(ops: Op | Op[], opts: { local?: Pending['local']; quiet?: boolean; undo?: Op[]; redo?: Op[] } = {}): Promise<Outcome>[] {
    const list = Array.isArray(ops) ? ops : [ops];
    const accepted: Pending[] = [];
    const outcomes = list.map((op) => {
      const opId = newId();
      const parsed = opSchema.safeParse(op);
      if (!parsed.success) {
        console.warn('[noergo] refused op', op.type, parsed.error.issues[0]?.message);
        this.notify({ tone: 'error', key: 'invalid' });
        return Promise.resolve<Outcome>({ opId, status: 'dropped' });
      }
      accepted.push({ opId, op: parsed.data, ...(opts.local && list.length === 1 ? { local: opts.local } : {}), ...(opts.quiet ? { quiet: true } : {}) });
      return new Promise<Outcome>((resolve) => this.waiters.set(opId, resolve));
    });
    if (!accepted.length) return outcomes;
    this.pending = [...this.pending, ...accepted];
    if (opts.undo) {
      this.undoStack = [...this.undoStack.slice(-(UNDO_DEPTH - 1)), { undo: opts.undo, redo: opts.redo ?? list }];
      this.redoStack = [];
    }
    this.recompute();
    this.saveQueue();
    void this.flush();
    return outcomes;
  }

  undo() {
    const step = this.undoStack.at(-1);
    if (!step) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, step];
    this.dispatch(step.undo);
  }

  redo() {
    const step = this.redoStack.at(-1);
    if (!step) return;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, step];
    this.dispatch(step.redo);
  }

  private takeBatch(): Pending[] {
    const batch: Pending[] = [];
    let bytes = 0;
    for (const p of this.pending) {
      const size = JSON.stringify(p.op).length + 64;
      if (batch.length && (batch.length >= MAX_BATCH_OPS || bytes + size > MAX_BATCH_BYTES)) break;
      batch.push(p);
      bytes += size;
    }
    return batch;
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.running || !this.confirmed || !this.pending.length) return;
    if (!navigator.onLine) {
      this.emit({ connection: 'offline' });
      return;
    }
    const batch = this.takeBatch();
    this.sending = true;
    let res: Response;
    try {
      res = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: batch.map((p) => ({ opId: p.opId, op: p.op })) }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      this.sending = false;
      this.retrySend();
      return;
    }
    this.sending = false;
    if (!this.running) return;
    if (res.status === 401) return this.signedOut();
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('Retry-After'));
      this.retrySend(Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
      return;
    }
    if (!res.ok) {
      // The whole batch was refused (too large, invalid). Retrying would fail the same way.
      this.settle(batch.map((p) => ({ opId: p.opId, status: 'dropped' as const })));
      this.notify({ tone: 'error', key: 'refused' });
      void this.flush();
      return;
    }
    this.sendAttempt = 0;
    const { results } = (await res.json()) as { results: OpOutcome[] };
    this.settle(results);
    void this.flush();
  }

  private retrySend(ms?: number) {
    this.emit({ connection: navigator.onLine ? this.state.connection : 'offline' });
    this.later(() => void this.flush(), ms ?? jitter(Math.min(30_000, 1000 * 2 ** this.sendAttempt++)));
  }

  private settle(results: Outcome[]) {
    const done = new Set<string>();
    const quiet = new Set(this.pending.filter((p) => p.quiet).map((p) => p.opId));
    for (const r of results) {
      done.add(r.opId);
      if (r.status === 'applied' && this.confirmed) this.confirmed = applyEffects(this.confirmed, r.effects);
      else if (r.status === 'conflict' && !quiet.has(r.opId)) this.notify({ tone: 'error', key: 'conflict' });
      else if (r.status === 'rejected') this.notify({ tone: 'error', key: r.error.code === 'not_found' ? 'gone' : r.error.code === 'limit_reached' ? 'limit' : 'refused' });
      this.waiters.get(r.opId)?.(r);
      this.waiters.delete(r.opId);
    }
    this.pending = this.pending.filter((p) => !done.has(p.opId));
    this.recompute();
    this.saveQueue();
    this.saveCacheSoon();
  }

  // ───────────────────────────── reading

  /** The whole note with its links; fills in a long body that travelled as an excerpt. */
  async fetchNote(id: string, signal?: AbortSignal): Promise<NoteDetail | null> {
    const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal });
    if (res.status === 401) {
      this.signedOut();
      return null;
    }
    if (!res.ok) return null;
    const detail = (await res.json()) as NoteDetail;
    if (this.confirmed) {
      this.confirmed = withFullNote(this.confirmed, detail.note);
      this.recompute();
    }
    return detail;
  }

  async search(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin', cache: 'no-store', signal });
    if (!res.ok) return [];
    return ((await res.json()) as { hits: SearchHit[] }).hits;
  }

  note(id: string): NoteDto | undefined {
    return this.state.data?.notes.get(id);
  }

  // ───────────────────────────── notices

  notify(n: Omit<Notice, 'id'>) {
    const notice = { ...n, id: ++this.noticeSeq };
    this.emit({ notices: [...this.state.notices.slice(-3), notice] });
    this.later(() => this.dismiss(notice.id), n.undo ? 8000 : 5000);
  }

  dismiss(id: number) {
    if (this.state.notices.some((n) => n.id === id)) this.emit({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  // ───────────────────────────── cache

  private saveQueue() {
    if (!this.idb) return;
    set(`queue:${this.userId}`, this.pending, this.idb).catch(() => {});
  }

  private saveCacheSoon() {
    if (!this.idb || this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = null;
      if (!this.idb || !this.confirmed || !this.running) return;
      set(`snap:${this.userId}`, { v: CACHE_VERSION, snapshot: toSnapshot(this.confirmed) }, this.idb).catch(() => {});
    }, 1500);
  }
}

function openCache(): UseStore | null {
  try {
    return typeof indexedDB === 'undefined' ? null : createStore('noergo', 'cache');
  } catch {
    return null;
  }
}
