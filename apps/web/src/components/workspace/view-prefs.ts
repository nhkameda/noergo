import { useSyncExternalStore } from 'react';

/**
 * A choice remembered on this device (localStorage), shared live by every component that
 * reads it and by the other tabs. Without storage (private mode, quota) it lasts until the
 * page reloads. The server renders `fallback`.
 */
export function deviceSetting<T extends string | number>(key: string, parse: (raw: string | null) => T, fallback: T) {
  const listeners = new Set<() => void>();
  let memory: { v: T } | null = null;
  const subscribe = (f: () => void) => {
    listeners.add(f);
    window.addEventListener('storage', f);
    return () => {
      listeners.delete(f);
      window.removeEventListener('storage', f);
    };
  };
  const read = (): T => {
    if (memory) return memory.v;
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return fallback;
    }
  };
  const write = (v: T) => {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      memory = { v };
    }
    listeners.forEach((f) => f());
  };
  const use = () => useSyncExternalStore(subscribe, read, () => fallback);
  return { use, read, write };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Columns or cards: how a board is shown. */
export type Layout = 'columns' | 'cards';
export const LAYOUT = deviceSetting<Layout>('noergo:layout', (raw) => (raw === 'cards' ? 'cards' : 'columns'), 'columns');

/** Cards per row: the person’s choice, but never more than fit (a card stays readable; the same 96 px minimum is in workspace.css). */
export const CARDS = { min: 1, max: 12, fallback: 6, minWidth: 96 } as const;
export const perRow = (n: number) => clamp(Math.round(n), CARDS.min, CARDS.max);
export const CARDS_PER_ROW = deviceSetting<number>('noergo:cards-per-row', (raw) => (raw && Number.isFinite(+raw) ? perRow(+raw) : CARDS.fallback), CARDS.fallback);

/** How many cards of at least CARDS.minWidth fit in `width`, `gap` apart. */
export const cardsThatFit = (width: number, gap: number) => clamp(Math.floor((width + gap) / (CARDS.minWidth + gap)), CARDS.min, CARDS.max);

/** The size of the columns view, 50 % to 150 %. */
export const COLUMNS = { min: 0.5, max: 1.5, fallback: 1, step: 0.05 } as const;
export const columnsZoom = (z: number) => Math.round(clamp(z, COLUMNS.min, COLUMNS.max) * 1000) / 1000;
export const COLUMNS_ZOOM = deviceSetting<number>('noergo:columns-zoom', (raw) => (raw && Number.isFinite(+raw) ? columnsZoom(+raw) : COLUMNS.fallback), COLUMNS.fallback);

/**
 * Where a zoom sits on a slider from 0 to 1 when the slider runs on a log scale (each step
 * multiplies), and back. The map zooms from 15 % to 300 %: a linear slider would give
 * almost all its length to zooming in.
 */
export const toLogSlider = (z: number, min: number, max: number) => clamp(Math.log(z / min) / Math.log(max / min), 0, 1);
export const fromLogSlider = (t: number, min: number, max: number) => min * (max / min) ** clamp(t, 0, 1);

/**
 * The scroll offset that keeps the content under `at` (px from the scroller's start) in
 * place when everything is scaled by `ratio`.
 */
export const anchoredScroll = (scroll: number, at: number, ratio: number) => Math.max(0, (scroll + at) * ratio - at);
