import { useEffect } from 'react';

export type FocusView = 'board' | 'cards' | 'dates' | 'map';

const BEAT_MS = 60_000;

/**
 * Tells the server what is on screen (POST /api/focus) when it changes, and every minute
 * while the tab is visible: an agent told "here" writes on the thought the person sees.
 * The server forgets a focus ten minutes after its last beat.
 */
export function useFocusHeartbeat(ready: boolean, view: FocusView, boardId: string | null, laneId: string | null): void {
  useEffect(() => {
    if (!ready) return;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch('/api/focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ view, boardId, laneId }),
        keepalive: true,
      }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [ready, view, boardId, laneId]);
}
